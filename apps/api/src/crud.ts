import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { idSchema } from '@resto/shared';
import { audit, type AuthUser } from './auth.js';
import type { Ctx } from './context.js';
import type { Queryable } from './db.js';
import { notFound } from './errors.js';

export const idParam = (req: { params: unknown }) => idSchema.parse((req.params as { id?: string }).id);

interface CrudOptions {
  path: string; // ex. '/categories'
  table: string;
  entity: string;
  createSchema: z.ZodType<Record<string, unknown>>;
  updateSchema: z.ZodType<Record<string, unknown>>;
  /** Liste SQL des colonnes (alias de table : t). */
  select?: string;
  joins?: string;
  orderBy: string;
  /** Colonnes ajoutées à la création (ex. created_by). */
  onCreateExtra?: (user: AuthUser) => Record<string, unknown>;
  /** Hooks exécutés dans la même transaction. */
  onSaved?: (q: Queryable, id: string, user: AuthUser) => Promise<void>;
  onDeleting?: (q: Queryable, id: string) => Promise<void>;
  /** Appelé après le commit (diffusion temps réel…). */
  afterCommit?: (ctx: Ctx) => void;
}

/** Fabrique de routes CRUD réservées au gérant (permission `admin`). Les colonnes viennent du schéma Zod, jamais de la requête brute. */
export function registerCrud(app: FastifyInstance, ctx: Ctx, o: CrudOptions) {
  const guard = { preHandler: ctx.auth.require('admin') };
  const select = o.select ?? 't.*';
  const base = `select ${select} from ${o.table} t ${o.joins ?? ''}`;

  const fetchOne = async (q: Queryable, id: string) => {
    const { rows } = await q.query(`${base} where t.id = $1`, [id]);
    if (!rows[0]) throw notFound();
    return rows[0];
  };

  app.get(o.path, guard, async () => (await ctx.db.query(`${base} order by ${o.orderBy}`)).rows);

  app.get(`${o.path}/:id`, guard, async (req) => fetchOne(ctx.db, idParam(req)));

  app.post(o.path, guard, async (req, reply) => {
    const data = { ...o.createSchema.parse(req.body), ...o.onCreateExtra?.(req.user) };
    const cols = Object.keys(data).filter((k) => data[k] !== undefined);
    const row = await ctx.db.tx(async (q) => {
      const sql = cols.length
        ? `insert into ${o.table} (${cols.map((c) => `"${c}"`).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning id`
        : `insert into ${o.table} default values returning id`;
      const { rows } = await q.query<{ id: string }>(sql, cols.map((c) => data[c]));
      const id = rows[0]!.id;
      await o.onSaved?.(q, id, req.user);
      await audit(q, req.user, `${o.entity}.create`, o.entity, id);
      return fetchOne(q, id);
    });
    o.afterCommit?.(ctx);
    return reply.status(201).send(row);
  });

  app.patch(`${o.path}/:id`, guard, async (req) => {
    const id = idParam(req);
    const data = o.updateSchema.parse(req.body);
    const cols = Object.keys(data).filter((k) => data[k] !== undefined);
    if (!cols.length) throw notFound('Aucune modification');
    const row = await ctx.db.tx(async (q) => {
      const r = await q.query(
        `update ${o.table} set ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(',')} where id = $1`,
        [id, ...cols.map((c) => data[c])],
      );
      if (!r.rowCount) throw notFound();
      await o.onSaved?.(q, id, req.user);
      await audit(q, req.user, `${o.entity}.update`, o.entity, id, data);
      return fetchOne(q, id);
    });
    o.afterCommit?.(ctx);
    return row;
  });

  app.delete(`${o.path}/:id`, guard, async (req, reply) => {
    const id = idParam(req);
    await ctx.db.tx(async (q) => {
      await o.onDeleting?.(q, id);
      const r = await q.query(`delete from ${o.table} where id = $1`, [id]);
      if (!r.rowCount) throw notFound();
      await audit(q, req.user, `${o.entity}.delete`, o.entity, id);
    });
    o.afterCommit?.(ctx);
    return reply.status(204).send();
  });
}
