import type { FastifyInstance } from 'fastify';
import { verify } from '@node-rs/argon2';
import { changePasswordSchema, loginSchema, pinLoginSchema, type AuthResponse } from '@resto/shared';
import { audit, toUserDto } from '../auth.js';
import type { Ctx } from '../context.js';
import { unauthorized } from '../errors.js';

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  // Limite par IP en plus du verrouillage par compte
  const limited = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.post('/auth/login', limited, async (req) => {
    const b = loginSchema.parse(req.body);
    return ctx.auth.login('password', b.username, b.password) satisfies Promise<AuthResponse>;
  });

  /** Connexion rapide du caissier : identifiant + PIN (4 à 6 chiffres). Refusée pour le gérant. */
  app.post('/auth/pin-login', limited, async (req) => {
    const b = pinLoginSchema.parse(req.body);
    return ctx.auth.login('pin', b.username, b.pin) satisfies Promise<AuthResponse>;
  });

  app.get('/auth/me', { preHandler: ctx.auth.require() }, async (req) => toUserDto(req.user));

  app.post('/auth/change-password', { preHandler: ctx.auth.require(), ...limited }, async (req) => {
    const b = changePasswordSchema.parse(req.body);
    const { rows } = await ctx.db.query<{ password_hash: string | null; token_version: number }>(
      'select password_hash, token_version from app_users where id = $1',
      [req.user.id],
    );
    const row = rows[0];
    if (!row?.password_hash || !(await verify(row.password_hash, b.current_password).catch(() => false))) {
      throw unauthorized('Mot de passe actuel incorrect');
    }
    const newHash = await ctx.auth.hashPassword(b.new_password);
    // token_version + 1 : toutes les autres sessions de cet utilisateur sont révoquées
    const upd = await ctx.db.query<{ token_version: number }>(
      'update app_users set password_hash = $2, token_version = token_version + 1 where id = $1 returning token_version',
      [req.user.id, newHash],
    );
    await audit(ctx.db, req.user, 'auth.change_password', 'user', req.user.id);
    const token = await ctx.auth.issueToken({ id: req.user.id, role: req.user.role, token_version: upd.rows[0]!.token_version });
    return { token, user: toUserDto(req.user) } satisfies AuthResponse;
  });
}
