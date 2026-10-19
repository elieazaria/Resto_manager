import type { FastifyInstance } from 'fastify';
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@resto/shared';
import { audit } from '../auth.js';
import type { Ctx } from '../context.js';

export function settingsRoutes(app: FastifyInstance, ctx: Ctx) {
  const load = async (): Promise<Settings> => {
    const { rows } = await ctx.db.query<{ key: string; value: unknown }>('select key, value from settings');
    const merged = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
    const parsed = settingsSchema.safeParse(merged);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  };

  // Nécessaire au ticket (en-tête, pied, largeur) : lisible par le caissier
  app.get('/settings', { preHandler: ctx.auth.require('settings:read') }, load);

  app.put('/settings', { preHandler: ctx.auth.require('admin') }, async (req) => {
    const b = settingsSchema.parse(req.body);
    await ctx.db.tx(async (q) => {
      for (const [key, value] of Object.entries(b)) {
        await q.query(
          'insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value',
          [key, JSON.stringify(value)],
        );
      }
      await audit(q, req.user, 'settings.update', 'settings');
    });
    return load();
  });
}
