import type { Auth } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Hub } from './realtime.js';

export interface Ctx {
  cfg: Config;
  db: Db;
  auth: Auth;
  hub: Hub;
}
