import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  HOTEL_RES_STATUSES,
  dateSchema,
  hotelClientSchema,
  hotelPaymentSchema,
  hotelServiceSchema,
  hotelSettingsSchema,
  idSchema,
  rateRuleSchema,
  rateRulePatchSchema,
  reservationCreateSchema,
  reservationGroupSchema,
  reservationStatusSchema,
  reservationUpdateSchema,
  roomSchema,
  roomTypeSchema,
} from '@resto/shared';
import { audit } from '../auth.js';
import type { Ctx } from '../context.js';
import { idParam, registerCrud } from '../crud.js';
import { notFound } from '../errors.js';
import {
  addPayment,
  createGroupReservation,
  createReservation,
  deletePayment,
  deleteReservation,
  getHotelSettings,
  getReservation,
  hotelDashboard,
  listRooms,
  loadDemo,
  clearDemo,
  loadReservations,
  quoteStay,
  saveHotelSettings,
  setReservationStatus,
  updateReservation,
  ensureHotelBase,
} from '../services/hotel.js';

export function hotelRoutes(app: FastifyInstance, ctx: Ctx) {
  const admin = { preHandler: ctx.auth.require('admin') };
  const tz = ctx.cfg.APP_TZ;

  registerCrud(app, ctx, {
    path: '/hotel/room-types', table: 'hotel_room_types', entity: 'hotel_room_type',
    createSchema: roomTypeSchema, updateSchema: roomTypeSchema.partial(),
    select: 't.*, (select count(*)::int from hotel_rooms r where r.room_type_id = t.id) as room_count',
    orderBy: 't.sort_order, lower(t.name)',
  });
  registerCrud(app, ctx, {
    path: '/hotel/services', table: 'hotel_services', entity: 'hotel_service',
    createSchema: hotelServiceSchema, updateSchema: hotelServiceSchema.partial(), orderBy: 't.sort_order, lower(t.name)',
  });
  registerCrud(app, ctx, {
    path: '/hotel/rate-rules', table: 'hotel_rate_rules', entity: 'hotel_rate_rule',
    createSchema: rateRuleSchema as any, updateSchema: rateRulePatchSchema as any,
    select: 't.*, ty.name as room_type_name', joins: 'left join hotel_room_types ty on ty.id = t.room_type_id',
    orderBy: 't.date_from desc, t.priority desc',
  });
  registerCrud(app, ctx, {
    path: '/hotel/clients', table: 'hotel_clients', entity: 'hotel_client',
    createSchema: hotelClientSchema, updateSchema: hotelClientSchema.partial(),
    select: `t.*, (select count(*)::int from hotel_reservations r where r.client_id = t.id) as reservation_count`,
    orderBy: 'lower(t.full_name)',
  });

  /* Chambres : liste en temps réel + CRUD manuel */
  app.get('/hotel/rooms', admin, async () => listRooms(ctx.db, tz));
  app.post('/hotel/rooms', admin, async (req, reply) => {
    const b = roomSchema.parse(req.body);
    const id = await ctx.db.tx(async (q) => {
      const { rows } = await q.query<{ id: string }>(
        'insert into hotel_rooms (number, room_type_id, capacity, price, tech_status, is_active, notes, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
        [b.number, b.room_type_id, b.capacity ?? null, b.price ?? null, b.tech_status, b.is_active, b.notes ?? null, b.sort_order],
      );
      await audit(q, req.user, 'hotel_room.create', 'hotel_room', rows[0]!.id);
      return rows[0]!.id;
    });
    return reply.status(201).send((await listRooms(ctx.db, tz, id))[0]);
  });
  app.patch('/hotel/rooms/:id', admin, async (req) => {
    const id = idParam(req);
    const b = roomSchema.partial().parse(req.body);
    const cols = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
    if (cols.length) {
      await ctx.db.tx(async (q) => {
        const r = await q.query(`update hotel_rooms set ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(',')} where id = $1`, [id, ...cols.map((c) => (b as any)[c])]);
        if (!r.rowCount) throw notFound('Chambre introuvable');
        await audit(q, req.user, 'hotel_room.update', 'hotel_room', id, b);
      });
    }
    const room = (await listRooms(ctx.db, tz, id))[0];
    if (!room) throw notFound('Chambre introuvable');
    return room;
  });
  app.delete('/hotel/rooms/:id', admin, async (req, reply) => {
    const id = idParam(req);
    await ctx.db.tx(async (q) => {
      const used = await q.query('select 1 from hotel_reservations where room_id = $1 limit 1', [id]);
      if (used.rows.length) {
        await q.query('update hotel_rooms set is_active = false where id = $1', [id]); // historique conservé
      } else {
        await q.query('delete from hotel_rooms where id = $1', [id]);
      }
      await audit(q, req.user, 'hotel_room.delete', 'hotel_room', id);
    });
    return reply.status(204).send();
  });

  /* Réservations */
  const listQuery = z.object({
    from: dateSchema.optional(), to: dateSchema.optional(),
    status: z.string().optional(), client_id: idSchema.optional(), room_id: idSchema.optional(), q: z.string().trim().max(80).optional(),
  });
  app.get('/hotel/reservations', admin, async (req) => {
    const f = listQuery.parse(req.query);
    const status = f.status ? z.array(z.enum(HOTEL_RES_STATUSES)).parse(f.status.split(',')) : undefined;
    return loadReservations(ctx.db, { from: f.from, to: f.to, status, clientId: f.client_id, roomId: f.room_id, search: f.q || undefined });
  });
  app.get('/hotel/reservations/:id', admin, async (req) => getReservation(ctx.db, idParam(req)));
  app.post('/hotel/reservations', admin, async (req, reply) => {
    const b = reservationCreateSchema.parse(req.body);
    return reply.status(201).send(await ctx.db.tx((q) => createReservation(q, req.user, b, tz)));
  });
  app.post('/hotel/reservations/group', admin, async (req, reply) => {
    const b = reservationGroupSchema.parse(req.body);
    return reply.status(201).send(await ctx.db.tx((q) => createGroupReservation(q, req.user, b, tz)));
  });
  app.patch('/hotel/reservations/:id', admin, async (req) => {
    const b = reservationUpdateSchema.parse(req.body);
    return ctx.db.tx((q) => updateReservation(q, req.user, idParam(req), b));
  });
  app.post('/hotel/reservations/:id/status', admin, async (req) => {
    const b = reservationStatusSchema.parse(req.body);
    return ctx.db.tx((q) => setReservationStatus(q, req.user, idParam(req), b.status, b.reason, tz));
  });
  app.post('/hotel/reservations/:id/payments', admin, async (req, reply) => {
    const b = hotelPaymentSchema.parse(req.body);
    return reply.status(201).send(await ctx.db.tx((q) => addPayment(q, req.user, idParam(req), b, tz)));
  });
  app.delete('/hotel/reservations/:id/payments/:pid', admin, async (req) => {
    const pid = idSchema.parse((req.params as any).pid);
    return ctx.db.tx((q) => deletePayment(q, req.user, idParam(req), pid));
  });
  app.delete('/hotel/reservations/:id', admin, async (req, reply) => {
    await ctx.db.tx((q) => deleteReservation(q, req.user, idParam(req)));
    return reply.status(204).send();
  });

  /* Prix dynamique */
  app.get('/hotel/quote', admin, async (req) => {
    const b = z.object({ room_id: idSchema, arrival: dateSchema, departure: dateSchema }).parse(req.query);
    return quoteStay(ctx.db, b.room_id, b.arrival, b.departure);
  });

  /* Compte client */
  app.get('/hotel/clients/:id/account', admin, async (req) => {
    const id = idParam(req);
    const client = (await ctx.db.query('select * from hotel_clients where id = $1', [id])).rows[0];
    if (!client) throw notFound('Client introuvable');
    const reservations = await loadReservations(ctx.db, { clientId: id });
    const live = reservations.filter((r) => r.status !== 'cancelled');
    return {
      client,
      reservations,
      totals: {
        billed: live.reduce((s, r) => s + r.net_amount, 0),
        paid: reservations.reduce((s, r) => s + r.paid_amount, 0),
        balance: live.reduce((s, r) => s + Math.max(0, r.balance), 0),
      },
    };
  });

  app.get('/hotel/dashboard', admin, async () => hotelDashboard(ctx.db, tz));

  /* Réglages & démo */
  app.get('/hotel/settings', admin, async () => getHotelSettings(ctx.db));
  app.put('/hotel/settings', admin, async (req) => {
    const b = hotelSettingsSchema.parse(req.body);
    await ctx.db.tx(async (q) => {
      await saveHotelSettings(q, b);
      await audit(q, req.user, 'hotel.settings.update', 'hotel');
    });
    return b;
  });
  app.post('/hotel/demo', admin, async (req) => ctx.db.tx((q) => loadDemo(q, req.user, tz)));
  app.delete('/hotel/demo', admin, async (req) => {
    await ctx.db.tx(async (q) => {
      await clearDemo(q);
      await audit(q, req.user, 'hotel.demo.clear', 'hotel');
    });
    return { ok: true };
  });
  app.post('/hotel/bootstrap', admin, async (req) => {
    await ctx.db.tx((q) => ensureHotelBase(q));
    return { ok: true };
  });
}
