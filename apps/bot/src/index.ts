import Fastify from 'fastify';
import { env } from './env.js';
import { createContext } from './context.js';
import { registerKieCallback } from './routes/kie-callback.js';
import { registerMediaRoutes } from './routes/media.js';
import { startReconcileWorker } from './workers/reconcile.js';

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  },
  trustProxy: true, // за Traefik
  bodyLimit: 2 * 1024 * 1024,
});

const ctx = createContext();
const startedAt = Date.now();

app.get('/healthz', async () => ({
  ok: true,
  env: env.APP_ENV,
  uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  version: '0.1.0',
}));

// Разделение доменных путей между процессами (см. rules/40-infra-deploy.md):
//   Fastify: /tg, /g, /media, /hooks, /healthz
//   Next.js: / и /api/* (админка со своими route handlers)
registerKieCallback(app, ctx);
registerMediaRoutes(app, ctx);

const reconciler = startReconcileWorker(ctx, app.log);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    app.log.info(`получен ${sig}, останавливаемся`);
    reconciler.stop();
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: env.PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
