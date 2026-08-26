import Fastify from 'fastify';
import { env } from './env.js';

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  },
  trustProxy: true, // behind Traefik
});

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

try {
  await app.listen({ port: env.PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
