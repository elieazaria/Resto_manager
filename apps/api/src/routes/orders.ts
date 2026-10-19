import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { can, dateSchema, idSchema, orderPutSchema, payOrderSchema, todayInTz, voidOrderSchema, type OrderDto } from '@resto/shared';
import type { Ctx } from '../context.js';
import { idParam } from '../crud.js';
import { forbidden, HttpError } from '../errors.js';
import { cancelOpenOrder, getOrder, listOrders, payOrder, putOrder, voidPaidOrder } from '../services/orders.js';

const listQuery = z.object({
  status: z.enum(['open', 'paid', 'cancelled']).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  table_id: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export function orderRoutes(app: FastifyInstance, ctx: Ctx) {
  const notify = (o: OrderDto) => {
    ctx.hub.broadcast({ type: 'order.changed', order_id: o.id, table_id: o.table_id, status: o.status });
    if (o.status !== 'open') ctx.hub.broadcast({ type: 'stock.changed' }, ['manager']);
  };

  /** Le caissier ne voit que les commandes ouvertes et celles du jour ; le gérant tout l'historique. */
  const today = () => todayInTz(ctx.cfg.APP_TZ);
  const assertVisible = (user: { role: 'manager' | 'cashier' }, o: OrderDto) => {
    if (user.role === 'manager') return;
    const day = o.business_date ?? todayInTz(ctx.cfg.APP_TZ, new Date(o.created_at));
    if (o.status !== 'open' && day !== today()) throw forbidden();
  };

  app.get('/orders', { preHandler: ctx.auth.require('orders:read') }, async (req) => {
    const f = listQuery.parse(req.query);
    return listOrders(ctx.db, ctx.cfg.APP_TZ, {
      ...f,
      restrictToDay: req.user.role === 'cashier' ? today() : undefined,
    });
  });

  app.get('/orders/:id', { preHandler: ctx.auth.require('orders:read') }, async (req) => {
    const o = await getOrder(ctx.db, idParam(req));
    assertVisible(req.user, o);
    return o;
  });

  /** Création/mise à jour idempotente (identifiant fourni par le client). */
  app.put('/orders/:id', { preHandler: ctx.auth.require('orders:write') }, async (req) => {
    const id = idParam(req);
    const body = orderPutSchema.parse(req.body);
    const order = await ctx.db.tx((q) => putOrder(q, req.user, id, body));
    notify(order);
    return order;
  });

  app.post('/orders/:id/pay', { preHandler: ctx.auth.require('orders:pay') }, async (req) => {
    const id = idParam(req);
    const body = payOrderSchema.parse(req.body);
    const { order, changed } = await ctx.db.tx((q) => payOrder(q, req.user, id, body, ctx.cfg.APP_TZ));
    if (changed) notify(order);
    return order;
  });

  app.post('/orders/:id/cancel', { preHandler: ctx.auth.require('orders:write') }, async (req) => {
    const order = await ctx.db.tx((q) => cancelOpenOrder(q, req.user, idParam(req)));
    notify(order);
    return order;
  });

  /** Annulation d'une vente encaissée : réservée au gérant. */
  app.post('/orders/:id/void', { preHandler: ctx.auth.require('orders:void') }, async (req) => {
    if (!can(req.user.role, 'orders:void')) throw new HttpError(403, 'FORBIDDEN', 'Accès refusé');
    const { reason } = voidOrderSchema.parse(req.body);
    const order = await ctx.db.tx((q) => voidPaidOrder(q, req.user, idParam(req), reason));
    notify(order);
    return order;
  });
}
