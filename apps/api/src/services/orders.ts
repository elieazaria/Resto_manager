import type { z } from 'zod';
import { orderPutSchema, payOrderSchema, type OrderDto, type OrderLineDto } from '@resto/shared';
import { audit, type AuthUser } from '../auth.js';
import type { Queryable } from '../db.js';
import { HttpError, conflict, notFound } from '../errors.js';

type OrderPut = z.infer<typeof orderPutSchema>;
type PayInput = z.infer<typeof payOrderSchema>;

const ORDER_SELECT = `
  select o.id, o.ticket_no, o.table_id, t.name as table_name, o.status, o.note, o.total,
         o.payment_method, o.amount_received, o.business_date, o.created_at, o.paid_at,
         ou.full_name as opened_by_name, pu.full_name as paid_by_name, o.void_reason
  from orders o
  join restaurant_tables t on t.id = o.table_id
  left join app_users ou on ou.id = o.opened_by
  left join app_users pu on pu.id = o.paid_by`;

export async function attachLines(q: Queryable, orders: Omit<OrderDto, 'lines'>[]): Promise<OrderDto[]> {
  if (!orders.length) return [];
  const { rows } = await q.query<OrderLineDto & { order_id: string }>(
    `select id, order_id, menu_item_id, name, unit_price, quantity, note
     from order_lines where order_id = any($1::uuid[]) order by id`,
    [orders.map((o) => o.id)],
  );
  const byOrder = new Map<string, OrderLineDto[]>();
  for (const l of rows) {
    const { order_id, ...line } = l;
    (byOrder.get(order_id) ?? byOrder.set(order_id, []).get(order_id)!).push(line);
  }
  return orders.map((o) => ({ ...o, lines: byOrder.get(o.id) ?? [] }));
}

export async function getOrder(q: Queryable, id: string): Promise<OrderDto> {
  const { rows } = await q.query<Omit<OrderDto, 'lines'>>(`${ORDER_SELECT} where o.id = $1`, [id]);
  if (!rows[0]) throw notFound('Commande introuvable');
  return (await attachLines(q, rows))[0]!;
}

export interface OrderFilter {
  status?: 'open' | 'paid' | 'cancelled';
  from?: string;
  to?: string;
  table_id?: string;
  limit: number;
  /** Caissier : uniquement les commandes ouvertes + celles encaissées ce jour. */
  restrictToDay?: string;
}

export async function listOrders(q: Queryable, tz: string, f: OrderFilter): Promise<OrderDto[]> {
  const where: string[] = [];
  const params: unknown[] = [tz];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  // jour comptable : date de paiement, ou date de création pour une commande non encaissée
  const day = `coalesce(o.business_date, (o.created_at at time zone $1)::date)`;
  if (f.status) add('o.status = ?', f.status);
  if (f.from) add(`${day} >= ?::date`, f.from);
  if (f.to) add(`${day} <= ?::date`, f.to);
  if (f.table_id) add('o.table_id = ?', f.table_id);
  if (f.restrictToDay) {
    params.push(f.restrictToDay);
    where.push(`(o.status = 'open' or ${day} = $${params.length}::date)`);
  }
  params.push(f.limit);
  const { rows } = await q.query<Omit<OrderDto, 'lines'>>(
    `${ORDER_SELECT} ${where.length ? 'where ' + where.join(' and ') : ''}
     order by o.created_at desc limit $${params.length}`,
    params,
  );
  return attachLines(q, rows);
}

/**
 * Création / mise à jour IDEMPOTENTE d'une commande ouverte (l'identifiant est choisi par le client :
 * indispensable pour rejouer sans doublon une commande saisie hors-ligne).
 * Les prix sont toujours ceux du menu côté serveur.
 */
export async function putOrder(q: Queryable, user: AuthUser, id: string, input: OrderPut): Promise<OrderDto> {
  const existing = (
    await q.query<{ status: string; table_id: string }>('select status, table_id from orders where id = $1 for update', [id])
  ).rows[0];
  if (existing && existing.status !== 'open') {
    throw conflict(`Commande déjà ${existing.status === 'paid' ? 'encaissée' : 'annulée'}`, 'ORDER_CLOSED', { status: existing.status });
  }
  if (existing && existing.table_id !== input.table_id) throw conflict('Changement de table non supporté', 'TABLE_CHANGE');

  const table = (await q.query('select 1 from restaurant_tables where id = $1 and is_active', [input.table_id])).rows[0];
  if (!table) throw new HttpError(422, 'TABLE_UNAVAILABLE', 'Table introuvable ou désactivée');

  const ids = [...new Set(input.lines.map((l) => l.menu_item_id))];
  const items = (
    await q.query<{ id: string; name: string; price: number }>(
      'select id, name, price from menu_items where id = any($1::uuid[]) and is_active',
      [ids],
    )
  ).rows;
  const byId = new Map(items.map((i) => [i.id, i]));
  const missing = ids.filter((i) => !byId.has(i));
  if (missing.length) throw new HttpError(422, 'ITEM_UNAVAILABLE', 'Un article de la commande est indisponible', { missing });

  if (!existing) {
    const dup = (
      await q.query<{ id: string }>(`select id from orders where table_id = $1 and status = 'open'`, [input.table_id])
    ).rows[0];
    if (dup) throw conflict('Cette table a déjà une commande ouverte', 'TABLE_BUSY', { order_id: dup.id });
    await q.query('insert into orders (id, table_id, opened_by, note) values ($1,$2,$3,$4)', [
      id,
      input.table_id,
      user.id,
      input.note ?? null,
    ]);
  } else {
    await q.query('delete from order_lines where order_id = $1', [id]);
  }

  let total = 0;
  for (const l of input.lines) {
    const item = byId.get(l.menu_item_id)!;
    total += item.price * l.quantity;
    await q.query(
      'insert into order_lines (order_id, menu_item_id, name, unit_price, quantity, note) values ($1,$2,$3,$4,$5,$6)',
      [id, item.id, item.name, item.price, l.quantity, l.note ?? null],
    );
  }
  await q.query('update orders set total = $2, note = $3, updated_at = now() where id = $1', [id, total, input.note ?? null]);
  return getOrder(q, id);
}

/** Encaissement : fige la vente, la date comptable (fuseau du restaurant) et décrémente le stock via les recettes. */
export async function payOrder(
  q: Queryable,
  user: AuthUser,
  id: string,
  input: PayInput,
  tz: string,
): Promise<{ order: OrderDto; changed: boolean }> {
  const cur = (await q.query<{ status: string; total: number }>('select status, total from orders where id = $1 for update', [id])).rows[0];
  if (!cur) throw notFound('Commande introuvable');
  if (cur.status === 'paid') return { order: await getOrder(q, id), changed: false }; // rejouable sans effet
  if (cur.status === 'cancelled') throw conflict('Commande annulée', 'ORDER_CLOSED');
  if (cur.total <= 0) throw new HttpError(422, 'EMPTY_ORDER', 'Commande vide');

  const received = input.method === 'cash' ? (input.amount_received ?? cur.total) : cur.total;
  if (input.method === 'cash' && received < cur.total) {
    throw new HttpError(422, 'INSUFFICIENT_AMOUNT', 'Montant reçu inférieur au total');
  }

  await q.query(
    `update orders set status = 'paid', paid_at = now(), business_date = (now() at time zone $5)::date,
            payment_method = $2, amount_received = $3, paid_by = $4, updated_at = now()
     where id = $1`,
    [id, input.method, received, user.id, tz],
  );

  // Consommation = recettes des plats cuisinés + produits revendus tels quels
  await q.query(
    `insert into stock_movements (stock_item_id, qty, reason, ref_id, created_by, note)
     select stock_item_id, -sum(qty), 'sale', $1::uuid, $2::uuid, 'Vente'
     from (
       select r.stock_item_id, r.qty_per_portion * l.quantity as qty
       from order_lines l join recipes r on r.menu_item_id = l.menu_item_id
       where l.order_id = $1
       union all
       select m.stock_item_id, l.quantity::numeric as qty
       from order_lines l join menu_items m on m.id = l.menu_item_id
       where l.order_id = $1 and m.kind = 'resale' and m.stock_item_id is not null
     ) x group by stock_item_id`,
    [id, user.id],
  );
  await audit(q, user, 'order.pay', 'order', id, { method: input.method, total: cur.total });
  return { order: await getOrder(q, id), changed: true };
}

/** Annule une commande ouverte (sans impact stock). */
export async function cancelOpenOrder(q: Queryable, user: AuthUser, id: string): Promise<OrderDto> {
  const cur = (await q.query<{ status: string }>('select status from orders where id = $1 for update', [id])).rows[0];
  if (!cur) throw notFound('Commande introuvable');
  if (cur.status === 'cancelled') return getOrder(q, id);
  if (cur.status === 'paid') throw conflict('Commande déjà encaissée : seul le gérant peut l\'annuler (avec motif)', 'ORDER_CLOSED');
  await q.query(`update orders set status = 'cancelled', updated_at = now() where id = $1`, [id]);
  await audit(q, user, 'order.cancel', 'order', id);
  return getOrder(q, id);
}

/** Annulation d'une vente encaissée (gérant) : le stock consommé est restitué. */
export async function voidPaidOrder(q: Queryable, user: AuthUser, id: string, reason: string): Promise<OrderDto> {
  const cur = (await q.query<{ status: string }>('select status from orders where id = $1 for update', [id])).rows[0];
  if (!cur) throw notFound('Commande introuvable');
  if (cur.status !== 'paid') throw conflict('Seule une vente encaissée peut être annulée', 'NOT_PAID');
  await q.query(
    `update orders set status = 'cancelled', void_reason = $2, voided_by = $3, voided_at = now(), updated_at = now() where id = $1`,
    [id, reason, user.id],
  );
  await q.query(
    `insert into stock_movements (stock_item_id, qty, reason, ref_id, created_by, note)
     select stock_item_id, -qty, 'void', ref_id, $2::uuid, 'Annulation de vente'
     from stock_movements where ref_id = $1 and reason = 'sale'`,
    [id, user.id],
  );
  await audit(q, user, 'order.void', 'order', id, { reason });
  return getOrder(q, id);
}
