import type { FastifyInstance } from 'fastify';
import { backdatedSaleSchema, todayInTz } from '@resto/shared';
import { audit } from '../auth.js';
import type { Ctx } from '../context.js';
import { badRequest } from '../errors.js';
import { getOrder } from '../services/orders.js';

/**
 * Saisie d'une vente passée (gérant). La vente est créée directement « payée » à la date choisie,
 * aux prix actuels du menu, et décrémente le stock via les recettes (au jour de la vente) si demandé.
 */
export function backSalesRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post('/sales/backdated', { preHandler: ctx.auth.require('admin') }, async (req, reply) => {
    const b = backdatedSaleSchema.parse(req.body);
    const tz = ctx.cfg.APP_TZ;
    if (b.date > todayInTz(tz)) throw badRequest('La date ne peut pas être dans le futur');

    const order = await ctx.db.tx(async (q) => {
      const ids = [...new Set(b.lines.map((l) => l.menu_item_id))];
      const items = (await q.query<{ id: string; name: string; price: number }>(
        `select id, name, price from menu_items where id = any(string_to_array($1, ',')::uuid[])`, [ids.join(',')])).rows;
      if (items.length !== ids.length) throw badRequest('Plat introuvable');
      const price = new Map(items.map((i) => [i.id, i]));
      const total = b.lines.reduce((s, l) => s + price.get(l.menu_item_id)!.price * l.quantity, 0);
      const table = (await q.query<{ id: string }>('select id from restaurant_tables order by is_active desc, sort_order limit 1')).rows[0];
      if (!table) throw badRequest('Créez au moins une table avant de saisir des ventes');

      // 12 h 00, heure du restaurant, le jour choisi
      const at = `(($1::date + time '12:00') at time zone $2)`;
      const id = (await q.query<{ id: string }>(
        `insert into orders (table_id, status, total, payment_method, amount_received, business_date, note, opened_by, paid_by, created_at, updated_at, paid_at)
         values ($3, 'paid', $4, $5, $4, $1::date, $6, $7, $7, ${at}, ${at}, ${at}) returning id`,
        [b.date, tz, table.id, total, b.payment_method, b.note ?? 'Saisie antérieure', req.user.id])).rows[0]!.id;
      for (const l of b.lines) {
        const m = price.get(l.menu_item_id)!;
        await q.query('insert into order_lines (order_id, menu_item_id, name, unit_price, quantity) values ($1,$2,$3,$4,$5)', [id, m.id, m.name, m.price, l.quantity]);
      }
      if (b.update_stock) {
        await q.query(
          `insert into stock_movements (stock_item_id, qty, reason, ref_id, created_by, note, created_at)
           select stock_item_id, -sum(qty), 'sale', $1::uuid, $2::uuid, 'Vente antérieure', ${at.replace('$1', '$3').replace('$2', '$4')}
           from (
             select r.stock_item_id, r.qty_per_portion * l.quantity as qty from order_lines l join recipes r on r.menu_item_id = l.menu_item_id where l.order_id = $1
             union all
             select m.stock_item_id, l.quantity * m.stock_qty from order_lines l join menu_items m on m.id = l.menu_item_id where l.order_id = $1 and m.kind = 'resale' and m.stock_item_id is not null
           ) x group by stock_item_id`,
          [id, req.user.id, b.date, tz]);
      }
      await audit(q, req.user, 'order.backdated', 'order', id, { date: b.date, total, method: b.payment_method, stock: b.update_stock });
      return getOrder(q, id);
    });
    return reply.status(201).send(order);
  });
}
