import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateSchema, todayInTz, type DashboardDto, type SalesReportDto, type YearlyRowDto } from '@resto/shared';
import type { Ctx } from '../context.js';
import { badRequest } from '../errors.js';
import { STOCK_LEVELS_SQL } from '../services/stock.js';

/** [1er jour du mois, 1er jour du mois suivant[ — en texte AAAA-MM-JJ, sans passer par un fuseau. */
function monthBounds(date: string): [string, string] {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return [`${y}-${pad(m)}-01`, next];
}

export function dashboardRoutes(app: FastifyInstance, ctx: Ctx) {
  const admin = { preHandler: ctx.auth.require('admin') };

  app.get('/dashboard', admin, async (req): Promise<DashboardDto> => {
    const { date = todayInTz(ctx.cfg.APP_TZ) } = z.object({ date: dateSchema.optional() }).parse(req.query);
    const [start, next] = monthBounds(date);
    const db = ctx.db;

    const [sales, purchases, expenses, series, top, methods, low, open] = await Promise.all([
      db.query<{ sales_day: number; sales_month: number; orders_day: number; orders_month: number }>(
        `select coalesce(sum(total) filter (where business_date = $1::date), 0)::bigint as sales_day,
                coalesce(sum(total), 0)::bigint as sales_month,
                (count(*) filter (where business_date = $1::date))::bigint as orders_day,
                count(*)::bigint as orders_month
         from orders where status = 'paid' and business_date >= $2::date and business_date < $3::date`,
        [date, start, next],
      ),
      db.query<{ d: number; m: number }>(
        `select coalesce(sum(round(quantity * unit_price)) filter (where date = $1::date), 0)::bigint as d,
                coalesce(sum(round(quantity * unit_price)), 0)::bigint as m
         from purchases where date >= $2::date and date < $3::date`,
        [date, start, next],
      ),
      db.query<{ d: number; m: number }>(
        `select coalesce(sum(amount) filter (where date = $1::date), 0)::bigint as d,
                coalesce(sum(amount), 0)::bigint as m
         from expenses where date >= $2::date and date < $3::date`,
        [date, start, next],
      ),
      db.query<{ date: string; total: number }>(
        `select d::date as date, coalesce(sum(o.total), 0)::bigint as total
         from generate_series($1::timestamp - interval '29 days', $1::timestamp, interval '1 day') d
         left join orders o on o.business_date = d::date and o.status = 'paid'
         group by d order by d`,
        [date],
      ),
      db.query<{ name: string; quantity: number; revenue: number }>(
        `select l.name, sum(l.quantity)::bigint as quantity, sum(l.quantity * l.unit_price)::bigint as revenue
         from order_lines l join orders o on o.id = l.order_id
         where o.status = 'paid' and o.business_date >= $1::date and o.business_date < $2::date
         group by l.name order by quantity desc, revenue desc limit 8`,
        [start, next],
      ),
      db.query<DashboardDto['by_method'][number]>(
        `select payment_method as method, sum(total)::bigint as total, count(*)::bigint as count
         from orders where status = 'paid' and business_date >= $1::date and business_date < $2::date
         group by payment_method order by total desc`,
        [start, next],
      ),
      db.query<DashboardDto['low_stock'][number]>(
        `select id, name, unit, qty, min_qty from (${STOCK_LEVELS_SQL}) l where low order by name limit 12`,
      ),
      db.query<{ n: number }>(`select count(*)::bigint as n from orders where status = 'open'`),
    ]);

    const s = sales.rows[0]!;
    const p = purchases.rows[0]!;
    const e = expenses.rows[0]!;
    return {
      date,
      kpis: {
        sales_day: s.sales_day,
        sales_month: s.sales_month,
        orders_day: s.orders_day,
        orders_month: s.orders_month,
        purchases_day: p.d,
        purchases_month: p.m,
        expenses_day: e.d,
        expenses_month: e.m,
        profit_day: s.sales_day - p.d - e.d,
        profit_month: s.sales_month - p.m - e.m,
      },
      series: series.rows,
      top_items: top.rows,
      by_method: methods.rows,
      low_stock: low.rows,
      open_orders: open.rows[0]!.n,
    };
  });

  /** Tableau mensuel de l'année (CA, achats, dépenses, bénéfice) — équivalent de l'onglet Excel. */
  app.get('/dashboard/yearly', admin, async (req): Promise<YearlyRowDto[]> => {
    const { year = Number(todayInTz(ctx.cfg.APP_TZ).slice(0, 4)) } = z
      .object({ year: z.coerce.number().int().min(2000).max(2100).optional() })
      .parse(req.query);
    const { rows } = await ctx.db.query<{ month: number; sales: number; orders: number; purchases: number; expenses: number }>(
      `select m::int as month,
        (select count(*) from orders where status = 'paid' and business_date >= make_date($1, m::int, 1) and business_date < make_date($1, m::int, 1) + interval '1 month')::bigint as orders,
        coalesce((select sum(total) from orders where status = 'paid' and business_date >= make_date($1, m::int, 1) and business_date < make_date($1, m::int, 1) + interval '1 month'), 0)::bigint as sales,
        coalesce((select sum(round(quantity * unit_price)) from purchases where date >= make_date($1, m::int, 1) and date < make_date($1, m::int, 1) + interval '1 month'), 0)::bigint as purchases,
        coalesce((select sum(amount) from expenses where date >= make_date($1, m::int, 1) and date < make_date($1, m::int, 1) + interval '1 month'), 0)::bigint as expenses
       from generate_series(1, 12) m order by m`,
      [year],
    );
    return rows.map((r) => ({ ...r, profit: r.sales - r.purchases - r.expenses }));
  });

  /** Statistiques de ventes d'une période [from, to] (inclus) : total, ticket moyen, meilleures ventes, répartitions. */
  app.get('/dashboard/report', admin, async (req): Promise<SalesReportDto> => {
    const q = z.object({ from: dateSchema, to: dateSchema }).parse(req.query);
    if (q.to < q.from) throw badRequest('La fin doit suivre le début');
    if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 800) throw badRequest('Période trop longue (800 jours maximum)');
    const db = ctx.db;
    const where = `o.status = 'paid' and o.business_date >= $1::date and o.business_date <= $2::date`;
    const args = [q.from, q.to];
    const [tot, methods, cats, top, series] = await Promise.all([
      db.query<{ total: number; orders: number; items: number }>(
        `select coalesce(sum(o.total), 0)::bigint as total, count(*)::bigint as orders,
                coalesce((select sum(l.quantity) from order_lines l join orders o2 on o2.id = l.order_id
                          where o2.status = 'paid' and o2.business_date >= $1::date and o2.business_date <= $2::date), 0)::bigint as items
         from orders o where ${where}`, args),
      db.query<SalesReportDto['by_method'][number]>(
        `select o.payment_method as method, sum(o.total)::bigint as total, count(*)::bigint as count
         from orders o where ${where} group by o.payment_method order by total desc`, args),
      db.query<SalesReportDto['by_category'][number]>(
        `select coalesce(c.name, 'Autres') as name, sum(l.quantity)::bigint as quantity, sum(l.quantity * l.unit_price)::bigint as revenue
         from order_lines l join orders o on o.id = l.order_id
         left join menu_items m on m.id = l.menu_item_id left join categories c on c.id = m.category_id
         where ${where} group by 1 order by revenue desc`, args),
      db.query<SalesReportDto['top_items'][number]>(
        `select l.name, max(c.name) as category_name, sum(l.quantity)::bigint as quantity, sum(l.quantity * l.unit_price)::bigint as revenue
         from order_lines l join orders o on o.id = l.order_id
         left join menu_items m on m.id = l.menu_item_id left join categories c on c.id = m.category_id
         where ${where} group by l.name order by quantity desc, revenue desc limit 20`, args),
      db.query<SalesReportDto['series'][number]>(
        `select o.business_date as date, sum(o.total)::bigint as total, count(*)::bigint as orders
         from orders o where ${where} group by o.business_date order by o.business_date`, args),
    ]);
    const t = tot.rows[0]!;
    return {
      from: q.from, to: q.to, total: t.total, orders: t.orders, avg_ticket: t.orders ? Math.round(t.total / t.orders) : 0, items_sold: t.items,
      by_method: methods.rows, by_category: cats.rows, top_items: top.rows, series: series.rows,
    };
  });
}
