import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createPgDb } from './db.js';
import { migrate } from './migrate.js';
import { importWorkbook } from './services/excelImport.js';
import { createManager } from './services/bootstrap.js';

const USAGE = `Usage :
  cli migrate
  cli create-admin <identifiant> [--password <mdp>] [--name "Nom complet"]   (ou ADMIN_PASSWORD=…)
  cli import-excel <fichier.xlsx> [--tables 12]`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const [command, ...args] = process.argv.slice(2);
const cfg = loadConfig();
const db = createPgDb(cfg);

try {
  switch (command) {
    case 'migrate': {
      const done = await migrate(db);
      console.log(done.length ? `${done.length} migration(s) appliquée(s)` : 'Base déjà à jour');
      break;
    }
    case 'create-admin': {
      const username = args[0];
      const password = flag(args, 'password') ?? process.env.ADMIN_PASSWORD;
      if (!username || !password || password.length < 8) {
        console.error('Identifiant et mot de passe (8 caractères min.) requis.\n' + USAGE);
        process.exitCode = 1;
        break;
      }
      await migrate(db);
      await createManager(db, createAuth(cfg, db), username, password, flag(args, 'name'));
      console.log(`Gérant « ${username} » créé.`);
      break;
    }
    case 'import-excel': {
      const file = args[0];
      if (!file) {
        console.error(USAGE);
        process.exitCode = 1;
        break;
      }
      await migrate(db);
      const report = await importWorkbook(db, file, { tables: Number(flag(args, 'tables') ?? 0) || undefined });
      const { warnings, ...counts } = report;
      console.log('Import terminé :', counts);
      if (warnings.length) console.log(`\n${warnings.length} point(s) à vérifier :\n- ${warnings.join('\n- ')}`);
      break;
    }
    default:
      console.error(USAGE);
      process.exitCode = 1;
  }
} finally {
  await db.close();
}
