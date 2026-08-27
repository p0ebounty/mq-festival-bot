import Fastify from 'fastify';
import { env } from './env.js';
import { createContext } from './context.js';
import { registerKieCallback } from './routes/kie-callback.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerTelegramWebhook, installWebhook } from './routes/telegram.js';
import { startReconcileWorker } from './workers/reconcile.js';
import { createBot } from './bot/index.js';
import { makeDeliverer } from './bot/deliver.js';
import { makeGetBalanceTool } from './agent/tools/get-balance.js';
import { makeGenerateImageTool } from './agent/tools/generate-image.js';
import { makeEditImageTool } from './agent/tools/edit-image.js';
import { makeSuggestTool } from './agent/tools/suggest.js';
import { makeGetBaseWorldTool } from './agent/tools/base-world.js';
import { makeMediaSender, makeMediaUploader, makePlaceholderSender } from './bot/media-out.js';

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

// Набор инструментов агента: пять универсальных, без флагов-переключателей
// и без «одна профессия — один инструмент» (ADR 0010).
ctx.registry
  .register(makeGetBalanceTool(ctx))
  .register(makeGenerateImageTool(ctx))
  .register(makeEditImageTool(ctx))
  .register(makeGetBaseWorldTool(ctx))
  .register(makeSuggestTool());

const { bot } = createBot(ctx, app.log);
ctx.deliverGeneration = makeDeliverer(ctx, bot, app.log);
ctx.sendMedia = makeMediaSender(ctx, bot, app.log);
ctx.uploadStoredMedia = makeMediaUploader(ctx, app.log);
ctx.sendPlaceholderCard = makePlaceholderSender(bot, app.log);
registerTelegramWebhook(app, bot);

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
  await bot.init();
  await installWebhook(bot, app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
