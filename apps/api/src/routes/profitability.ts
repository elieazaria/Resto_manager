import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateSchema, todayInTz, type ProfitabilityDto, type ProfitabilityRowDto, type ProfitCostLine } from '@resto/shared';
import type { Ctx } from '../context.js';
import { UNIT_COSTS_SQL } from '../services/stock.js';

/**
 * Bénéfice réel d'un menu = prix de vente − coût matières, le coût venant des PRIX D'ACHAT enregistrés :
 *  - « average » : coût moyen pondéré de tous les achats (Σ quantité × prix ÷ Σ quantité en unité de stock) ;
 *  - « last »    : dernier prix d'achat.
 * Plat cuisiné : somme des ingrédients de la recette ; boisson / produit revendu : coût du produit en stock (1 unité).
 */
export function profitabilityRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/profitability', { preHandler: ctx.auth.require('admin') }, async (req): Promise<ProfitabilityDto> => {
    const today = todayInTz(ctx.cfg.APP_TZ);
    const q = z.object({ from: dateSchema.optional(), to: dateSchema.optional(), basis: z.enum(['average', 'last']).default('average') }).parse(req.query);
    const from = q.from ?? `${today.slice(0, 7)}-01`;
    const to = q.to ?? today;
    const db = ctx.db;

    const [items, recipes, costs, sold] = await Promise.all([
      db.query<any>(`select m.id, m.name, c.name as category_name, m.kind, m.price, m.stock_item_id, m.stock_qty
                     from menu_items m join categories c on c.id = m.category_id where m.is_active order by c.sort_order, lower(c.name), lower(m.name)`),
      db.query<any>(`select r.menu_item_id, r.stock_item_id, r.qty_per_portion, s.name, s.unit
                     from recipes r join stock_items s on s.id = r.stock_item_id order by lower(s.name)`),
      db.query<{ stock_item_id: string; avg_cost: number | null; last_cost: number | null }>(UNIT_COSTS_SQL),
      db.query<{ menu_item_id: string; qty: number; revenue: number }>(
        `select l.menu_item_id, sum(l.quantity)::bigint as qty, sum(l.quantity * l.unit_price)::bigint as revenue
         from order_lines l join orders o on o.id = l.order_id
         where o.status = 'paid' and o.business_date >= $1::date and o.business_date <= $2::date group by l.menu_item_id`,
        [from, to],
      ),
    ]);

    const unitCost = new Map(costs.rows.map((c) => [c.stock_item_id, q.basis === 'last' ? c.last_cost : c.avg_cost]));
    const soldBy = new Map(sold.rows.map((s) => [s.menu_item_id, s]));
    const stockInfo = new Map<string, { name: string; unit: string }>();
    for (const r of recipes.rows) stockInfo.set(r.stock_item_id, { name: r.name, unit: r.unit });
    const resaleIds = items.rows.filter((m) => m.kind === 'resale' && m.stock_item_id).map((m) => m.stock_item_id);
    if (resaleIds.length) {
      const s = await db.query<{ id: string; name: string; unit: string }>(`select id, name, unit from stock_items where id = any(string_to_array($1, ',')::uuid[])`, [resaleIds.join(',')]);
      for (const x of s.rows) stockInfo.set(x.id, { name: x.name, unit: x.unit });
    }

    const rows: ProfitabilityRowDto[] = items.rows.map((m) => {
      const raw: { stock_item_id: string; qty: number }[] =
        m.kind === 'resale' ? [{ stock_item_id: m.stock_item_id, qty: Number(m.stock_qty) }] : recipes.rows.filter((r) => r.menu_item_id === m.id).map((r) => ({ stock_item_id: r.stock_item_id, qty: Number(r.qty_per_portion) }));
      const lines: ProfitCostLine[] = raw.map((l) => {
        const uc = unitCost.get(l.stock_item_id);
        const info = stockInfo.get(l.stock_item_id);
        const u = uc == null ? null : Number(uc);
        return { stock_item_id: l.stock_item_id, name: info?.name ?? '?', unit: info?.unit ?? '', qty: l.qty, unit_cost: u == null ? null : Math.round(u * 100) / 100, cost: u == null ? null : Math.round(u * l.qty) };
      });
      const cost = lines.reduce((s, l) => s + (l.cost ?? 0), 0);
      const missing = lines.length === 0 || lines.some((l) => l.cost == null);
      const s = soldBy.get(m.id);
      const sold_qty = Number(s?.qty ?? 0);
      const revenue = Number(s?.revenue ?? 0);
      return {
        id: m.id, name: m.name, category_name: m.category_name, kind: m.kind, price: m.price, cost,
        margin: m.price - cost,
        margin_percent: m.price ? Math.round(((m.price - cost) / m.price) * 1000) / 10 : 0,
        cost_percent: m.price ? Math.round((cost / m.price) * 1000) / 10 : 0,
        missing_cost: missing, lines, sold_qty, revenue, cost_total: cost * sold_qty, profit_total: revenue - cost * sold_qty,
      };
    });
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const cost_total = rows.reduce((s, r) => s + r.cost_total, 0);
    return { from, to, basis: q.basis, rows, totals: { revenue, cost_total, profit_total: revenue - cost_total, margin_percent: revenue ? Math.round(((revenue - cost_total) / revenue) * 1000) / 10 : 0 } };
  });
}
