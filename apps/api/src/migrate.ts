import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applique les fichiers migrations/*.sql non encore appliqués, dans l'ordre alphabétique. */
export async function migrate(db: Db, log: (m: string) => void = console.log): Promise<string[]> {
  await db.exec(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(727274)'); // évite deux migrations concurrentes
      const done = await q.query('select 1 from schema_migrations where name = $1', [file]);
      if (done.rowCount) return;
      await q.exec(sql);
      await q.query('insert into schema_migrations (name) values ($1)', [file]);
      applied.push(file);
      log(`migration appliquée : ${file}`);
    });
  }
  // La table de suivi elle-même ne doit pas être exposée par PostgREST.
  await db.exec('alter table schema_migrations enable row level security');
  return applied;
}
