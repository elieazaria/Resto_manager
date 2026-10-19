import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateSchema, openingBalanceSchema, todayInTz, type DashboardDto, type YearlyRowDto } from '@resto/shared';
import { audit } from '../auth.js';
import type { Ctx } from '../context.js';
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

    const [sales, purchases, expenses, opening, series, top, methods, low, open] = await Promise.all([
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
      db.query<{ amount: number }>('select amount from cash_openings where date = $1::date', [date]),
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
    const openingAmount = opening.rows[0]?.amount ?? 0;
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
      cash: {
        opening: openingAmount,
        inflow: s.sales_day,
        outflow: p.d + e.d,
        remaining: openingAmount + s.sales_day - (p.d + e.d),
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
    const { rows } = await ctx.db.query<{ month: number; sales: number; purchases: number; expenses: number }>(
      `select m::int as month,
        coalesce((select sum(total) from orders where status = 'paid' and business_date >= make_date($1, m::int, 1) and business_date < make_date($1, m::int, 1) + interval '1 month'), 0)::bigint as sales,
        coalesce((select sum(round(quantity * unit_price)) from purchases where date >= make_date($1, m::int, 1) and date < make_date($1, m::int, 1) + interval '1 month'), 0)::bigint as purchases,
        coalesce((select sum(amount) from expenses where date >= make_date($1, m::int, 1) and date < make_date($1, m::int, 1) + interval '1 month'), 0)::bigint as expenses
       from generate_series(1, 12) m order by m`,
      [year],
    );
    return rows.map((r) => ({ ...r, profit: r.sales - r.purchases - r.expenses }));
  });

  /** « Solde initial (à saisir) » de la trésorerie du jour. */
  app.put('/dashboard/opening-balance', admin, async (req) => {
    const b = openingBalanceSchema.parse(req.body);
    await ctx.db.query(
      'insert into cash_openings (date, amount) values ($1::date, $2) on conflict (date) do update set amount = excluded.amount',
      [b.date, b.amount],
    );
    await audit(ctx.db, req.user, 'cash.opening', 'cash_opening', b.date, { amount: b.amount });
    return b;
  });
}
