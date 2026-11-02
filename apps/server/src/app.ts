import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth.js';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { registerErrorHandler } from './errors.js';
import { registerIdempotency } from './idempotency.js';
import { registerAudienceRoutes } from './routes/audience.js';
import { registerDemo } from './routes/demo.js';
import { registerFeedRoutes } from './routes/feed.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerSystemRoutes } from './routes/systems.js';
import { registerTenantRoutes } from './routes/tenants.js';
import { registerTransferRoutes } from './routes/transfer.js';

export async function buildApp(config: Config, pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel }, trustProxy: config.trustProxy });
  registerErrorHandler(app);
  await app.register(fastifyCookie);

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { status: 'ok' };
  });

  registerAuth(app, pool, config);
  registerIdempotency(app);
  registerTenantRoutes(app, pool);
  registerSystemRoutes(app, pool);
  registerAudienceRoutes(app, pool);
  registerMessageRoutes(app, pool);
  registerTransferRoutes(app, pool);
  registerFeedRoutes(app, pool, config);
  // The built @openstuff-dev/announce, so a host can load it from here instead of npm, and the
  // admin app's previews use the same code the hosts run.
  await app.register(fastifyStatic, {
    root: config.sdkDir ?? sdkDir(),
    prefix: '/sdk/',
    decorateReply: false,
    // Short, so a new server version reaches hosts soon; the ETag makes rechecks cheap.
    maxAge: '5m',
    allowedPath: (pathName) => pathName.endsWith('.js') || pathName.endsWith('.js.map'),
    setHeaders: (reply) => {
      void reply.header('Access-Control-Allow-Origin', '*');
    },
  });
  if (config.demo) registerDemo(app, pool, config);

  if (config.webDir) {
    await app.register(fastifyStatic, { root: config.webDir, wildcard: false });
    // The web app routes in the browser, so any other page gets index.html.
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Not found' })
        : reply.sendFile('index.html'),
    );
  } else {
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  }

  return app;
}

/** The dist folder of the installed @openstuff-dev/announce. */
function sdkDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@openstuff-dev/announce'))), '..');
}
