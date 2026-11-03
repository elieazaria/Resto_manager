import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  DEFAULT_HOTEL_SETTINGS,
  HOTEL_ACTIVE_STATUSES,
  hotelSettingsSchema,
  roomLiveStatus,
  todayInTz,
  type HotelDashboardDto,
  type HotelExtraDto,
  type HotelPaymentDto,
  type HotelQuoteDto,
  type HotelReservationDto,
  type HotelResStatus,
  type HotelRoomDto,
  type HotelSettings,
  type RoomLiveStatus,
  hotelPaymentSchema,
  reservationCreateSchema,
  reservationGroupSchema,
  reservationUpdateSchema,
} from '@resto/shared';
import { audit, type AuthUser } from '../auth.js';
import type { Queryable } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';

/* ───────────── Dates (chaînes AAAA-MM-JJ, calcul en UTC pour éviter les décalages de fuseau) ───────────── */
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
export const addDays = (s: string, n: number) => new Date(toDate(s).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const nightsBetween = (a: string, d: string) => Math.round((toDate(d).getTime() - toDate(a).getTime()) / 86_400_000);
const eachNight = (a: string, d: string) => Array.from({ length: nightsBetween(a, d) }, (_, i) => addDays(a, i));
const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const mondayOf = (s: string) => addDays(s, -((toDate(s).getUTCDay() + 6) % 7));

/* ───────────── Réglages ───────────── */
export async function getHotelSettings(q: Queryable): Promise<HotelSettings> {
  const { rows } = await q.query<{ value: unknown }>(`select value from settings where key = 'hotel'`);
  const parsed = hotelSettingsSchema.safeParse(rows[0]?.value ?? {});
  return parsed.success ? parsed.data : DEFAULT_HOTEL_SETTINGS;
}
export async function saveHotelSettings(q: Queryable, s: HotelSettings) {
  await q.query(`insert into settings (key, value) values ('hotel', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(s)]);
}

/* ───────────── Prix dynamique ───────────── */
interface RateRule {
  id: string; name: string; room_type_id: string | null; date_from: string; date_to: string;
  mode: 'fixed' | 'percent'; value: number; weekdays: number[] | null; priority: number;
}

/** Tarif de chaque nuit : tarif de base de la chambre, puis la règle la plus prioritaire (priorité, puis règle propre au type, puis la plus récente). */
export async function quoteStay(q: Queryable, roomId: string, arrival: string, departure: string): Promise<HotelQuoteDto> {
  if (departure <= arrival) throw badRequest('Le départ doit être après l’arrivée');
  const { rows } = await q.query<{ base: number; type_id: string }>(
    `select coalesce(r.price, t.base_price) as base, r.room_type_id as type_id
     from hotel_rooms r join hotel_room_types t on t.id = r.room_type_id where r.id = $1`,
    [roomId],
  );
  if (!rows[0]) throw notFound('Chambre introuvable');
  const { base, type_id } = rows[0];
  const rules = (
    await q.query<RateRule>(
      `select id, name, room_type_id, date_from, date_to, mode, value, weekdays, priority from hotel_rate_rules
       where is_active and date_from <= $2 and date_to >= $1 and (room_type_id is null or room_type_id = $3)`,
      [arrival, addDays(departure, -1), type_id],
    )
  ).rows;
  const nightly = eachNight(arrival, departure).map((date) => {
    const dow = toDate(date).getUTCDay();
    const hit = rules
      .filter((r) => r.date_from <= date && r.date_to >= date && (!r.weekdays?.length || r.weekdays.includes(dow)))
      .sort((a, b) => b.priority - a.priority || Number(!!b.room_type_id) - Number(!!a.room_type_id) || b.date_from.localeCompare(a.date_from))[0];
    const price = !hit ? base : hit.mode === 'fixed' ? hit.value : Math.max(0, Math.round((base * (100 + hit.value)) / 100));
    return { date, price, rule: hit?.name ?? null };
  });
  const total = nightly.reduce((s, n) => s + n.price, 0);
  return { nights: nightly.length, nightly, total, average: Math.round(total / nightly.length), base_price: base };
}

/* ───────────── Lecture des réservations ───────────── */
interface Filter { ids?: string[]; from?: string; to?: string; status?: HotelResStatus[]; clientId?: string; roomId?: string; groupId?: string; search?: string }

export async function loadReservations(q: Queryable, f: Filter = {}): Promise<HotelReservationDto[]> {
  const where: string[] = [];
  const p: unknown[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace(/\?/g, `$${p.length}`)); };
  if (f.ids) add("r.id = any(string_to_array(?, ',')::uuid[])", f.ids.join(','));
  if (f.from) add('r.departure > ?::date', f.from); // chevauche [from, to]
  if (f.to) add('r.arrival <= ?::date', f.to);
  if (f.status?.length) add("r.status::text = any(string_to_array(?, ','))", f.status.join(','));
  if (f.clientId) add('r.client_id = ?', f.clientId);
  if (f.roomId) add('r.room_id = ?', f.roomId);
  if (f.groupId) add('r.group_id = ?', f.groupId);
  if (f.search) add(`(c.full_name ilike ? or r.ref ilike ? or rm.number ilike ?)`, `%${f.search}%`);
  const sql = `select r.id, r.ref, r.group_id, r.client_id, c.full_name as client_name, c.phone as client_phone,
      r.room_id, rm.number as room_number, ty.name as room_type_name, ty.color as room_color,
      r.arrival, r.departure, (r.departure - r.arrival) as nights, r.adults, r.children, r.price_per_night,
      r.tourist_tax, r.discount_percent, r.discount_amount, r.status, r.note, r.cancel_reason,
      r.checked_in_at, r.checked_out_at, r.is_demo, r.created_at
    from hotel_reservations r
    join hotel_clients c on c.id = r.client_id
    join hotel_rooms rm on rm.id = r.room_id
    join hotel_room_types ty on ty.id = rm.room_type_id
    ${where.length ? 'where ' + where.join(' and ') : ''}
    order by r.arrival, rm.sort_order, rm.number`;
  const { rows } = await q.query<any>(sql, p);
  return attachDetails(q, rows);
}

async function attachDetails(q: Queryable, rows: any[]): Promise<HotelReservationDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const extras = (await q.query<any>(`select id, reservation_id, service_id, label, unit_price, quantity, multiplier from hotel_reservation_extras where reservation_id = any(string_to_array($1, ',')::uuid[]) order by label, id`, [ids.join(',')])).rows;
  const pays = (await q.query<any>(`select id, reservation_id, amount, method, kind, paid_on, note, created_at from hotel_payments where reservation_id = any(string_to_array($1, ',')::uuid[]) order by paid_on, created_at, id`, [ids.join(',')])).rows;
  const ex = new Map<string, HotelExtraDto[]>();
  const py = new Map<string, HotelPaymentDto[]>();
  for (const e of extras) (ex.get(e.reservation_id) ?? ex.set(e.reservation_id, []).get(e.reservation_id)!).push({ id: e.id, service_id: e.service_id, label: e.label, unit_price: e.unit_price, quantity: e.quantity, multiplier: e.multiplier, amount: e.unit_price * e.quantity * e.multiplier });
  for (const y of pays) (py.get(y.reservation_id) ?? py.set(y.reservation_id, []).get(y.reservation_id)!).push({ id: y.id, amount: y.amount, method: y.method, kind: y.kind, paid_on: y.paid_on, note: y.note, created_at: y.created_at });
  return rows.map((r) => {
    const extrasList = ex.get(r.id) ?? [];
    const payments = py.get(r.id) ?? [];
    const lodging = r.nights * r.price_per_night;
    const extrasAmount = extrasList.reduce((s, e) => s + e.amount, 0);
    const total = lodging + extrasAmount + r.tourist_tax;
    const net = Math.max(0, total - r.discount_amount);
    const paid = payments.reduce((s, y) => s + y.amount, 0);
    const balance = net - paid;
    return {
      ...r,
      lodging_amount: lodging, extras: extrasList, extras_amount: extrasAmount, total_amount: total, net_amount: net,
      payments, paid_amount: paid, balance,
      pay_status: balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
    } as HotelReservationDto;
  });
}

export async function getReservation(q: Queryable, id: string) {
  const r = (await loadReservations(q, { ids: [id] }))[0];
  if (!r) throw notFound('Réservation introuvable');
  return r;
}

/* ───────────── Écriture ───────────── */
const yearOf = (tz: string) => todayInTz(tz).slice(2, 4);

async function assertAvailable(q: Queryable, roomId: string, arrival: string, departure: string, excludeId?: string) {
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`hotel-room-${roomId}`]);
  const room = (await q.query<{ is_active: boolean; tech_status: string; number: string }>('select is_active, tech_status, number from hotel_rooms where id = $1', [roomId])).rows[0];
  if (!room) throw notFound('Chambre introuvable');
  if (!room.is_active || room.tech_status === 'out_of_service') throw conflict(`La chambre ${room.number} est hors service`, 'ROOM_UNAVAILABLE');
  const { rows } = await q.query<{ ref: string; client: string; arrival: string; departure: string }>(
    `select r.ref, c.full_name as client, r.arrival, r.departure from hotel_reservations r join hotel_clients c on c.id = r.client_id
     where r.room_id = $1 and r.status::text = any(string_to_array($2, ',')) and r.arrival < $4::date and $3::date < r.departure
       and ($5::uuid is null or r.id <> $5::uuid) limit 1`,
    [roomId, HOTEL_ACTIVE_STATUSES.join(','), arrival, departure, excludeId ?? null],
  );
  if (rows[0]) throw conflict(`La chambre ${room.number} est déjà réservée du ${rows[0].arrival} au ${rows[0].departure} (${rows[0].client})`, 'ROOM_BUSY', { reservation: rows[0].ref });
}

async function resolveClient(q: Queryable, input: { client_id?: string; new_client?: z.infer<typeof reservationCreateSchema>['new_client'] }, demo = false): Promise<string> {
  if (input.client_id) {
    const r = await q.query('select 1 from hotel_clients where id = $1', [input.client_id]);
    if (!r.rows.length) throw notFound('Client introuvable');
    return input.client_id;
  }
  const c = input.new_client!;
  const { rows } = await q.query<{ id: string }>(
    'insert into hotel_clients (full_name, phone, email, id_document, address, notes, is_demo) values ($1,$2,$3,$4,$5,$6,$7) returning id',
    [c.full_name, c.phone || null, c.email || null, c.id_document || null, c.address || null, c.notes || null, demo],
  );
  return rows[0]!.id;
}

async function nextRef(q: Queryable, tz: string, prefix: string) {
  const { rows } = await q.query<{ n: number }>(`select nextval('hotel_reservation_seq')::int as n`);
  return `RES ${prefix}/${yearOf(tz)}.${String(rows[0]!.n).padStart(6, '0')}`;
}

type Create = z.infer<typeof reservationCreateSchema>;
interface Ctx2 { tz: string; demo?: boolean }

async function insertReservation(q: Queryable, user: AuthUser | null, c: Omit<Create, 'deposit' | 'new_client' | 'client_id'> & { client_id: string; deposit?: Create['deposit'] }, groupId: string | null, x: Ctx2, settings: HotelSettings, createdAt?: string): Promise<string> {
  await assertAvailable(q, c.room_id, c.arrival, c.departure);
  const nights = nightsBetween(c.arrival, c.departure);
  const tax = settings.tourist_tax_per_person_night * c.adults * nights;
  const lodging = nights * c.price_per_night;
  const extrasTotal = c.extras.reduce((s, e) => s + e.unit_price * e.quantity * e.multiplier, 0);
  if (c.discount_amount > lodging + extrasTotal + tax) throw badRequest('La remise dépasse le total du séjour');
  const ref = await nextRef(q, x.tz, settings.ref_prefix);
  const { rows } = await q.query<{ id: string }>(
    `insert into hotel_reservations (ref, group_id, client_id, room_id, arrival, departure, adults, children, price_per_night,
       discount_percent, discount_amount, tourist_tax, status, note, is_demo, created_by, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, coalesce($17::timestamptz, now())) returning id`,
    [ref, groupId, c.client_id, c.room_id, c.arrival, c.departure, c.adults, c.children, c.price_per_night, c.discount_percent, c.discount_amount, tax, c.status, c.note || null, !!x.demo, user?.id ?? null, createdAt ?? null],
  );
  const id = rows[0]!.id;
  for (const e of c.extras) {
    await q.query('insert into hotel_reservation_extras (reservation_id, service_id, label, unit_price, quantity, multiplier) values ($1,$2,$3,$4,$5,$6)', [id, e.service_id ?? null, e.label, e.unit_price, e.quantity, e.multiplier]);
  }
  if (c.deposit && c.deposit.amount > 0) {
    await q.query(`insert into hotel_payments (reservation_id, amount, method, kind, paid_on, created_by) values ($1,$2,$3,'deposit',coalesce($4::date, $5::date),$6)`, [id, c.deposit.amount, c.deposit.method, c.deposit.paid_on ?? null, todayInTz(x.tz), user?.id ?? null]);
  }
  return id;
}

export async function createReservation(q: Queryable, user: AuthUser, input: Create, tz: string) {
  const settings = await getHotelSettings(q);
  const client_id = await resolveClient(q, input);
  const { new_client: _n, ...rest } = input;
  const id = await insertReservation(q, user, { ...rest, client_id }, null, { tz }, settings);
  await audit(q, user, 'hotel.reservation.create', 'hotel_reservation', id);
  return getReservation(q, id);
}

export async function createGroupReservation(q: Queryable, user: AuthUser, input: z.infer<typeof reservationGroupSchema>, tz: string) {
  const settings = await getHotelSettings(q);
  const client_id = await resolveClient(q, input);
  const groupId = randomUUID();
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [i, r] of input.rooms.entries()) {
    if (seen.has(r.room_id)) throw badRequest('Une chambre est choisie deux fois');
    seen.add(r.room_id);
    const { rooms: _r, new_client: _n, deposit, ...base } = input;
    // l'acompte et les suppléments sont portés par la première chambre du groupe
    ids.push(await insertReservation(q, user, { ...base, extras: i === 0 ? base.extras : [], room_id: r.room_id, price_per_night: r.price_per_night, client_id, deposit: i === 0 ? deposit : undefined }, groupId, { tz }, settings));
  }
  await audit(q, user, 'hotel.reservation.group', 'hotel_reservation', ids[0], { count: ids.length });
  return loadReservations(q, { ids });
}

export async function updateReservation(q: Queryable, user: AuthUser, id: string, input: z.infer<typeof reservationUpdateSchema>) {
  const cur = await getReservation(q, id);
  if (cur.status === 'checked_out' || cur.status === 'cancelled') throw conflict('Une réservation terminée ou annulée ne peut plus être modifiée', 'RESERVATION_CLOSED');
  const next = {
    room_id: input.room_id ?? cur.room_id,
    arrival: input.arrival ?? cur.arrival,
    departure: input.departure ?? cur.departure,
    adults: input.adults ?? cur.adults,
    children: input.children ?? cur.children,
    price_per_night: input.price_per_night ?? cur.price_per_night,
    discount_percent: input.discount_percent ?? cur.discount_percent,
    discount_amount: input.discount_amount ?? cur.discount_amount,
    note: input.note === undefined ? cur.note : input.note || null,
    client_id: input.client_id ?? cur.client_id,
  };
  if (next.departure <= next.arrival) throw badRequest('Le départ doit être après l’arrivée');
  await assertAvailable(q, next.room_id, next.arrival, next.departure, id);
  const settings = await getHotelSettings(q);
  const nights = nightsBetween(next.arrival, next.departure);
  const tax = settings.tourist_tax_per_person_night * next.adults * nights;
  const extras = input.extras ?? cur.extras;
  const gross = nights * next.price_per_night + extras.reduce((s, e) => s + e.unit_price * e.quantity * e.multiplier, 0) + tax;
  if (next.discount_amount > gross) throw badRequest('La remise dépasse le total du séjour');
  await q.query(
    `update hotel_reservations set client_id=$2, room_id=$3, arrival=$4, departure=$5, adults=$6, children=$7, price_per_night=$8,
       discount_percent=$9, discount_amount=$10, tourist_tax=$11, note=$12, updated_at=now() where id=$1`,
    [id, next.client_id, next.room_id, next.arrival, next.departure, next.adults, next.children, next.price_per_night, next.discount_percent, next.discount_amount, tax, next.note],
  );
  if (input.extras) {
    await q.query('delete from hotel_reservation_extras where reservation_id = $1', [id]);
    for (const e of input.extras) {
      await q.query('insert into hotel_reservation_extras (reservation_id, service_id, label, unit_price, quantity, multiplier) values ($1,$2,$3,$4,$5,$6)', [id, e.service_id ?? null, e.label, e.unit_price, e.quantity, e.multiplier]);
    }
  }
  await audit(q, user, 'hotel.reservation.update', 'hotel_reservation', id);
  return getReservation(q, id);
}

const TRANSITIONS: Record<HotelResStatus, HotelResStatus[]> = {
  option: ['confirmed', 'checked_in', 'cancelled'],
  confirmed: ['option', 'checked_in', 'cancelled'],
  checked_in: ['checked_out', 'cancelled'],
  checked_out: [],
  cancelled: ['confirmed'],
};

export async function setReservationStatus(q: Queryable, user: AuthUser, id: string, status: HotelResStatus, reason: string | null | undefined, tz: string) {
  const cur = await getReservation(q, id);
  if (cur.status === status) return cur;
  if (!TRANSITIONS[cur.status].includes(status)) throw conflict(`Passage impossible de « ${cur.status} » à « ${status} »`, 'BAD_TRANSITION');
  if (status === 'cancelled' && !reason?.trim()) throw badRequest('Motif d’annulation requis');
  if (status === 'confirmed' && cur.status === 'cancelled') await assertAvailable(q, cur.room_id, cur.arrival, cur.departure, id);
  if (status === 'checked_in') {
    const room = (await q.query<{ tech_status: string; is_active: boolean; number: string }>('select tech_status, is_active, number from hotel_rooms where id = $1', [cur.room_id])).rows[0]!;
    if (!room.is_active || room.tech_status === 'out_of_service' || room.tech_status === 'maintenance') throw conflict(`La chambre ${room.number} n’est pas utilisable (${room.tech_status})`, 'ROOM_UNAVAILABLE');
    const busy = await q.query('select 1 from hotel_reservations where room_id = $1 and status = $2 and id <> $3', [cur.room_id, 'checked_in', id]);
    if (busy.rows.length) throw conflict(`La chambre ${room.number} est encore occupée : faites d’abord le départ`, 'ROOM_OCCUPIED');
    if (cur.arrival > addDays(todayInTz(tz), 0)) throw conflict('Arrivée prévue plus tard : modifiez la date d’arrivée avant le check-in', 'TOO_EARLY');
  }
  await q.query(
    `update hotel_reservations set status = $2::hotel_res_status, cancel_reason = case when $4::text = 'cancelled' then $3::text else null end,
       checked_in_at = case when $4::text = 'checked_in' then now() when $4::text in ('option','confirmed') then null else checked_in_at end,
       checked_out_at = case when $4::text = 'checked_out' then now() else null end, updated_at = now() where id = $1`,
    [id, status, reason?.trim() ?? null, status],
  );
  if (status === 'checked_out') await q.query(`update hotel_rooms set tech_status = 'cleaning' where id = $1 and tech_status = 'normal'`, [cur.room_id]);
  await audit(q, user, `hotel.reservation.${status}`, 'hotel_reservation', id, reason ? { reason } : undefined);
  return getReservation(q, id);
}

export async function addPayment(q: Queryable, user: AuthUser, id: string, input: z.infer<typeof hotelPaymentSchema>, tz: string) {
  const cur = await getReservation(q, id);
  if (cur.status === 'cancelled' && input.kind !== 'refund') throw conflict('Réservation annulée : seul un remboursement est possible', 'RESERVATION_CLOSED');
  const amount = input.kind === 'refund' ? -Math.abs(input.amount) : Math.abs(input.amount);
  if (input.kind !== 'refund' && amount > cur.balance && cur.balance >= 0 && amount - cur.balance > 0 && cur.status !== 'cancelled') {
    throw conflict(`Le montant dépasse le solde restant (${cur.balance} Ar)`, 'OVERPAYMENT', { balance: cur.balance });
  }
  await q.query(`insert into hotel_payments (reservation_id, amount, method, kind, paid_on, note, created_by) values ($1,$2,$3,$4,coalesce($5::date,$6::date),$7,$8)`, [id, amount, input.method, input.kind, input.paid_on ?? null, todayInTz(tz), input.note || null, user.id]);
  await audit(q, user, 'hotel.payment.add', 'hotel_reservation', id, { amount, method: input.method });
  return getReservation(q, id);
}

export async function deletePayment(q: Queryable, user: AuthUser, id: string, paymentId: string) {
  const r = await q.query('delete from hotel_payments where id = $1 and reservation_id = $2', [paymentId, id]);
  if (!r.rowCount) throw notFound('Paiement introuvable');
  await audit(q, user, 'hotel.payment.delete', 'hotel_reservation', id, { paymentId });
  return getReservation(q, id);
}

export async function deleteReservation(q: Queryable, user: AuthUser, id: string) {
  const cur = await getReservation(q, id);
  if (cur.status !== 'cancelled' && !cur.is_demo) throw conflict('Annulez la réservation avant de la supprimer', 'NOT_CANCELLED');
  await q.query('delete from hotel_reservations where id = $1', [id]);
  await audit(q, user, 'hotel.reservation.delete', 'hotel_reservation', id, { ref: cur.ref });
}

/* ───────────── Chambres en temps réel ───────────── */
export async function listRooms(q: Queryable, tz: string, onlyId?: string): Promise<HotelRoomDto[]> {
  const today = todayInTz(tz);
  const { rows } = await q.query<any>(
    `select r.id, r.number, r.room_type_id, t.name as type_name, t.color, coalesce(r.capacity, t.capacity) as capacity,
       coalesce(r.price, t.base_price) as effective_price, r.tech_status, r.is_active, r.notes, r.sort_order,
       r.price, r.capacity as own_capacity,
       occ.id as occupied_reservation_id, occ.client_name as occupied_by, occ.departure as occupied_until,
       coalesce(nx.arrival = $1::date, false) as arriving_today, nx.arrival as next_arrival, nx.client_name as next_client
     from hotel_rooms r
     join hotel_room_types t on t.id = r.room_type_id
     left join lateral (select x.id, c.full_name as client_name, x.departure from hotel_reservations x join hotel_clients c on c.id = x.client_id
                        where x.room_id = r.id and x.status = 'checked_in' limit 1) occ on true
     left join lateral (select x.arrival, c.full_name as client_name from hotel_reservations x join hotel_clients c on c.id = x.client_id
                        where x.room_id = r.id and x.status in ('option','confirmed') and x.departure > $1::date order by x.arrival limit 1) nx on true
     ${onlyId ? 'where r.id = $2' : ''}
     order by r.sort_order, r.number`,
    onlyId ? [today, onlyId] : [today],
  );
  return rows;
}
export const liveStatusOf = (r: HotelRoomDto): RoomLiveStatus => roomLiveStatus(r);

/* ───────────── Tableau de bord ───────────── */
export async function hotelDashboard(q: Queryable, tz: string): Promise<HotelDashboardDto> {
  const today = todayInTz(tz);
  const rooms = (await listRooms(q, tz)).filter((r) => r.is_active);
  const room_status = { available: 0, reserved: 0, arriving: 0, occupied: 0, cleaning: 0, maintenance: 0, out_of_service: 0 } as Record<RoomLiveStatus, number>;
  for (const r of rooms) room_status[roomLiveStatus(r)]++;

  const since = addDays(monthStart(today), -31 * 11); // ~12 mois glissants
  const res = (
    await q.query<any>(
      `select r.id, r.arrival, r.departure, r.status, (r.departure - r.arrival) as nights,
         greatest(0, (r.departure - r.arrival) * r.price_per_night
           + coalesce((select sum(e.unit_price * e.quantity * e.multiplier) from hotel_reservation_extras e where e.reservation_id = r.id), 0)
           + r.tourist_tax - r.discount_amount) as net,
         coalesce((select sum(p.amount) from hotel_payments p where p.reservation_id = r.id), 0) as paid
       from hotel_reservations r where r.status <> 'cancelled'`,
    )
  ).rows;
  const pays = (await q.query<any>('select amount, method, paid_on from hotel_payments')).rows;

  const mStart = monthStart(today);
  const nextMonth = monthStart(addDays(mStart, 32));
  const inMonth = (d: string) => d >= mStart && d < nextMonth;
  const occupied_today = new Set(res.filter((r) => ['confirmed', 'checked_in'].includes(r.status) && r.arrival <= today && r.departure > today).map((r) => r.id)).size;

  const months: HotelDashboardDto['monthly'] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(toDate(mStart)); d.setUTCMonth(d.getUTCMonth() - i);
    months.push({ month: d.toISOString().slice(0, 7), reservations: 0, nights: 0, revenue: 0, collected: 0 });
  }
  for (const r of res) {
    const m = months.find((x) => x.month === r.arrival.slice(0, 7));
    if (m) { m.reservations++; m.nights += r.nights; m.revenue += r.net; }
  }
  for (const p of pays) {
    const m = months.find((x) => x.month === p.paid_on.slice(0, 7));
    if (m) m.collected += p.amount;
  }
  const weekly: HotelDashboardDto['weekly'] = [];
  for (let i = 7; i >= 0; i--) weekly.push({ week_start: addDays(mondayOf(today), -7 * i), reservations: 0, nights: 0, revenue: 0 });
  for (const r of res) {
    const w = weekly.find((x) => r.arrival >= x.week_start && r.arrival < addDays(x.week_start, 7));
    if (w) { w.reservations++; w.nights += r.nights; w.revenue += r.net; }
  }
  const status_counts = { option: 0, confirmed: 0, checked_in: 0, checked_out: 0, cancelled: 0 } as Record<HotelResStatus, number>;
  const all = (await q.query<{ status: HotelResStatus; n: number }>('select status, count(*)::int as n from hotel_reservations where departure >= $1::date group by status', [addDays(today, -30)])).rows;
  for (const r of all) status_counts[r.status] = r.n;
  void since;

  const byMethod = new Map<string, number>();
  for (const p of pays.filter((x) => inMonth(x.paid_on))) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);

  return {
    date: today,
    units_total: rooms.length,
    occupied_today,
    occupancy_percent: rooms.length ? Math.round((occupied_today / rooms.length) * 100) : 0,
    arrivals_today: res.filter((r) => r.arrival === today && ['option', 'confirmed', 'checked_in'].includes(r.status)).length,
    departures_today: res.filter((r) => r.departure === today && ['checked_in', 'checked_out'].includes(r.status)).length,
    upcoming_7d: res.filter((r) => r.arrival > today && r.arrival <= addDays(today, 7) && ['option', 'confirmed'].includes(r.status)).length,
    revenue_month: res.filter((r) => inMonth(r.arrival)).reduce((s, r) => s + r.net, 0),
    collected_month: pays.filter((p) => inMonth(p.paid_on)).reduce((s, p) => s + p.amount, 0),
    collected_total: pays.reduce((s, p) => s + p.amount, 0),
    outstanding_total: res.reduce((s, r) => s + Math.max(0, r.net - r.paid), 0),
    status_counts,
    room_status,
    monthly: months,
    weekly,
    by_method: [...byMethod].map(([method, total]) => ({ method: method as any, total })),
  };
}

/* ───────────── Données de démonstration ───────────── */
const DEMO_ROOMS: [string, string, number, number][] = [
  ...['101', '102', '103', '104', '105', '201', '202', '203', '204', '205'].map((n) => [n, 'Chambre', 3, 150_000] as [string, string, number, number]),
  ...[1, 2, 3, 4].map((n) => [`Bungalow ${n}`, 'Bungalow', 10, 400_000] as [string, string, number, number]),
];

export async function ensureHotelBase(q: Queryable) {
  const types = new Map<string, string>();
  const add = async (name: string, color: string, price: number, cap: number, sort: number) => {
    const ex = await q.query<{ id: string }>('select id from hotel_room_types where lower(name) = lower($1)', [name]);
    const id = ex.rows[0]?.id ?? (await q.query<{ id: string }>('insert into hotel_room_types (name, color, base_price, capacity, sort_order) values ($1,$2,$3,$4,$5) returning id', [name, color, price, cap, sort])).rows[0]!.id;
    types.set(name, id);
  };
  const roomCount = (await q.query<{ n: number }>('select count(*)::int as n from hotel_rooms')).rows[0]!.n;
  if (roomCount === 0) {
    await add('Chambre', '#16a34a', 150_000, 3, 1);
    await add('Bungalow', '#2563eb', 400_000, 10, 2);
    let i = 0;
    for (const [number, type, cap] of DEMO_ROOMS) {
      await q.query('insert into hotel_rooms (number, room_type_id, capacity, sort_order) values ($1,$2,$3,$4)', [number, types.get(type), cap, i++]);
    }
  }
  const svc = (await q.query<{ n: number }>('select count(*)::int as n from hotel_services')).rows[0]!.n;
  if (svc === 0) {
    await q.query(`insert into hotel_services (name, unit_price, charge_mode, sort_order) values ('Matelas supplémentaire', 20000, 'per_night', 1), ('Location cuisine', 50000, 'flat', 2)`);
  }
  const rules = (await q.query<{ n: number }>('select count(*)::int as n from hotel_rate_rules')).rows[0]!.n;
  if (rules === 0) {
    const y = new Date().getUTCFullYear();
    await q.query(`insert into hotel_rate_rules (name, date_from, date_to, mode, value, priority) values ('Haute saison (juillet-août)', $1, $2, 'percent', 20, 1)`, [`${y}-07-01`, `${y}-08-31`]);
    await q.query(`insert into hotel_rate_rules (name, date_from, date_to, mode, value, weekdays, priority) values ('Week-end', $1, $2, 'percent', 10, '{5,6}', 0)`, [`${y}-01-01`, `${y}-12-31`]);
  }
}

export async function clearDemo(q: Queryable) {
  await q.query('delete from hotel_reservations where is_demo');
  await q.query('delete from hotel_clients where is_demo and not exists (select 1 from hotel_reservations r where r.client_id = hotel_clients.id)');
}

/** (Re)crée un jeu de réservations d'essai daté autour d'aujourd'hui : relancer = mettre à jour les valeurs démo. */
export async function loadDemo(q: Queryable, user: AuthUser, tz: string) {
  await ensureHotelBase(q);
  await clearDemo(q);
  const settings = await getHotelSettings(q);
  const today = todayInTz(tz);
  const rooms = (await q.query<{ id: string; number: string; price: number }>('select r.id, r.number, coalesce(r.price, t.base_price) as price from hotel_rooms r join hotel_room_types t on t.id = r.room_type_id where r.is_active order by r.sort_order, r.number')).rows;
  if (!rooms.length) throw badRequest('Aucune chambre : créez d’abord des chambres');
  const svcs = (await q.query<{ id: string; name: string; unit_price: number; charge_mode: string }>('select id, name, unit_price, charge_mode from hotel_services order by sort_order')).rows;
  const names: [string, string][] = [['Mme Onjaniaina', '032 00 000 01'], ['Mr Rija', '033 00 000 02'], ['Mme Tafitasoa', '034 00 000 03'], ['Mr Dafy', '032 00 000 04'], ['Mme Mirana', '033 00 000 05'], ['Mr Paule', '034 00 000 06'], ['Mme Marie', '032 00 000 07'], ['Mr Hery', '033 00 000 08']];
  // [chambre, début (j), nuits, statut, acompte%, mode, matelas, cuisine, remise%]
  const plan: [number, number, number, HotelResStatus, number, 'cash' | 'mvola' | 'orange_money' | 'airtel_money', number, boolean, number][] = [
    [0, -3, 5, 'checked_in', 50, 'cash', 0, false, 0],
    [1, -1, 3, 'checked_in', 100, 'mvola', 1, false, 0],
    [2, 0, 3, 'confirmed', 30, 'airtel_money', 0, false, 10],
    [3, 2, 2, 'confirmed', 40, 'orange_money', 0, false, 0],
    [10, -2, 4, 'checked_in', 50, 'cash', 0, true, 0],
    [11, 3, 3, 'option', 0, 'cash', 0, false, 0],
    [4, 5, 4, 'confirmed', 30, 'mvola', 1, false, 5],
    [12, -9, 3, 'checked_out', 100, 'cash', 0, true, 0],
  ];
  let created = 0;
  for (const [i, p] of plan.entries()) {
    const arrival = addDays(today, p[1]);
    const departure = addDays(arrival, p[2]);
    let room: (typeof rooms)[number] | undefined;
    for (let k = 0; k < rooms.length && !room; k++) {
      const cand = rooms[(p[0] + k) % rooms.length]!;
      const busy = await q.query(`select 1 from hotel_reservations where room_id = $1 and status::text = any(string_to_array($2, ',')) and arrival < $4::date and $3::date < departure limit 1`, [cand.id, HOTEL_ACTIVE_STATUSES.join(','), arrival, departure]);
      if (!busy.rows.length) room = cand;
    }
    if (!room) continue;
    const quote = await quoteStay(q, room.id, arrival, departure);
    const [name, phone] = names[i % names.length]!;
    const client_id = await resolveClient(q, { new_client: { full_name: name, phone } as any }, true);
    const extras = [];
    const mat = svcs.find((s) => /matelas/i.test(s.name));
    const kit = svcs.find((s) => /cuisine/i.test(s.name));
    if (p[6] && mat) extras.push({ service_id: mat.id, label: mat.name, unit_price: mat.unit_price, quantity: p[6], multiplier: mat.charge_mode === 'per_night' ? p[2] : 1 });
    if (p[7] && kit) extras.push({ service_id: kit.id, label: kit.name, unit_price: kit.unit_price, quantity: 1, multiplier: kit.charge_mode === 'per_night' ? p[2] : 1 });
    const gross = quote.total + extras.reduce((s, e) => s + e.unit_price * e.quantity * e.multiplier, 0);
    const discount_amount = Math.round((gross * p[8]) / 100);
    const net = gross - discount_amount;
    const status: 'option' | 'confirmed' = p[3] === 'option' ? 'option' : 'confirmed';
    const id = await insertReservation(q, user, {
      room_id: room.id, client_id, arrival, departure, adults: 2, children: 0, price_per_night: quote.average, discount_percent: p[8], discount_amount, status, note: null, extras,
      deposit: p[4] > 0 ? { amount: Math.round((net * p[4]) / 100), method: p[5], paid_on: addDays(arrival, -2) < today ? addDays(arrival, -2) : today } : undefined,
    }, null, { tz, demo: true }, settings);
    if (p[3] === 'checked_in' || p[3] === 'checked_out') {
      await q.query(`update hotel_reservations set status = $2::hotel_res_status, checked_in_at = now(), checked_out_at = case when $3::text = 'checked_out' then now() end where id = $1`, [id, p[3], p[3]]);
    }
    created++;
  }
  await audit(q, user, 'hotel.demo.load', 'hotel');
  return { created };
}
