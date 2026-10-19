import { PGlite, types as pgliteTypes } from '@electric-sql/pglite';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPgDb, type Db, type Queryable } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createAuth } from '../src/auth.js';
import { createManager } from '../src/services/bootstrap.js';

/** PGlite = vrai Postgres compilé en WASM : aucun serveur à installer. */
function pgliteDb(): Db {
  const pg = new PGlite({
    parsers: {
      [pgliteTypes.NUMERIC]: (v: string) => parseFloat(v),
      [pgliteTypes.INT8]: (v: string) => parseInt(v, 10),
      [pgliteTypes.DATE]: (v: string) => v,
    },
  });
  const wrap = (c: { query: PGlite['query']; exec: PGlite['exec'] }): Queryable => ({
    async query(sql, params) {
      const r = await c.query(sql, params as any[]);
      return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length };
    },
    async exec(sql) {
      await c.exec(sql);
    },
  });
  return {
    ...wrap(pg),
    tx: (fn) => pg.transaction((t) => fn(wrap(t as any))),
    close: () => pg.close(),
  };
}

export const config = (over: Record<string, string> = {}): Config =>
  loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://unused',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    MAX_FAILED_ATTEMPTS: '3',
    LOCK_MINUTES: '5',
    ...over,
  });

export async function makeTestApp() {
  const cfg = config();
  let db: Db;
  if (process.env.TEST_DATABASE_URL) {
    // Garde-fou : on EFFACE le schéma public — uniquement sur une base dont le nom contient « test ».
    const dbName = new URL(process.env.TEST_DATABASE_URL).pathname;
    if (!/test/i.test(dbName)) throw new Error(`TEST_DATABASE_URL doit viser une base de test (nom contenant "test"), reçu : ${dbName}`);
    // Postgres réel : on repart d'un schéma vierge
    db = createPgDb(cfg);
    await db.exec('drop schema public cascade; create schema public;');
  } else {
    db = pgliteDb();
  }
  await migrate(db, () => {});
  const app = await buildApp(cfg, db, { logger: false });
  await createManager(db, createAuth(cfg, db), 'admin', 'admin-password-1', 'Admin Test');

  const call = async (method: string, url: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await app.inject({
      method: method as any,
      url,
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      payload: opts.body as any,
    });
    let json: any;
    try {
      json = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      json = res.body;
    }
    return { status: res.statusCode, json };
  };
  const login = async (username: string, password: string) => (await call('POST', '/api/auth/login', { body: { username, password } })).json?.token as string;
  return { app, db, cfg, call, login, close: async () => { await app.close(); await db.close(); } };
}
