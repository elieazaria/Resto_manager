import { buildApp } from './app.js';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createPgDb } from './db.js';
import { migrate } from './migrate.js';
import { ensureBootstrapAdmin } from './services/bootstrap.js';

const cfg = loadConfig();
const db = createPgDb(cfg);

if (cfg.AUTO_MIGRATE) await migrate(db);
await ensureBootstrapAdmin(db, createAuth(cfg, db), cfg.BOOTSTRAP_ADMIN_USERNAME, cfg.BOOTSTRAP_ADMIN_PASSWORD);

const app = await buildApp(cfg, db);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} reçu, arrêt…`);
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: cfg.PORT, host: cfg.HOST });
