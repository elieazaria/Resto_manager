import { randomUUID } from 'node:crypto';
import type { Auth } from '../auth.js';
import type { Queryable } from '../db.js';

/** Crée un gérant (CLI `create-admin` ou variables BOOTSTRAP_ADMIN_* au premier démarrage). */
export async function createManager(
  q: Queryable,
  auth: Auth,
  username: string,
  password: string,
  fullName = 'Gérant',
): Promise<string> {
  const id = randomUUID();
  await q.query(
    `insert into app_users (id, username, full_name, role, password_hash) values ($1,$2,$3,'manager',$4)`,
    [id, username, fullName, await auth.hashPassword(password)],
  );
  return id;
}

export async function ensureBootstrapAdmin(
  q: Queryable,
  auth: Auth,
  username?: string,
  password?: string,
  log: (m: string) => void = console.log,
) {
  if (!username || !password) return;
  const { rows } = await q.query<{ n: number }>(`select count(*)::int as n from app_users where role = 'manager'`);
  if (rows[0]!.n > 0) return;
  await createManager(q, auth, username, password);
  log(`premier gérant créé : ${username} (pensez à changer le mot de passe et à retirer BOOTSTRAP_ADMIN_*)`);
}
