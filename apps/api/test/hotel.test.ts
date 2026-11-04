import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let admin: string;
let room1: string, room2: string, svcMat: string;
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const call = async (m: string, u: string, body?: unknown) => { const r = await t.call(m as any, u, { token: admin, body }); if (r.status >= 400) console.log('HTTP', m, u, r.status, JSON.stringify(r.json)); return r; };

beforeAll(async () => {
  t = await makeTestApp();
  admin = await t.login('admin', 'admin-password-1');
  await call('POST', '/api/hotel/bootstrap');
});
afterAll(() => t.close());

describe('hôtel', () => {
  it('chambres, démo de base et statut en temps réel', async () => {
    const rooms = (await call('GET', '/api/hotel/rooms')).json;
    expect(rooms).toHaveLength(14);
    room1 = rooms[0].id; room2 = rooms[1].id;
    expect(rooms[0].effective_price).toBe(150000);
    svcMat = (await call('GET', '/api/hotel/services')).json[0].id;
  });

  it('devis avec prix dynamique (règle en pourcentage)', async () => {
    const ty = (await call('GET', '/api/hotel/room-types')).json[0];
    const r = await call('POST', '/api/hotel/rate-rules', { name: 'Fête', room_type_id: ty.id, date_from: day(40), date_to: day(45), mode: 'percent', value: 50, priority: 5 });
    expect(r.status).toBe(201);
    const q = (await call('GET', `/api/hotel/quote?room_id=${room1}&arrival=${day(41)}&departure=${day(43)}`)).json;
    expect(q.nights).toBe(2);
    expect(q.nightly[0].price).toBe(225000);
    const q2 = (await call('GET', `/api/hotel/quote?room_id=${room1}&arrival=${day(100)}&departure=${day(101)}`)).json;
    expect(q2.nightly[0].price).toBeGreaterThanOrEqual(150000);
  });

  it('réservation + suppléments + acompte, totaux et refus de double réservation', async () => {
    const res = await call('POST', '/api/hotel/reservations', {
      new_client: { full_name: 'Mme Test', phone: '032 11 111 11' }, room_id: room1, arrival: day(1), departure: day(4),
      adults: 2, children: 0, price_per_night: 150000, discount_percent: 0, discount_amount: 0, status: 'confirmed',
      extras: [{ service_id: svcMat, label: 'Matelas', unit_price: 20000, quantity: 2, multiplier: 3 }],
      deposit: { amount: 200000, method: 'mvola' },
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const r = res.json;
    expect(r.ref).toMatch(/^RES HM-01\/\d\d\.\d{6}$/);
    expect(r.lodging_amount).toBe(450000);
    expect(r.extras_amount).toBe(120000);
    expect(r.net_amount).toBe(570000);
    expect(r.paid_amount).toBe(200000);
    expect(r.balance).toBe(370000);
    expect(r.pay_status).toBe('partial');
    // chevauchement refusé ; départ le jour d'arrivée d'une autre = OK
    const clash = await call('POST', '/api/hotel/reservations', { client_id: r.client_id, room_id: room1, arrival: day(3), departure: day(5), adults: 1, children: 0, price_per_night: 150000, status: 'option' });
    expect(clash.status).toBe(409);
    expect(clash.json.error).toBe('ROOM_BUSY');
    const ok = await call('POST', '/api/hotel/reservations', { client_id: r.client_id, room_id: room1, arrival: day(4), departure: day(5), adults: 1, children: 0, price_per_night: 150000, status: 'option' });
    expect(ok.status).toBe(201);
  });

  it('paiements : solde, surpaiement refusé, remboursement', async () => {
    const r = (await call('GET', '/api/hotel/reservations?status=confirmed')).json[0];
    const over = await call('POST', `/api/hotel/reservations/${r.id}/payments`, { amount: r.balance + 1, method: 'cash', kind: 'payment' });
    expect(over.status).toBe(409);
    const pay = await call('POST', `/api/hotel/reservations/${r.id}/payments`, { amount: r.balance, method: 'orange_money', kind: 'payment' });
    expect(pay.json.pay_status).toBe('paid');
    const ref = await call('POST', `/api/hotel/reservations/${r.id}/payments`, { amount: 10000, method: 'cash', kind: 'refund' });
    expect(ref.json.paid_amount).toBe(r.net_amount - 10000);
  });

  it('check-in / check-out et statut de chambre', async () => {
    const created = (await call('POST', '/api/hotel/reservations', { new_client: { full_name: 'Mr Today' }, room_id: room2, arrival: day(0), departure: day(2), adults: 1, children: 0, price_per_night: 150000, status: 'confirmed' })).json;
    let room = (await call('GET', '/api/hotel/rooms')).json.find((x: any) => x.id === room2);
    expect(room.arriving_today).toBe(true);
    const ci = await call('POST', `/api/hotel/reservations/${created.id}/status`, { status: 'checked_in' });
    expect(ci.json.status).toBe('checked_in');
    room = (await call('GET', '/api/hotel/rooms')).json.find((x: any) => x.id === room2);
    expect(room.occupied_by).toBe('Mr Today');
    const bad = await call('POST', `/api/hotel/reservations/${created.id}/status`, { status: 'confirmed' });
    expect(bad.status).toBe(409);
    await call('POST', `/api/hotel/reservations/${created.id}/status`, { status: 'checked_out' });
    room = (await call('GET', '/api/hotel/rooms')).json.find((x: any) => x.id === room2);
    expect(room.tech_status).toBe('cleaning');
    expect(room.occupied_by).toBeNull();
  });

  it('annulation avec motif, réservation groupée, tableau de bord', async () => {
    const rooms = (await call('GET', '/api/hotel/rooms')).json;
    const g = await call('POST', '/api/hotel/reservations/group', { new_client: { full_name: 'Groupe' }, rooms: [{ room_id: rooms[5].id, price_per_night: 150000 }, { room_id: rooms[6].id, price_per_night: 150000 }], arrival: day(10), departure: day(12), adults: 2, children: 0, status: 'confirmed', extras: [] });
    expect(g.status).toBe(201);
    expect(g.json).toHaveLength(2);
    expect(g.json[0].group_id).toBe(g.json[1].group_id);
    expect((await call('POST', `/api/hotel/reservations/${g.json[0].id}/status`, { status: 'cancelled' })).status).toBe(400);
    const c = await call('POST', `/api/hotel/reservations/${g.json[0].id}/status`, { status: 'cancelled', reason: 'Client désiste' });
    expect(c.json.status).toBe('cancelled');
    const d = (await call('GET', '/api/hotel/dashboard')).json;
    expect(d.units_total).toBe(14);
    expect(d.monthly).toHaveLength(12);
    expect(d.weekly).toHaveLength(8);
    expect(d.outstanding_total).toBeGreaterThan(0);
  });

  it('compte client et réglages', async () => {
    const cl = (await call('GET', '/api/hotel/clients')).json.find((c: any) => c.full_name === 'Mme Test');
    const acc = (await call('GET', `/api/hotel/clients/${cl.id}/account`)).json;
    expect(acc.reservations.length).toBe(2);
    expect(acc.totals.paid).toBeGreaterThan(0);
    const s = (await call('PUT', '/api/hotel/settings', { ...(await call('GET', '/api/hotel/settings')).json, tourist_tax_per_person_night: 1000 })).json;
    expect(s.tourist_tax_per_person_night).toBe(1000);
  });

  it('valeurs démo : charger, recharger (mise à jour) puis effacer', async () => {
    const a = await call('POST', '/api/hotel/demo'); expect(a.status, JSON.stringify(a.json)).toBe(200);
    expect(a.status).toBe(200);
    const n1 = (await call('GET', '/api/hotel/reservations')).json.filter((r: any) => r.is_demo).length;
    expect(n1).toBeGreaterThan(5);
    await call('POST', '/api/hotel/demo');
    const n2 = (await call('GET', '/api/hotel/reservations')).json.filter((r: any) => r.is_demo).length;
    expect(n2).toBe(n1);
    await call('DELETE', '/api/hotel/demo');
    expect((await call('GET', '/api/hotel/reservations')).json.filter((r: any) => r.is_demo)).toHaveLength(0);
  });

  it('réservé au gérant', async () => {
    expect((await t.call('GET', '/api/hotel/rooms')).status).toBe(401);
  });
});

describe('suppléments sur place', () => {
  it('ajout et retrait pendant le séjour ; refusé après le départ', async () => {
    const rooms = (await call('GET', '/api/hotel/rooms')).json;
    const r = (await call('POST', '/api/hotel/reservations', { new_client: { full_name: 'Sur place' }, room_id: rooms[8].id, arrival: day(60), departure: day(62), adults: 1, children: 0, price_per_night: 150000, status: 'confirmed' })).json;
    const a = await call('POST', `/api/hotel/reservations/${r.id}/extras`, { label: 'Matelas', unit_price: 20000, quantity: 2, multiplier: 2 });
    expect(a.status).toBe(201);
    expect(a.json.extras_amount).toBe(80000);
    expect(a.json.net_amount).toBe(r.net_amount + 80000);
    const rm = await call('DELETE', `/api/hotel/reservations/${r.id}/extras/${a.json.extras[0].id}`);
    expect(rm.json.extras_amount).toBe(0);
    await call('POST', `/api/hotel/reservations/${r.id}/status`, { status: 'cancelled', reason: 'test' });
    expect((await call('POST', `/api/hotel/reservations/${r.id}/extras`, { label: 'X', unit_price: 1, quantity: 1, multiplier: 1 })).status).toBe(409);
  });
});

describe('PATCH partiel (valeurs par défaut non réappliquées)', () => {
  it('changer l’état technique ne réactive pas / ne réordonne pas la chambre ; modifier une réservation garde adultes et suppléments', async () => {
    const rooms = (await call('GET', '/api/hotel/rooms')).json;
    const id = rooms[9].id;
    await call('PATCH', `/api/hotel/rooms/${id}`, { is_active: false, sort_order: 77 });
    await call('PATCH', `/api/hotel/rooms/${id}`, { tech_status: 'cleaning' });
    const row = (await call('GET', '/api/hotel/rooms')).json.find((x: any) => x.id === id);
    expect(row.is_active).toBe(false);
    expect(row.sort_order).toBe(77);
    await call('PATCH', `/api/hotel/rooms/${id}`, { is_active: true, tech_status: 'normal' });

    const r = (await call('POST', '/api/hotel/reservations', { new_client: { full_name: 'Patch' }, room_id: rooms[10].id, arrival: day(80), departure: day(82), adults: 3, children: 1, price_per_night: 150000, status: 'confirmed', extras: [{ label: 'Matelas', unit_price: 20000, quantity: 1, multiplier: 1 }] })).json;
    const u = (await call('PATCH', `/api/hotel/reservations/${r.id}`, { note: 'arrivée tardive' })).json;
    expect(u.adults).toBe(3);
    expect(u.children).toBe(1);
    expect(u.extras).toHaveLength(1);
    expect(u.note).toBe('arrivée tardive');
  });
});

describe('ventes sur place (entrée piscine)', () => {
  it('le service Entrée piscine existe ; une vente apparaît dans la liste et le tableau de bord', async () => {
    await call('POST', '/api/hotel/bootstrap');
    const svc = (await call('GET', '/api/hotel/services')).json.find((s: any) => s.name === 'Entrée piscine');
    expect(svc.unit_price).toBe(20000);
    expect(svc.walk_in).toBe(true);
    const before = (await call('GET', '/api/hotel/dashboard')).json.walkin_today;
    const w = await call('POST', '/api/hotel/walkins', { service_id: svc.id, label: 'Entrée piscine', unit_price: 20000, quantity: 3, method: 'mvola', customer: 'Famille locale' });
    expect(w.status).toBe(201);
    expect(w.json.amount).toBe(60000);
    const list = (await call('GET', '/api/hotel/walkins')).json;
    expect(list.some((x: any) => x.id === w.json.id)).toBe(true);
    expect((await call('GET', '/api/hotel/dashboard')).json.walkin_today).toBe(before + 60000);
    expect((await call('DELETE', `/api/hotel/walkins/${w.json.id}`)).status).toBe(204);
    expect((await call('DELETE', `/api/hotel/walkins/${w.json.id}`)).status).toBe(404);
  });
});
