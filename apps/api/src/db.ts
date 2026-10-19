import pg from 'pg';
import type { Config } from './config.js';

/**
 * Petite abstraction au-dessus de Postgres : le code métier ne connaît que `Queryable` / `Db`.
 * - production / dev : pool `pg` (Supabase ou Postgres local)
 * - tests rapides : PGlite (voir test/helpers.ts)
 */
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Exécute un script multi-instructions (migrations). */
  exec(sql: string): Promise<void>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// numeric -> number, int8 -> number, date -> 'YYYY-MM-DD' (pas de décalage de fuseau)
export const PG_PARSERS = {
  1700: (v: string) => parseFloat(v),
  20: (v: string) => parseInt(v, 10),
  1082: (v: string) => v,
} as const;

export function createPgDb(cfg: Pick<Config, 'DATABASE_URL' | 'DATABASE_SSL' | 'DATABASE_POOL_MAX'>): Db {
  for (const [oid, fn] of Object.entries(PG_PARSERS)) pg.types.setTypeParser(Number(oid), fn);

  const pool = new pg.Pool({
    connectionString: cfg.DATABASE_URL,
    max: cfg.DATABASE_POOL_MAX,
    // Supabase impose TLS. Pour vérifier le certificat, fournir le CA via NODE_EXTRA_CA_CERTS
    // et passer rejectUnauthorized à true.
    ssl: cfg.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('[pg] erreur sur client inactif :', err.message));

  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<pg.QueryResult> }): Queryable => ({
    async query(sql, params) {
      const r = await c.query(sql, params as unknown[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async exec(sql) {
      await c.query(sql);
    },
  });

  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
