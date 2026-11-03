import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: string;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Antananarivo' }).format(new Date());
const call = (m: string, u: string, body?: unknown) => t.call(m as any, u, { token: admin, body });

beforeAll(async () => { t = await makeTestApp(); admin = await t.login('admin', 'admin-password-1'); });
afterAll(() => t.close());

describe('rentabilité des menus', () => {
  it('coût = prix d’achat des ingrédients ; boissons revendues incluses', async () => {
    const cat = (await call('POST', '/api/categories', { name: 'Plat' })).json.id;
    const riz = (await call('POST', '/api/stock-items', { name: 'RIZ', kind: 'ingredient', unit: 'g', min_qty: 0, purchase_unit: 'kg', purchase_factor: 1000 })).json.id;
    const coca = (await call('POST', '/api/stock-items', { name: 'COCA', kind: 'product', unit: 'pièce', min_qty: 0, purchase_unit: 'pièce', purchase_factor: 1 })).json.id;
    const plat = (await call('POST', '/api/menu-items', { name: 'Riz cantonais', category_id: cat, kind: 'cooked', price: 12000 })).json.id;
    const boisson = (await call('POST', '/api/menu-items', { name: 'Coca 33cl', category_id: cat, kind: 'resale', price: 3000, stock_item_id: coca })).json.id;
    await call('PUT', `/api/menu-items/${plat}/recipe`, { lines: [{ stock_item_id: riz, qty_per_portion: 200 }] });

    // avant tout achat : coût inconnu, signalé
    let r = (await call('GET', '/api/profitability')).json;
    expect(r.rows.find((x: any) => x.id === plat).missing_cost).toBe(true);

    await call('POST', '/api/purchases', { date: today, stock_item_id: riz, quantity: 5, unit_price: 3000 }); // 3 Ar / g
    await call('POST', '/api/purchases', { date: today, stock_item_id: coca, quantity: 10, unit_price: 2000 });
    r = (await call('GET', '/api/profitability')).json;
    const p = r.rows.find((x: any) => x.id === plat);
    expect(p.cost).toBe(600);
    expect(p.margin).toBe(11400);
    expect(p.margin_percent).toBe(95);
    expect(p.missing_cost).toBe(false);
    const b = r.rows.find((x: any) => x.id === boisson);
    expect(b.cost).toBe(2000);
    expect(b.margin).toBe(1000);

    // moyenne pondérée vs dernier prix : 5 kg à 3000 puis 5 kg à 5000 → moyenne 4 Ar/g, dernier 5 Ar/g
    await call('POST', '/api/purchases', { date: today, stock_item_id: riz, quantity: 5, unit_price: 5000 });
    expect((await call('GET', '/api/profitability')).json.rows.find((x: any) => x.id === plat).cost).toBe(800);
    expect((await call('GET', '/api/profitability?basis=last')).json.rows.find((x: any) => x.id === plat).cost).toBe(1000);
  });

  it('réservé au gérant', async () => {
    expect((await t.call('GET', '/api/profitability')).status).toBe(401);
  });
});

describe('verre de jus = 1/6 de bouteille', () => {
  it('6 verres retirent exactement 1 bouteille ; bouteille et verre ont leur propre prix', async () => {
    const cat = (await call('POST', '/api/categories', { name: 'Boisson' })).json.id;
    // stock en ml, acheté à la bouteille de 1,5 L
    const jus = (await call('POST', '/api/stock-items', { name: 'Jus naturel 1,5 L', kind: 'product', unit: 'ml', min_qty: 0, purchase_unit: 'bouteille', purchase_factor: 1500 })).json.id;
    const verre = (await call('POST', '/api/menu-items', { name: 'Verre de jus', category_id: cat, kind: 'cooked', price: 2000 })).json.id;
    const bouteille = (await call('POST', '/api/menu-items', { name: 'Jus naturel 1,5 L', category_id: cat, kind: 'resale', price: 9000, stock_item_id: jus, stock_qty: 1500 })).json.id;
    expect((await call('PUT', `/api/menu-items/${verre}/recipe`, { lines: [{ stock_item_id: jus, qty_per_portion: 250 }] })).status).toBe(200);

    // inventaire : 12 bouteilles (18 000 ml) à 4 500 Ar la bouteille → prix de référence, sans achat
    const adj = await call('POST', '/api/stock/adjust', { stock_item_id: jus, counted: 18000, unit_cost: 4500 });
    expect(adj.status).toBe(200);
    let row = (await call('GET', '/api/stock')).json.find((x: any) => x.id === jus);
    expect(row.purchase_cost).toBe(4500);
    expect(row.unit_cost).toBe(3);

    const table = (await call('POST', '/api/tables', { name: 'T1' })).json.id;
    const sell = async (item: string, qty: number) => {
      const id = crypto.randomUUID();
      await call('PUT', `/api/orders/${id}`, { table_id: table, lines: [{ menu_item_id: item, quantity: qty }] });
      expect((await call('POST', `/api/orders/${id}/pay`, { method: 'cash' })).status).toBe(200);
    };
    await sell(verre, 6);
    row = (await call('GET', '/api/stock')).json.find((x: any) => x.id === jus);
    expect(row.qty).toBe(16500); // 12 bouteilles − 1 = 11 → 16 500 ml
    await sell(bouteille, 1);
    row = (await call('GET', '/api/stock')).json.find((x: any) => x.id === jus);
    expect(row.qty).toBe(15000);

    // rentabilité : verre = 250 ml × 3 Ar = 750 Ar ; bouteille = 4 500 Ar
    const r = (await call('GET', '/api/profitability')).json.rows;
    expect(r.find((x: any) => x.id === verre).cost).toBe(750);
    expect(r.find((x: any) => x.id === verre).margin).toBe(1250);
    expect(r.find((x: any) => x.id === bouteille).cost).toBe(4500);
    expect(r.find((x: any) => x.id === bouteille).margin).toBe(4500);
  });
});
