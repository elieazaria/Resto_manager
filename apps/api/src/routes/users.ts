import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { userCreateSchema, userUpdateSchema } from '@resto/shared';
import { audit } from '../auth.js';
import type { Ctx } from '../context.js';
import { idParam } from '../crud.js';
import type { Queryable } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';

const PUBLIC_COLUMNS = `id, username, full_name, role, is_active, (pin_hash is not null) as has_pin,
  (locked_until is not null and locked_until > now()) as is_locked, created_at`;

/** Garde-fou : on ne doit jamais se retrouver sans gérant actif. */
async function assertAnotherManager(q: Queryable, excludingId: string) {
  const { rows } = await q.query<{ n: number }>(
    `select count(*)::int as n from app_users where role = 'manager' and is_active and id <> $1`,
    [excludingId],
  );
  if (!rows[0]!.n) throw conflict('Il doit rester au moins un gérant actif', 'LAST_MANAGER');
}

export function userRoutes(app: FastifyInstance, ctx: Ctx) {
  const guard = { preHandler: ctx.auth.require('admin') };

  app.get('/users', guard, async () =>
    (await ctx.db.query(`select ${PUBLIC_COLUMNS} from app_users order by role, lower(username)`)).rows,
  );

  app.post('/users', guard, async (req, reply) => {
    const b = userCreateSchema.parse(req.body);
    if (b.role === 'manager' && b.pin) throw badRequest('Le PIN est réservé aux caissiers');
    const id = randomUUID();
    const passwordHash = b.password ? await ctx.auth.hashPassword(b.password) : null;
    const pinHash = b.pin ? await ctx.auth.hashPin(id, b.pin) : null;
    const row = await ctx.db.tx(async (q) => {
      await q.query(
        `insert into app_users (id, username, full_name, role, password_hash, pin_hash, is_active)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, b.username, b.full_name, b.role, passwordHash, pinHash, b.is_active ?? true],
      );
      await audit(q, req.user, 'user.create', 'user', id, { username: b.username, role: b.role });
      return (await q.query(`select ${PUBLIC_COLUMNS} from app_users where id = $1`, [id])).rows[0];
    });
    return reply.status(201).send(row);
  });

  app.patch('/users/:id', guard, async (req) => {
    const id = idParam(req);
    const b = userUpdateSchema.parse(req.body);
    return ctx.db.tx(async (q) => {
      const cur = (await q.query<{ role: string; is_active: boolean }>('select role, is_active from app_users where id = $1 for update', [id])).rows[0];
      if (!cur) throw notFound();
      const newRole = b.role ?? cur.role;
      const newActive = b.is_active ?? cur.is_active;
      if (newRole === 'manager' && b.pin) throw badRequest('Le PIN est réservé aux caissiers');
      if (cur.role === 'manager' && (newRole !== 'manager' || !newActive)) await assertAnotherManager(q, id);

      const sets: string[] = [];
      const vals: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      if (b.username !== undefined) set('username', b.username);
      if (b.full_name !== undefined) set('full_name', b.full_name);
      if (b.role !== undefined) set('role', b.role);
      if (b.is_active !== undefined) set('is_active', b.is_active);
      const secretChanged = !!b.password || !!b.pin;
      if (b.password) set('password_hash', await ctx.auth.hashPassword(b.password));
      if (b.pin) set('pin_hash', await ctx.auth.hashPin(id, b.pin));
      // Changement de rôle / désactivation / nouveau secret => révocation des sessions ouvertes
      if (secretChanged || b.role !== undefined || b.is_active === false) sets.push('token_version = token_version + 1');
      if (secretChanged) sets.push('failed_attempts = 0', 'locked_until = null');
      if (!sets.length) throw badRequest('Aucune modification');

      await q.query(`update app_users set ${sets.join(', ')} where id = $1`, vals);
      await audit(q, req.user, 'user.update', 'user', id, { ...b, password: b.password ? '***' : undefined, pin: b.pin ? '***' : undefined });
      return (await q.query(`select ${PUBLIC_COLUMNS} from app_users where id = $1`, [id])).rows[0];
    });
  });

  app.post('/users/:id/unlock', guard, async (req, reply) => {
    const id = idParam(req);
    const r = await ctx.db.query('update app_users set failed_attempts = 0, locked_until = null where id = $1', [id]);
    if (!r.rowCount) throw notFound();
    await audit(ctx.db, req.user, 'user.unlock', 'user', id);
    return reply.status(204).send();
  });

  app.delete('/users/:id', guard, async (req, reply) => {
    const id = idParam(req);
    if (id === req.user.id) throw badRequest('Vous ne pouvez pas supprimer votre propre compte');
    await ctx.db.tx(async (q) => {
      const cur = (await q.query<{ role: string }>('select role from app_users where id = $1 for update', [id])).rows[0];
      if (!cur) throw notFound();
      if (cur.role === 'manager') await assertAnotherManager(q, id);
      await q.query('delete from app_users where id = $1', [id]); // FK violée si des commandes existent => 409, désactiver à la place
      await audit(q, req.user, 'user.delete', 'user', id);
    });
    return reply.status(204).send();
  });
}
