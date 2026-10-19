import ExcelJS from 'exceljs';
import { EXPENSE_CATEGORIES } from '@resto/shared';
import type { Db, Queryable } from '../db.js';
import { syncPurchaseMovement } from './stock.js';

export interface ImportReport {
  categories: number;
  stock_items: number;
  menu_items: number;
  recipe_lines: number;
  suppliers: number;
  purchases: number;
  opening_stock: number;
  expenses: number;
  tables: number;
  warnings: string[];
}

/* ───────── utilitaires de lecture ───────── */
type Cell = ExcelJS.CellValue;

function plain(v: Cell): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return o.result;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return o.text;
    return null;
  }
  return v;
}
const str = (v: Cell) => String(plain(v) ?? '').replace(/\s+/g, ' ').trim();
const key = (s: string) => s.toLowerCase();
function num(v: Cell): number | null {
  const p = plain(v);
  if (typeof p === 'number') return p;
  if (typeof p === 'string') {
    const d = p.replace(/[^\d.,-]/g, '').replace(',', '.');
    return d ? Number(d) : null;
  }
  return null;
}
function date(v: Cell): string | null {
  const p = plain(v);
  if (p instanceof Date && !Number.isNaN(p.getTime())) return p.toISOString().slice(0, 10);
  return null;
}
const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

const UNIT_ALIASES: Record<string, string> = {
  pieces: 'pièce', piece: 'pièce', pcs: 'pièce', bouteile: 'bouteille', litre: 'l', litres: 'l', boite: 'boîte',
};
const normUnit = (u: string) => {
  const k = u.trim().toLowerCase();
  return UNIT_ALIASES[k] ?? k;
};

function rows(ws: ExcelJS.Worksheet | undefined, from = 3): ExcelJS.Row[] {
  const out: ExcelJS.Row[] = [];
  ws?.eachRow({ includeEmpty: false }, (row, n) => {
    if (n >= from) out.push(row);
  });
  return out;
}

/** Importe le classeur Excel d'origine (catalogue + historique d'achats/dépenses). Ne modifie jamais ce qui existe déjà. */
export async function importWorkbook(db: Db, file: string, opts: { tables?: number } = {}): Promise<ImportReport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const report: ImportReport = {
    categories: 0, stock_items: 0, menu_items: 0, recipe_lines: 0, suppliers: 0,
    purchases: 0, opening_stock: 0, expenses: 0, tables: 0, warnings: [],
  };
  const warn = (m: string) => report.warnings.push(m);

  /* ── 1. lecture ── */
  const menu = rows(wb.getWorksheet('Menu'))
    .map((r) => ({
      name: str(r.getCell(1).value),
      category: titleCase(str(r.getCell(2).value)) || 'Divers',
      kind: str(r.getCell(3).value).toLowerCase().startsWith('produit') ? ('resale' as const) : ('cooked' as const),
      price: num(r.getCell(4).value),
    }))
    .filter((m) => m.name);

  const stockSheet = wb.getWorksheet('Stock');
  const stockNames = new Map<string, { name: string; kind: 'ingredient' | 'product'; min: number }>();
  for (const r of rows(stockSheet)) {
    const ing = str(r.getCell(1).value);
    if (ing) stockNames.set(key(ing), { name: ing, kind: 'ingredient', min: num(r.getCell(5).value) ?? 0 });
    const prod = str(r.getCell(7).value);
    if (prod) stockNames.set(key(prod), { name: prod, kind: 'product', min: num(r.getCell(11).value) ?? 0 });
  }

  const recipes = rows(wb.getWorksheet('Recettes'))
    .map((r) => ({
      dish: str(r.getCell(1).value),
      ingredient: str(r.getCell(2).value),
      qty: num(r.getCell(3).value),
      unit: normUnit(str(r.getCell(4).value)),
    }))
    .filter((r) => r.dish && r.ingredient);

  const ingPurchases = rows(wb.getWorksheet('Achats_Ingredients'))
    .map((r) => ({
      date: date(r.getCell(1).value),
      item: str(r.getCell(2).value),
      qty: num(r.getCell(3).value),
      unit: normUnit(str(r.getCell(4).value)),
      price: num(r.getCell(5).value),
      supplier: str(r.getCell(7).value),
      kind: 'ingredient' as const,
    }))
    .filter((p) => p.item);
  const prodPurchases = rows(wb.getWorksheet('Achats_Produits'))
    .map((r) => ({
      date: date(r.getCell(1).value),
      item: str(r.getCell(2).value),
      qty: num(r.getCell(3).value),
      unit: 'pièce',
      price: num(r.getCell(4).value),
      supplier: str(r.getCell(6).value),
      kind: 'product' as const,
    }))
    .filter((p) => p.item);

  const expenses = rows(wb.getWorksheet('Depense_Charge'))
    .map((r) => ({
      date: date(r.getCell(1).value),
      label: str(r.getCell(2).value),
      category: str(r.getCell(3).value),
      amount: num(r.getCell(4).value),
    }))
    .filter((e) => e.date && e.label && e.amount);

  /* ── 2. articles de stock (ingrédients + produits) ── */
  const wanted = new Map(stockNames);
  for (const p of [...ingPurchases, ...prodPurchases]) {
    if (!wanted.has(key(p.item))) {
      wanted.set(key(p.item), { name: p.item, kind: p.kind, min: 0 });
      warn(`« ${p.item} » absent de l'onglet Stock : créé depuis les achats`);
    }
  }
  for (const r of recipes) {
    if (!wanted.has(key(r.ingredient))) {
      wanted.set(key(r.ingredient), { name: r.ingredient, kind: 'ingredient', min: 0 });
      warn(`Ingrédient « ${r.ingredient} » (recette « ${r.dish} ») absent du Stock : créé`);
    }
  }
  for (const m of menu) {
    if (m.kind === 'resale' && !wanted.has(key(m.name))) {
      wanted.set(key(m.name), { name: m.name, kind: 'product', min: 0 });
      warn(`Produit revendu « ${m.name} » absent du Stock : créé`);
    }
  }

  const recipeUnit = new Map<string, string>();
  for (const r of recipes) if (r.unit && !recipeUnit.has(key(r.ingredient))) recipeUnit.set(key(r.ingredient), r.unit);
  const purchaseUnit = new Map<string, string>();
  for (const p of ingPurchases) if (p.unit && !purchaseUnit.has(key(p.item))) purchaseUnit.set(key(p.item), p.unit);

  const factors = new Map<string, number>(); // clé -> purchase_factor
  const stockIds = new Map<string, string>();

  return db.tx(async (q) => {
    const idOf = async (sql: string, insertParams: unknown[], selectSql: string, selectParams: unknown[]) => {
      const ins = await q.query<{ id: string }>(sql, insertParams);
      if (ins.rows[0]) return { id: ins.rows[0].id, created: true };
      return { id: (await q.query<{ id: string }>(selectSql, selectParams)).rows[0]!.id, created: false };
    };

    // catégories
    const catIds = new Map<string, string>();
    let order = 0;
    for (const name of [...new Set(menu.map((m) => m.category))]) {
      const r = await idOf(
        'insert into categories (name, sort_order) values ($1,$2) on conflict ((lower(name))) do nothing returning id',
        [name, order++],
        'select id from categories where lower(name) = lower($1)',
        [name],
      );
      catIds.set(key(name), r.id);
      if (r.created) report.categories++;
    }

    // articles de stock
    for (const [k, s] of wanted) {
      const stockUnit = recipeUnit.get(k) ?? purchaseUnit.get(k) ?? (s.kind === 'product' ? 'pièce' : 'unité');
      const pUnit = s.kind === 'product' ? 'pièce' : (purchaseUnit.get(k) ?? stockUnit);
      let factor = 1;
      if (pUnit !== stockUnit) {
        if ((pUnit === 'kg' && stockUnit === 'g') || (pUnit === 'l' && stockUnit === 'ml')) factor = 1000;
        else warn(`Conversion à vérifier pour « ${s.name} » : achat en ${pUnit}, recette en ${stockUnit} (facteur mis à 1)`);
      }
      factors.set(k, factor);
      const r = await idOf(
        `insert into stock_items (name, kind, unit, min_qty, purchase_unit, purchase_factor)
         values ($1,$2,$3,$4,$5,$6) on conflict ((lower(name))) do nothing returning id`,
        [s.name, s.kind, stockUnit, s.min, pUnit, factor],
        'select id from stock_items where lower(name) = lower($1)',
        [s.name],
      );
      stockIds.set(k, r.id);
      if (r.created) report.stock_items++;
    }

    // menu
    const menuIds = new Map<string, string>();
    for (const m of menu) {
      if (m.price == null) warn(`Prix manquant pour « ${m.name} » : mis à 0`);
      const r = await idOf(
        `insert into menu_items (name, category_id, kind, price, stock_item_id)
         values ($1,$2,$3,$4,$5) on conflict ((lower(name))) do nothing returning id`,
        [m.name, catIds.get(key(m.category)), m.kind, Math.round(m.price ?? 0), m.kind === 'resale' ? stockIds.get(key(m.name)) : null],
        'select id from menu_items where lower(name) = lower($1)',
        [m.name],
      );
      menuIds.set(key(m.name), r.id);
      if (r.created) report.menu_items++;
    }

    // recettes
    for (const r of recipes) {
      const menuId = menuIds.get(key(r.dish));
      if (!menuId) {
        warn(`Recette ignorée : le plat « ${r.dish} » n'existe pas dans le Menu`);
        continue;
      }
      if (!r.qty || r.qty <= 0) {
        warn(`Recette « ${r.dish} » / « ${r.ingredient} » : quantité manquante, ignorée`);
        continue;
      }
      const ins = await q.query(
        `insert into recipes (menu_item_id, stock_item_id, qty_per_portion) values ($1,$2,$3)
         on conflict (menu_item_id, stock_item_id) do nothing`,
        [menuId, stockIds.get(key(r.ingredient)), r.qty],
      );
      report.recipe_lines += ins.rowCount;
    }

    // historique : uniquement sur base vide (évite les doublons si on relance l'import)
    const hasHistory = async (table: string) =>
      ((await q.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n) > 0;

    if (await hasHistory('purchases')) {
      warn("Achats déjà présents : historique d'achats non réimporté");
    } else {
      const supplierIds = new Map<string, string>();
      const supplier = async (name: string) => {
        if (!name) return null;
        const k = key(name);
        if (supplierIds.has(k)) return supplierIds.get(k)!;
        const r = await idOf(
          'insert into suppliers (name) values ($1) on conflict ((lower(name))) do nothing returning id',
          [name], 'select id from suppliers where lower(name) = lower($1)', [name],
        );
        if (r.created) report.suppliers++;
        supplierIds.set(k, r.id);
        return r.id;
      };
      for (const p of [...ingPurchases, ...prodPurchases]) {
        const stockId = stockIds.get(key(p.item))!;
        if (!p.qty || p.qty <= 0) continue;
        if (p.date && p.price != null) {
          const ins = await q.query<{ id: string }>(
            `insert into purchases (date, stock_item_id, quantity, unit_price, supplier_id, note)
             values ($1,$2,$3,$4,$5,'Import Excel') returning id`,
            [p.date, stockId, p.qty, Math.round(p.price), await supplier(p.supplier)],
          );
          await syncPurchaseMovement(q, ins.rows[0]!.id, null);
          report.purchases++;
        } else {
          // ligne sans date ou sans prix : on la traite comme du stock initial, sans impact sur les comptes
          await q.query(
            `insert into stock_movements (stock_item_id, qty, reason, note) values ($1,$2,'adjustment','Stock initial (import Excel)')`,
            [stockId, p.qty * (factors.get(key(p.item)) ?? 1)],
          );
          report.opening_stock++;
        }
      }
    }

    if (await hasHistory('expenses')) {
      warn('Dépenses déjà présentes : historique de dépenses non réimporté');
    } else {
      for (const e of expenses) {
        const cat = EXPENSE_CATEGORIES.find((c) => key(c) === key(e.category)) ?? 'Autre';
        await q.query('insert into expenses (date, label, category, amount) values ($1,$2,$3,$4)', [
          e.date, e.label, cat, Math.round(e.amount!),
        ]);
        report.expenses++;
      }
    }

    // tables de la salle
    if (opts.tables && !(await hasHistory('restaurant_tables'))) {
      for (let i = 1; i <= opts.tables; i++) {
        await q.query('insert into restaurant_tables (name, sort_order) values ($1,$2)', [`Table ${i}`, i]);
        report.tables++;
      }
    }
    warn('Les ventes de test du classeur (Commande_Table / Enr_Vente) ne sont pas importées.');
    return report;
  });
}

export type { Queryable };
