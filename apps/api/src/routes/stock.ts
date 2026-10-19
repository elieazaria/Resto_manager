import type { FastifyInstance } from 'fastify';
import { purchaseSchema, stockAdjustSchema, stockItemSchema, supplierSchema, expenseSchema, type StockRowDto } from '@resto/shared';
import { z } from 'zod';
import { audit } from '../auth.js';
import type { Ctx } from '../context.js';
import { registerCrud } from '../crud.js';
import { notFound } from '../errors.js';
import { STOCK_LEVELS_SQL, syncPurchaseMovement } from '../services/stock.js';

export function stockRoutes(app: FastifyInstance, ctx: Ctx) {
  const notifyStock = (c: Ctx) => c.hub.broadcast({ type: 'stock.changed' }, ['manager']);
  const admin = { preHandler: ctx.auth.require('admin') };

  registerCrud(app, ctx, {
    path: '/stock-items',
    table: 'stock_items',
    entity: 'stock_item',
    createSchema: stockItemSchema,
    updateSchema: stockItemSchema.partial(),
    orderBy: 't.kind, lower(t.name)',
    afterCommit: notifyStock,
  });

  registerCrud(app, ctx, {
    path: '/suppliers',
    table: 'suppliers',
    entity: 'supplier',
    createSchema: supplierSchema,
    updateSchema: supplierSchema.partial(),
    orderBy: 'lower(t.name)',
  });

  registerCrud(app, ctx, {
    path: '/purchases',
    table: 'purchases',
    entity: 'purchase',
    createSchema: purchaseSchema,
    updateSchema: purchaseSchema.partial(),
    select: `t.*, s.name as stock_item_name, s.purchase_unit, sp.name as supplier_name,
             round(t.quantity * t.unit_price)::bigint as amount`,
    joins: 'join stock_items s on s.id = t.stock_item_id left join suppliers sp on sp.id = t.supplier_id',
    orderBy: 't.date desc, t.created_at desc',
    onCreateExtra: (u) => ({ created_by: u.id }),
    onSaved: (q, id, user) => syncPurchaseMovement(q, id, user.id),
    onDeleting: async (q, id) => {
      await q.query(`delete from stock_movements where ref_id = $1 and reason = 'purchase'`, [id]);
    },
    afterCommit: notifyStock,
  });

  registerCrud(app, ctx, {
    path: '/expenses',
    table: 'expenses',
    entity: 'expense',
    createSchema: expenseSchema,
    updateSchema: expenseSchema.partial(),
    orderBy: 't.date desc, t.created_at desc',
    onCreateExtra: (u) => ({ created_by: u.id }),
  });

  /* ── Niveaux de stock + alertes ── */
  app.get('/stock', admin, async (): Promise<StockRowDto[]> =>
    (await ctx.db.query<StockRowDto>(`${STOCK_LEVELS_SQL} order by low desc, s.kind, lower(s.name)`)).rows,
  );

  /** Inventaire : on saisit la quantité comptée, l'API enregistre l'écart comme mouvement « adjustment ». */
  app.post('/stock/adjust', admin, async (req) => {
    const b = stockAdjustSchema.parse(req.body);
    const result = await ctx.db.tx(async (q) => {
      const item = (await q.query('select id from stock_items where id = $1 for update', [b.stock_item_id])).rows[0];
      if (!item) throw notFound('Article de stock introuvable');
      const cur = (
        await q.query<{ qty: number }>('select coalesce(sum(qty),0)::float8 as qty from stock_movements where stock_item_id = $1', [b.stock_item_id])
      ).rows[0]!.qty;
      const delta = Math.round((b.counted - cur) * 1000) / 1000;
      if (delta !== 0) {
        await q.query(
          `insert into stock_movements (stock_item_id, qty, reason, note, created_by) values ($1,$2,'adjustment',$3,$4)`,
          [b.stock_item_id, delta, b.note ?? 'Inventaire', req.user.id],
        );
        await audit(q, req.user, 'stock.adjust', 'stock_item', b.stock_item_id, { from: cur, to: b.counted });
      }
      return { stock_item_id: b.stock_item_id, previous: cur, counted: b.counted, delta };
    });
    notifyStock(ctx);
    return result;
  });

  app.get('/stock/movements', admin, async (req) => {
    const q = z
      .object({
        stock_item_id: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    const { rows } = await ctx.db.query(
      `select m.id, m.created_at, m.qty::float8 as qty, m.reason, m.note, s.name as stock_item_name, s.unit,
              u.full_name as user_name
       from stock_movements m
       join stock_items s on s.id = m.stock_item_id
       left join app_users u on u.id = m.created_by
       where ($1::uuid is null or m.stock_item_id = $1)
       order by m.created_at desc limit $2`,
      [q.stock_item_id ?? null, q.limit],
    );
    return rows;
  });
}
