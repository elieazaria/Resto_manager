import type { Queryable } from '../db.js';

export const STOCK_LEVELS_SQL = `
  select s.id, s.name, s.kind, s.unit, s.min_qty,
         coalesce(sum(m.qty), 0)::float8 as qty,
         -- alerte : sous le seuil défini (>0), ou stock négatif (ventes sans stock saisi). Un article sans seuil n'alerte pas.
         ((s.min_qty > 0 and coalesce(sum(m.qty), 0) <= s.min_qty) or coalesce(sum(m.qty), 0) < 0) as low
  from stock_items s left join stock_movements m on m.stock_item_id = s.id
  where s.is_active
  group by s.id`;

/** Le mouvement de stock d'un achat = quantité achetée × facteur de conversion (unité d'achat -> unité de stock). */
export async function syncPurchaseMovement(q: Queryable, purchaseId: string, userId: string | null) {
  await q.query(`delete from stock_movements where ref_id = $1 and reason = 'purchase'`, [purchaseId]);
  await q.query(
    `insert into stock_movements (stock_item_id, qty, reason, ref_id, created_by, note)
     select p.stock_item_id, p.quantity * s.purchase_factor, 'purchase', p.id, $2, 'Achat'
     from purchases p join stock_items s on s.id = p.stock_item_id where p.id = $1`,
    [purchaseId, userId],
  );
}
