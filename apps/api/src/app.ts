import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { createAuth } from './auth.js';
import type { Config } from './config.js';
import type { Ctx } from './context.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import { Hub } from './realtime.js';
import { authRoutes } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { orderRoutes } from './routes/orders.js';
import { settingsRoutes } from './routes/settings.js';
import { stockRoutes } from './routes/stock.js';
import { userRoutes } from './routes/users.js';

export async function buildApp(cfg: Config, db: Db, opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : cfg.NODE_ENV === 'development'
          ? { transport: { target: 'pino-pretty' } }
          : { redact: ['req.headers.authorization'] },
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 256 * 1024,
  });

  const auth = createAuth(cfg, db);
  const hub = new Hub();
  const ctx: Ctx = { cfg, db, auth, hub };

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  if (cfg.corsOrigins.length) {
    await app.register(cors, { origin: cfg.corsOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  }
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctxt) => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: `Trop de tentatives, réessayez dans ${ctxt.after}`,
    }),
  });
  await app.register(websocket, { options: { maxPayload: 4096 } });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code, message: err.message, ...err.extra });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'VALIDATION',
        message: err.issues[0]?.message ?? 'Données invalides',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    switch (err.code) {
      case '23505':
        return reply.status(409).send({ error: 'DUPLICATE', message: 'Cette valeur existe déjà' });
      case '23503': {
        const stillUsed = String(err.detail ?? '').includes('still referenced');
        return reply.status(409).send({
          error: stillUsed ? 'IN_USE' : 'BAD_REFERENCE',
          message: stillUsed
            ? 'Élément utilisé ailleurs : désactivez-le plutôt que de le supprimer'
            : 'Référence invalide',
        });
      }
      case '23514':
        return reply.status(400).send({ error: 'CONSTRAINT', message: 'Valeur non autorisée' });
      case '22P02':
      case '22007':
      case '22008':
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Valeur invalide' });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: err.code ?? 'ERROR', message: err.message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'INTERNAL', message: 'Erreur interne' });
  });

  app.get('/healthz', async () => {
    await db.query('select 1');
    return { ok: true };
  });

  await app.register(
    async (api) => {
      authRoutes(api, ctx);
      userRoutes(api, ctx);
      catalogRoutes(api, ctx);
      stockRoutes(api, ctx);
      orderRoutes(api, ctx);
      dashboardRoutes(api, ctx);
      settingsRoutes(api, ctx);
      api.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'NOT_FOUND', message: 'Route inconnue' }));
    },
    { prefix: '/api' },
  );

  // WebSocket : authentification par premier message (pas de jeton dans l'URL)
  app.get('/ws', { websocket: true }, (socket) => {
    let authed = false;
    const timer = setTimeout(() => {
      if (!authed) socket.close(4401, 'auth timeout');
    }, 5000);
    socket.on('message', async (raw: Buffer) => {
      if (authed) return;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type !== 'auth' || typeof msg.token !== 'string') throw new Error('bad message');
        const user = await auth.verifyToken(msg.token);
        authed = true;
        hub.add(socket, user);
        socket.send(JSON.stringify({ type: 'ready' }));
      } catch {
        socket.close(4401, 'unauthorized');
      }
    });
    socket.on('close', () => {
      clearTimeout(timer);
      hub.remove(socket);
    });
  });
  hub.start();
  app.addHook('onClose', async () => hub.stop());

  // Front-end (build Vite) servi par la même origine : pas de CORS, cookies/SW simples.
  if (cfg.WEB_DIST && existsSync(path.join(cfg.WEB_DIST, 'index.html'))) {
    const noCache = new Set(['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest']);
    await app.register(fastifyStatic, {
      root: path.resolve(cfg.WEB_DIST),
      wildcard: false,
      cacheControl: false,
      setHeaders(res, file) {
        const name = path.basename(file);
        res.header(
          'Cache-Control',
          noCache.has(name) || name.startsWith('workbox-')
            ? 'no-cache'
            : file.includes(`${path.sep}assets${path.sep}`)
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600',
        );
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Route inconnue' });
    });
  }

  return app;
}
