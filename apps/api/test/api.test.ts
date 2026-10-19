import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { makeTestApp } from './helpers.js';

type T = Awaited<ReturnType<typeof makeTestApp>>;
let t: T;
let admin: string;
let cashier: string;

const ids: Record<string, string> = {};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Antananarivo' }).format(new Date());

beforeAll(async () => {
  t = await makeTestApp();
  admin = await t.login('admin', 'admin-password-1');
});
afterAll(async () => {
  await t.close();
});

const stockQty = async (id: string) => (await t.call('GET', '/api/stock', { token: admin })).json.find((r: any) => r.id === id)?.qty;

describe('migrations & sécurité base', () => {
  it('active RLS sur toutes les tables du schéma public', async () => {
    const { rows } = await t.db.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
    );
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => !r.rowsecurity)).toEqual([]);
  });
});

describe('authentification', () => {
  it('refuse un mauvais mot de passe et un jeton absent', async () => {
    expect((await t.call('POST', '/api/auth/login', { body: { username: 'admin', password: 'faux-faux-faux' } })).status).toBe(401);
    expect((await t.call('GET', '/api/auth/me')).status).toBe(401);
    expect((await t.call('GET', '/api/auth/me', { token: 'abc.def.ghi' })).status).toBe(401);
  });

  it('crée un caissier avec PIN, connexion PIN OK, PIN interdit au gérant', async () => {
    const r = await t.call('POST', '/api/users', {
      token: admin,
      body: { username: 'rina', full_name: 'Rina Caisse', role: 'cashier', pin: '4321' },
    });
    expect(r.status).toBe(201);
    expect(r.json.has_pin).toBe(true);
    expect(r.json.password_hash).toBeUndefined();
    ids.rina = r.json.id;

    const ok = await t.call('POST', '/api/auth/pin-login', { body: { username: 'rina', pin: '4321' } });
    expect(ok.status).toBe(200);
    cashier = ok.json.token;
    expect(ok.json.user.role).toBe('cashier');

    // le gérant n'a pas de PIN, et le PIN-login lui est refusé même avec un mot de passe à 4-6 chiffres
    expect((await t.call('POST', '/api/auth/pin-login', { body: { username: 'admin', pin: '123456' } })).status).toBe(401);
  });

  it('verrouille le compte après trop de PIN faux (même le bon PIN est alors refusé)', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await t.call('POST', '/api/auth/pin-login', { body: { username: 'rina', pin: '0000' } })).status).toBe(401);
    }
    const locked = await t.call('POST', '/api/auth/pin-login', { body: { username: 'rina', pin: '4321' } });
    expect(locked.status).toBe(429);
    expect(locked.json.error).toBe('LOCKED');
    // le gérant peut débloquer
    expect((await t.call('POST', `/api/users/${ids.rina}/unlock`, { token: admin })).status).toBe(204);
    expect((await t.call('POST', '/api/auth/pin-login', { body: { username: 'rina', pin: '4321' } })).status).toBe(200);
  });

  it('révoque la session dès que le compte est désactivé', async () => {
    const tok = (await t.call('POST', '/api/auth/pin-login', { body: { username: 'rina', pin: '4321' } })).json.token;
    expect((await t.call('GET', '/api/auth/me', { token: tok })).status).toBe(200);
    await t.call('PATCH', `/api/users/${ids.rina}`, { token: admin, body: { is_active: false } });
    expect((await t.call('GET', '/api/auth/me', { token: tok })).status).toBe(401);
    await t.call('PATCH', `/api/users/${ids.rina}`, { token: admin, body: { is_active: true } });
    cashier = (await t.call('POST', '/api/auth/pin-login', { body: { username: 'rina', pin: '4321' } })).json.token;
  });

  it('ne permet pas de supprimer / rétrograder le dernier gérant', async () => {
    const me = (await t.call('GET', '/api/users', { token: admin })).json.find((u: any) => u.username === 'admin');
    expect((await t.call('PATCH', `/api/users/${me.id}`, { token: admin, body: { role: 'cashier' } })).status).toBe(409);
    expect((await t.call('DELETE', `/api/users/${me.id}`, { token: admin })).status).toBe(400);
  });
});

describe('catalogue (gérant) & PATCH partiel', () => {
  it('crée catégories, stock, plats, recette', async () => {
    const cat = await t.call('POST', '/api/categories', { token: admin, body: { name: 'Plat', sort_order: 1 } });
    expect(cat.status).toBe(201);
    ids.cat = cat.json.id;
    const boisson = (await t.call('POST', '/api/categories', { token: admin, body: { name: 'Boisson' } })).json.id;

    const riz = await t.call('POST', '/api/stock-items', {
      token: admin,
      body: { name: 'RIZ', kind: 'ingredient', unit: 'g', min_qty: 500, purchase_unit: 'kg', purchase_factor: 1000 },
    });
    expect(riz.status).toBe(201);
    ids.riz = riz.json.id;
    ids.coca = (
      await t.call('POST', '/api/stock-items', {
        token: admin,
        body: { name: 'COCA PM', kind: 'product', unit: 'pièce', min_qty: 2, purchase_unit: 'pièce', purchase_factor: 1 },
      })
    ).json.id;

    const plat = await t.call('POST', '/api/menu-items', {
      token: admin,
      body: { name: 'Riz cantonais', category_id: ids.cat, kind: 'cooked', price: 12000, is_active: true },
    });
    expect(plat.status).toBe(201);
    ids.plat = plat.json.id;
    ids.cocaMenu = (
      await t.call('POST', '/api/menu-items', {
        token: admin,
        body: { name: 'Coca 33cl', category_id: boisson, kind: 'resale', price: 3000, stock_item_id: ids.coca },
      })
    ).json.id;

    // un article « revendu » sans produit en stock est refusé
    expect(
      (await t.call('POST', '/api/menu-items', { token: admin, body: { name: 'X', category_id: ids.cat, kind: 'resale', price: 1 } })).status,
    ).toBe(400);

    const rec = await t.call('PUT', `/api/menu-items/${ids.plat}/recipe`, {
      token: admin,
      body: { lines: [{ stock_item_id: ids.riz, qty_per_portion: 200 }] },
    });
    expect(rec.status).toBe(200);

    ids.t1 = (await t.call('POST', '/api/tables', { token: admin, body: { name: 'Table 1', sort_order: 1 } })).json.id;
    ids.t2 = (await t.call('POST', '/api/tables', { token: admin, body: { name: 'Table 2', sort_order: 2 } })).json.id;
  });

  it("un PATCH partiel ne réinitialise pas les champs absents (is_active, prix)", async () => {
    await t.call('PATCH', `/api/menu-items/${ids.plat}`, { token: admin, body: { is_active: false } });
    const r = await t.call('PATCH', `/api/menu-items/${ids.plat}`, { token: admin, body: { price: 13000 } });
    expect(r.json.is_active).toBe(false); // resté faux
    expect(r.json.price).toBe(13000);
    await t.call('PATCH', `/api/menu-items/${ids.plat}`, { token: admin, body: { is_active: true, price: 12000 } });
  });

  it('refuse les doublons de nom (insensible à la casse)', async () => {
    const r = await t.call('POST', '/api/categories', { token: admin, body: { name: 'plat' } });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('DUPLICATE');
  });

  it("empêche de supprimer un élément utilisé (409), sans fuite d'erreur SQL", async () => {
    const r = await t.call('DELETE', `/api/categories/${ids.cat}`, { token: admin });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('IN_USE');
  });
});

describe('RBAC : le caissier ne voit que la prise de commande et l’encaissement', () => {
  it.each([
    ['GET', '/api/dashboard'],
    ['GET', '/api/users'],
    ['GET', '/api/stock'],
    ['GET', '/api/menu-items'],
    ['GET', '/api/purchases'],
    ['GET', '/api/expenses'],
    ['GET', '/api/stock-items'],
    ['GET', '/api/tables'],
    ['PUT', '/api/settings'],
  ])('%s %s => 403 pour le caissier', async (method, url) => {
    expect((await t.call(method, url, { token: cashier, body: {} })).status).toBe(403);
  });

  it('autorise menu, tables, paramètres de ticket et commandes', async () => {
    const menu = await t.call('GET', '/api/pos/menu', { token: cashier });
    expect(menu.status).toBe(200);
    expect(menu.json.items.map((i: any) => i.name)).toContain('Riz cantonais');
    expect((await t.call('GET', '/api/pos/tables', { token: cashier })).status).toBe(200);
    expect((await t.call('GET', '/api/settings', { token: cashier })).status).toBe(200);
    expect((await t.call('GET', '/api/orders', { token: cashier })).status).toBe(200);
  });
});

describe('commandes, paiement, stock', () => {
  const orderId = randomUUID();

  it('achat : le stock augmente de quantité × facteur (1 kg = 1000 g)', async () => {
    const p = await t.call('POST', '/api/purchases', {
      token: admin,
      body: { date: today(), stock_item_id: ids.riz, quantity: 5, unit_price: 3000 },
    });
    expect(p.status).toBe(201);
    expect(p.json.amount).toBe(15000);
    ids.purchase = p.json.id;
    expect(await stockQty(ids.riz)).toBe(5000);
    await t.call('POST', '/api/purchases', { token: admin, body: { date: today(), stock_item_id: ids.coca, quantity: 10, unit_price: 2000 } });
  });

  it('PUT idempotent : rejouer la même commande ne crée pas de doublon', async () => {
    const body = { table_id: ids.t1, lines: [{ menu_item_id: ids.plat, quantity: 2 }, { menu_item_id: ids.cocaMenu, quantity: 1 }] };
    const a = await t.call('PUT', `/api/orders/${orderId}`, { token: cashier, body });
    const b = await t.call('PUT', `/api/orders/${orderId}`, { token: cashier, body });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.json.total).toBe(2 * 12000 + 3000);
    expect(b.json.lines).toHaveLength(2);
    const list = await t.call('GET', '/api/orders?status=open', { token: cashier });
    expect(list.json.filter((o: any) => o.id === orderId)).toHaveLength(1);
  });

  it('ignore les prix envoyés par le client (prix = menu serveur) et refuse un article inconnu', async () => {
    const r = await t.call('PUT', `/api/orders/${randomUUID()}`, {
      token: cashier,
      body: { table_id: ids.t2, lines: [{ menu_item_id: ids.plat, quantity: 1, unit_price: 1 }] },
    });
    expect(r.json.total).toBe(12000);
    await t.call('POST', `/api/orders/${r.json.id}/cancel`, { token: cashier });
    const bad = await t.call('PUT', `/api/orders/${randomUUID()}`, {
      token: cashier,
      body: { table_id: ids.t2, lines: [{ menu_item_id: randomUUID(), quantity: 1 }] },
    });
    expect(bad.status).toBe(422);
  });

  it('refuse une 2e commande ouverte sur la même table', async () => {
    const r = await t.call('PUT', `/api/orders/${randomUUID()}`, {
      token: cashier,
      body: { table_id: ids.t1, lines: [{ menu_item_id: ids.plat, quantity: 1 }] },
    });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('TABLE_BUSY');
    expect(r.json.order_id).toBe(orderId);
  });

  it('encaissement : montant insuffisant refusé, puis succès et décrément du stock (recette + produit revendu)', async () => {
    expect((await t.call('POST', `/api/orders/${orderId}/pay`, { token: cashier, body: { method: 'cash', amount_received: 100 } })).status).toBe(422);
    const ok = await t.call('POST', `/api/orders/${orderId}/pay`, { token: cashier, body: { method: 'cash', amount_received: 30000 } });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('paid');
    expect(ok.json.amount_received).toBe(30000);
    expect(ok.json.business_date).toBe(today());
    expect(await stockQty(ids.riz)).toBe(5000 - 2 * 200);
    expect(await stockQty(ids.coca)).toBe(10 - 1);
  });

  it('encaissement rejoué = sans effet (pas de double décrément)', async () => {
    const again = await t.call('POST', `/api/orders/${orderId}/pay`, { token: cashier, body: { method: 'cash', amount_received: 30000 } });
    expect(again.status).toBe(200);
    expect(await stockQty(ids.riz)).toBe(4600);
    // et on ne peut plus modifier une commande encaissée
    const edit = await t.call('PUT', `/api/orders/${orderId}`, { token: cashier, body: { table_id: ids.t1, lines: [{ menu_item_id: ids.plat, quantity: 9 }] } });
    expect(edit.status).toBe(409);
    expect(edit.json.error).toBe('ORDER_CLOSED');
  });

  it("le caissier ne peut pas annuler une vente encaissée ; le gérant le peut avec motif et le stock est restitué", async () => {
    expect((await t.call('POST', `/api/orders/${orderId}/void`, { token: cashier, body: { reason: 'erreur' } })).status).toBe(403);
    expect((await t.call('POST', `/api/orders/${orderId}/cancel`, { token: cashier })).status).toBe(409);
    expect((await t.call('POST', `/api/orders/${orderId}/void`, { token: admin, body: { reason: '' } })).status).toBe(400);
    const v = await t.call('POST', `/api/orders/${orderId}/void`, { token: admin, body: { reason: 'Erreur de saisie' } });
    expect(v.status).toBe(200);
    expect(v.json.status).toBe('cancelled');
    expect(await stockQty(ids.riz)).toBe(5000);
    expect(await stockQty(ids.coca)).toBe(10);
  });

  it("le caissier n'accède pas à une vente d'un jour passé", async () => {
    const id = randomUUID();
    await t.call('PUT', `/api/orders/${id}`, { token: cashier, body: { table_id: ids.t2, lines: [{ menu_item_id: ids.plat, quantity: 1 }] } });
    await t.call('POST', `/api/orders/${id}/pay`, { token: cashier, body: { method: 'mvola' } });
    await t.db.query(`update orders set business_date = (business_date - 1) where id = $1`, [id]);
    expect((await t.call('GET', `/api/orders/${id}`, { token: cashier })).status).toBe(403);
    expect((await t.call('GET', `/api/orders/${id}`, { token: admin })).status).toBe(200);
    const list = await t.call('GET', '/api/orders', { token: cashier });
    expect(list.json.find((o: any) => o.id === id)).toBeUndefined();
  });
});

describe('stock, inventaire, tableau de bord', () => {
  it('inventaire : la quantité comptée crée un mouvement d’ajustement', async () => {
    const r = await t.call('POST', '/api/stock/adjust', { token: admin, body: { stock_item_id: ids.riz, counted: 300 } });
    expect(r.json.delta).toBe(-4500); // 4800 en stock (5000 - 1 portion vendue le test précédent)
    expect(await stockQty(ids.riz)).toBe(300);
    const stock = (await t.call('GET', '/api/stock', { token: admin })).json;
    expect(stock.find((s: any) => s.id === ids.riz).low).toBe(true); // 300 <= 500
  });

  it('supprimer un achat retire son mouvement de stock', async () => {
    const before = await stockQty(ids.riz);
    expect((await t.call('DELETE', `/api/purchases/${ids.purchase}`, { token: admin })).status).toBe(204);
    expect(await stockQty(ids.riz)).toBe(before - 5000);
  });

  it('tableau de bord : CA, achats, dépenses, bénéfice, trésorerie', async () => {
    const sale = randomUUID();
    await t.call('PUT', `/api/orders/${sale}`, { token: cashier, body: { table_id: ids.t2, lines: [{ menu_item_id: ids.plat, quantity: 1 }] } });
    await t.call('POST', `/api/orders/${sale}/pay`, { token: cashier, body: { method: 'mvola' } });
    await t.call('POST', '/api/expenses', { token: admin, body: { date: today(), label: 'Gaz', category: 'Cuisson', amount: 7000 } });
    await t.call('PUT', '/api/dashboard/opening-balance', { token: admin, body: { date: today(), amount: 50000 } });
    const d = (await t.call('GET', '/api/dashboard', { token: admin })).json;
    // ventes du jour : une vente mvola de 12000 (la vente de 30000 a été annulée, celle d'hier est hors du jour)
    expect(d.kpis.sales_day).toBe(12000);
    expect(d.kpis.orders_day).toBe(1);
    expect(d.kpis.purchases_day).toBe(20000); // achat riz supprimé : reste 10 × 2000 de coca
    expect(d.kpis.expenses_day).toBe(7000);
    expect(d.kpis.profit_day).toBe(12000 - 20000 - 7000);
    expect(d.cash).toEqual({ opening: 50000, inflow: 12000, outflow: 27000, remaining: 35000 });
    expect(d.series).toHaveLength(30);
    expect(d.series.at(-1).total).toBe(12000);
    expect(d.by_method[0].method).toBe('mvola');
    expect(d.top_items[0].name).toBe('Riz cantonais');
    const y = (await t.call('GET', `/api/dashboard/yearly?year=${today().slice(0, 4)}`, { token: admin })).json;
    expect(y).toHaveLength(12);
    expect(y.reduce((s: number, r: any) => s + r.sales, 0)).toBeGreaterThanOrEqual(12000);
  });

  it('paramètres : valeurs par défaut puis mise à jour par le gérant', async () => {
    const def = (await t.call('GET', '/api/settings', { token: cashier })).json;
    expect(def.paper_width).toBe(42);
    const up = await t.call('PUT', '/api/settings', {
      token: admin,
      body: { restaurant_name: 'Chez Elie', address: 'Antananarivo', phone: '034 00 000 00', ticket_footer: 'Misaotra !', paper_width: 32 },
    });
    expect(up.json.restaurant_name).toBe('Chez Elie');
    expect((await t.call('GET', '/api/settings', { token: cashier })).json.paper_width).toBe(32);
  });
});

describe('WebSocket temps réel', () => {
  it('exige une authentification puis diffuse les évènements de commande', async () => {
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (t.app.server.address() as any).port;

    // 1) mauvais jeton => fermeture 4401
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const closed = await new Promise<number>((res) => {
      bad.on('open', () => bad.send(JSON.stringify({ type: 'auth', token: 'nope' })));
      bad.on('close', (code) => res(code));
    });
    expect(closed).toBe(4401);

    // 2) bon jeton => ready, puis évènement
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: any[] = [];
    ws.on('message', (m) => messages.push(JSON.parse(m.toString())));
    await new Promise<void>((res) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'auth', token: cashier })); res(); }));
    await vi_waitFor(() => messages.some((m) => m.type === 'ready'));

    const id = randomUUID();
    await t.call('PUT', `/api/orders/${id}`, { token: cashier, body: { table_id: ids.t1, lines: [{ menu_item_id: ids.plat, quantity: 1 }] } });
    await vi_waitFor(() => messages.some((m) => m.type === 'order.changed' && m.order_id === id));
    // le caissier ne reçoit pas les évènements de stock (réservés au gérant)
    await t.call('POST', `/api/orders/${id}/pay`, { token: cashier, body: { method: 'cash' } });
    await vi_waitFor(() => messages.some((m) => m.type === 'order.changed' && m.status === 'paid'));
    expect(messages.some((m) => m.type === 'stock.changed')).toBe(false);
    ws.close();
  });
});

async function vi_waitFor(cond: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout en attente du message WebSocket');
    await new Promise((r) => setTimeout(r, 25));
  }
}
