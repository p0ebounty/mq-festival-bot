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

app.get('/api/health', async () => ({
  ok: true,
  env: env.APP_ENV,
  uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  version: '0.1.0',
}));

// Placeholder until the admin app exists — proves routing splits correctly.
app.get('/', async (_req, reply) => {
  return reply.type('text/html; charset=utf-8').send(
    `<!doctype html><meta charset="utf-8"><title>MQ Bot — ${env.APP_ENV}</title>` +
      `<body style="font:16px system-ui;padding:3rem;max-width:40rem;margin:auto">` +
      `<h1>MQ Bot — стенд <code>${env.APP_ENV}</code></h1>` +
      `<p>Фаза 1: каркас поднят. Админка появится в фазе 3.</p>` +
      `<p><a href="/api/health">/api/health</a></p></body>`,
  );
});

try {
  await app.listen({ port: env.PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
