import { createHmac } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { can, type Permission, type Role, type UserDto } from '@resto/shared';
import type { Config } from './config.js';
import type { Db, Queryable } from './db.js';
import { HttpError, forbidden, unauthorized } from './errors.js';

export interface AuthUser {
  id: string;
  username: string;
  full_name: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

interface UserRow extends AuthUser {
  password_hash: string | null;
  pin_hash: string | null;
  is_active: boolean;
  token_version: number;
  failed_attempts: number;
  locked_until: Date | null;
}

const ISSUER = 'resto-manager';

export function toUserDto(u: AuthUser & { is_active?: boolean; pin_hash?: string | null }): UserDto {
  return { id: u.id, username: u.username, full_name: u.full_name, role: u.role, is_active: u.is_active ?? true };
}

export function createAuth(cfg: Config, db: Db) {
  const key = new TextEncoder().encode(cfg.JWT_SECRET);
  let dummyHash: Promise<string> | undefined;

  /** Le PIN n'est jamais haché seul : HMAC(poivre serveur, id:pin) puis argon2id. */
  const pinDigest = (userId: string, pin: string) =>
    createHmac('sha256', cfg.pinPepper).update(`${userId}:${pin}`).digest('hex');

  const hashPassword = (password: string) => hash(password);
  const hashPin = (userId: string, pin: string) => hash(pinDigest(userId, pin));

  async function issueToken(u: Pick<UserRow, 'id' | 'role' | 'token_version'>) {
    return new SignJWT({ role: u.role, tv: u.token_version })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(u.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(cfg.JWT_TTL)
      .sign(key);
  }

  /** Vérifie le jeton ET l'état courant de l'utilisateur (désactivation / changement de mot de passe = révocation immédiate). */
  async function verifyToken(token: string): Promise<AuthUser> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, key, { issuer: ISSUER, algorithms: ['HS256'] }));
    } catch {
      throw unauthorized('Session expirée, reconnectez-vous');
    }
    const { rows } = await db.query<UserRow>(
      'select id, username, full_name, role, is_active, token_version from app_users where id = $1',
      [payload.sub],
    );
    const u = rows[0];
    if (!u || !u.is_active || u.token_version !== payload.tv) throw unauthorized('Session révoquée, reconnectez-vous');
    return { id: u.id, username: u.username, full_name: u.full_name, role: u.role };
  }

  async function login(kind: 'password' | 'pin', username: string, secret: string) {
    const { rows } = await db.query<UserRow>('select * from app_users where lower(username) = lower($1)', [username]);
    const u = rows[0];
    const stored = u ? (kind === 'pin' ? u.pin_hash : u.password_hash) : null;
    const eligible = !!u && !!stored && u.is_active && (kind !== 'pin' || u.role === 'cashier');

    if (!eligible) {
      // Même coût CPU que le cas valide : ne révèle pas si le compte existe.
      dummyHash ??= hash('dummy-password-for-timing');
      await verify(await dummyHash, secret).catch(() => false);
      throw unauthorized('Identifiants invalides');
    }
    if (u.locked_until && u.locked_until.getTime() > Date.now()) {
      throw new HttpError(429, 'LOCKED', `Compte verrouillé ${cfg.LOCK_MINUTES} min après trop d'essais`);
    }

    const ok = await verify(stored!, kind === 'pin' ? pinDigest(u.id, secret) : secret).catch(() => false);
    if (!ok) {
      await db.query(
        `update app_users set
           failed_attempts = case when failed_attempts + 1 >= $2 then 0 else failed_attempts + 1 end,
           locked_until = case when failed_attempts + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
         where id = $1`,
        [u.id, cfg.MAX_FAILED_ATTEMPTS, cfg.LOCK_MINUTES],
      );
      throw unauthorized('Identifiants invalides');
    }
    if (u.failed_attempts > 0 || u.locked_until) {
      await db.query('update app_users set failed_attempts = 0, locked_until = null where id = $1', [u.id]);
    }
    return { token: await issueToken(u), user: toUserDto(u) };
  }

  /** preHandler : authentifie, puis exige la permission. */
  function require(permission?: Permission) {
    return async (req: FastifyRequest) => {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw unauthorized();
      req.user = await verifyToken(header.slice(7));
      if (permission && !can(req.user.role, permission)) throw forbidden();
    };
  }

  return { hashPassword, hashPin, issueToken, verifyToken, login, require };
}

export type Auth = ReturnType<typeof createAuth>;

export async function audit(
  q: Queryable,
  user: Pick<AuthUser, 'id'> | null,
  action: string,
  entity?: string,
  entityId?: string,
  details?: unknown,
) {
  await q.query('insert into audit_log (user_id, action, entity, entity_id, details) values ($1,$2,$3,$4,$5)', [
    user?.id ?? null,
    action,
    entity ?? null,
    entityId ?? null,
    details === undefined ? null : JSON.stringify(details),
  ]);
}
