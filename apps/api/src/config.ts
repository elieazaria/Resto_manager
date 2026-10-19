import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),

  /** Chaîne de connexion Postgres (Supabase : "Session pooler" ou "Direct connection"). */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis'),
  /** `require` pour Supabase (TLS), `disable` pour un Postgres local. */
  DATABASE_SSL: z.enum(['disable', 'require']).default('disable'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit faire au moins 32 caractères'),
  /** Durée de vie du jeton d'accès (ex. 12h = un service). */
  JWT_TTL: z.string().default('12h'),
  /** Poivre HMAC appliqué au PIN avant argon2 (défaut : dérivé de JWT_SECRET). */
  PIN_PEPPER: z.string().min(16).optional(),
  MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOCK_MINUTES: z.coerce.number().int().min(1).default(5),

  /** Origines autorisées (CORS), séparées par des virgules. Vide = même origine uniquement. */
  CORS_ORIGINS: z.string().default(''),
  APP_TZ: z.string().default('Indian/Antananarivo'),
  /** Dossier du build web (apps/web/dist) à servir en statique. */
  WEB_DIST: z.string().optional(),
  AUTO_MIGRATE: bool.default(true),
  /** Derrière un proxy (Fly, Render, Caddy…) : faire confiance à X-Forwarded-For. */
  TRUST_PROXY: bool.default(true),

  /** Création automatique du premier gérant si aucun n'existe. */
  BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).optional(),
});

export type Config = z.infer<typeof schema> & { corsOrigins: string[]; pinPepper: string };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${lines}`);
  }
  const c = parsed.data;
  return {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    pinPepper: c.PIN_PEPPER ?? `pin-pepper:${c.JWT_SECRET}`,
  };
}
