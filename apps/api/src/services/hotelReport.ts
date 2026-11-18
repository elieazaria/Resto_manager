import type { HotelReportDto, HotelYearlyRowDto } from '@resto/shared';
import type { Queryable } from '../db.js';

const dayMs = 86_400_000;
const daysIn = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1;
const addDay = (d: string, n: number) => new Date(Date.parse(d) + n * dayMs).toISOString().slice(0, 10);

/** Séjours non annulés qui ARRIVENT dans [from, to] : montants nets calculés comme sur la facture. */
const STAYS_SQL = `
  select r.id, r.arrival::text as arrival, (r.departure - r.arrival)::int as nights, ty.name as type_name,
         (r.departure - r.arrival) * r.price_per_night as lodging,
         coalesce((select sum(e.unit_price * e.quantity * e.multiplier) from hotel_reservation_extras e where e.reservation_id = r.id), 0) as extras,
         r.tourist_tax as tax, r.discount_amount as discount
  from hotel_reservations r
  join hotel_rooms rm on rm.id = r.room_id
  join hotel_room_types ty on ty.id = rm.room_type_id
  where r.status <> 'cancelled' and r.arrival >= $1::date and r.arrival <= $2::date`;

interface Stay { id: string; arrival: string; nights: number; type_name: string; lodging: number; extras: number; tax: number; discount: number }
const net = (s: Stay) => Math.max(0, s.lodging + s.extras + s.tax - s.discount);

export async function hotelReport(q: Queryable, from: string, to: string): Promise<HotelReportDto> {
  const args = [from, to];
  const stays = (await q.query<Stay>(STAYS_SQL, args)).rows.map((s) => ({ ...s, lodging: +s.lodging, extras: +s.extras, tax: +s.tax, discount: +s.discount }));
  const rooms = (await q.query<{ n: number }>('select count(*)::int as n from hotel_rooms where is_active')).rows[0]!.n;
  const sold = (await q.query<{ n: number }>(
    `select coalesce(sum(greatest(0, least(r.departure, $2::date + 1) - greatest(r.arrival, $1::date))), 0)::int as n
     from hotel_reservations r where r.status <> 'cancelled' and r.arrival <= $2::date and r.departure > $1::date`, args)).rows[0]!.n;
  const walk = (await q.query<{ sold_on: string; label: string; quantity: number; amount: number }>(
    `select sold_on::text as sold_on, label, quantity, amount from hotel_walkins where sold_on >= $1::date and sold_on <= $2::date`, args)).rows;
  const exp = (await q.query<{ category: string; total: number }>(
    `select category, sum(amount)::bigint as total from expenses where scope = 'hotel' and date >= $1::date and date <= $2::date group by category order by total desc`, args)).rows;
  const pay = (await q.query<{ method: any; total: number }>(
    `select method, sum(amount)::bigint as total from hotel_payments where paid_on >= $1::date and paid_on <= $2::date group by method order by total desc`, args)).rows;
  const extras = (await q.query<{ label: string; quantity: number; revenue: number }>(
    `select e.label, sum(e.quantity * e.multiplier)::bigint as quantity, sum(e.unit_price * e.quantity * e.multiplier)::bigint as revenue
     from hotel_reservation_extras e join hotel_reservations r on r.id = e.reservation_id
     where r.status <> 'cancelled' and r.arrival >= $1::date and r.arrival <= $2::date group by e.label order by revenue desc limit 10`, args)).rows;

  const days = daysIn(from, to);
  const lodging = stays.reduce((s, x) => s + x.lodging, 0);
  const extrasTotal = stays.reduce((s, x) => s + x.extras, 0);
  const staysNet = stays.reduce((s, x) => s + net(x), 0);
  const walkins = walk.reduce((s, x) => s + x.amount, 0);
  const revenue = staysNet + walkins;
  const expenses = exp.reduce((s, x) => s + Number(x.total), 0);

  const byType = new Map<string, { name: string; reservations: number; nights: number; revenue: number }>();
  for (const s of stays) {
    const t = byType.get(s.type_name) ?? byType.set(s.type_name, { name: s.type_name, reservations: 0, nights: 0, revenue: 0 }).get(s.type_name)!;
    t.reservations++; t.nights += s.nights; t.revenue += net(s);
  }
  const byWalk = new Map<string, { label: string; quantity: number; revenue: number }>();
  for (const w of walk) {
    const t = byWalk.get(w.label) ?? byWalk.set(w.label, { label: w.label, quantity: 0, revenue: 0 }).get(w.label)!;
    t.quantity += w.quantity; t.revenue += w.amount;
  }
  const perDay = new Map<string, number>();
  for (const s of stays) perDay.set(s.arrival, (perDay.get(s.arrival) ?? 0) + net(s));
  for (const w of walk) perDay.set(w.sold_on, (perDay.get(w.sold_on) ?? 0) + w.amount);
  const series = Array.from({ length: Math.min(days, 800) }, (_, i) => { const d = addDay(from, i); return { date: d, total: perDay.get(d) ?? 0 }; });

  return {
    from, to, days, rooms,
    reservations: stays.length, nights: sold,
    occupancy_percent: rooms && days ? Math.round((sold / (rooms * days)) * 1000) / 10 : 0,
    adr: sold ? Math.round(lodging / Math.max(1, stays.reduce((s, x) => s + x.nights, 0))) : 0,
    revpar: rooms && days ? Math.round(lodging / (rooms * days)) : 0,
    lodging, extras: extrasTotal, tourist_tax: stays.reduce((s, x) => s + x.tax, 0), discounts: stays.reduce((s, x) => s + x.discount, 0),
    walkins, walkin_people: walk.reduce((s, x) => s + x.quantity, 0),
    revenue, expenses, net: revenue - expenses, margin_percent: revenue ? Math.round(((revenue - expenses) / revenue) * 1000) / 10 : 0,
    collected: pay.reduce((s, x) => s + Number(x.total), 0),
    expenses_by_category: exp.map((x) => ({ category: x.category, total: Number(x.total) })),
    by_method: pay.map((x) => ({ method: x.method, total: Number(x.total) })),
    by_room_type: [...byType.values()].sort((a, b) => b.revenue - a.revenue),
    top_extras: extras.map((x) => ({ label: x.label, quantity: Number(x.quantity), revenue: Number(x.revenue) })),
    walkins_by_service: [...byWalk.values()].sort((a, b) => b.revenue - a.revenue),
    series,
  };
}

/** Tableau mensuel d'une année : réservations, nuitées, CA, dépenses, résultat net. */
export async function hotelYearly(q: Queryable, year: number): Promise<HotelYearlyRowDto[]> {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const stays = (await q.query<Stay>(STAYS_SQL, [from, to])).rows;
  const walk = (await q.query<{ month: number; amount: number }>(
    `select extract(month from sold_on)::int as month, sum(amount)::bigint as amount from hotel_walkins where sold_on >= $1::date and sold_on <= $2::date group by 1`, [from, to])).rows;
  const exp = (await q.query<{ month: number; amount: number }>(
    `select extract(month from date)::int as month, sum(amount)::bigint as amount from expenses where scope = 'hotel' and date >= $1::date and date <= $2::date group by 1`, [from, to])).rows;
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const mine = stays.filter((s) => Number(s.arrival.slice(5, 7)) === month).map((s) => ({ ...s, lodging: +s.lodging, extras: +s.extras, tax: +s.tax, discount: +s.discount }));
    const revenue = mine.reduce((a, s) => a + net(s), 0) + Number(walk.find((w) => w.month === month)?.amount ?? 0);
    const expenses = Number(exp.find((e) => e.month === month)?.amount ?? 0);
    return { month, reservations: mine.length, nights: mine.reduce((a, s) => a + s.nights, 0), revenue, expenses, net: revenue - expenses };
  });
}
