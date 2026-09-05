import Fastify from 'fastify';
import { env } from './env.js';
import { createContext } from './context.js';
import { registerKieCallback } from './routes/kie-callback.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerShareRoutes } from './routes/share.js';
import { registerTelegramWebhook, installWebhook } from './routes/telegram.js';
import { startReconcileWorker } from './workers/reconcile.js';
import { startHousekeepingWorker } from './workers/housekeeping.js';
import { createBot } from './bot/index.js';
import { makeDeliverer } from './bot/deliver.js';
import { registerShareButton } from './bot/share-button.js';
import { makeGetBalanceTool } from './agent/tools/get-balance.js';
import { makeGenerateImageTool } from './agent/tools/generate-image.js';
import { makeEditImageTool } from './agent/tools/edit-image.js';
import { makeGetTaskTool } from './agent/tools/get-task.js';
import { makeVerifySocialTool } from './agent/tools/verify-social.js';
import { closeBrowser } from './social/page-fetch.js';
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
registerShareRoutes(app, ctx);

// Набор инструментов агента: универсальные, без флагов-переключателей и без
// «одна профессия — один инструмент» (ADR 0010). get_task стоит рядом с
// get_base_world намеренно: мир это свобода, задание это заданная цель, и
// различать их флагом внутри одного инструмента как раз нельзя (ADR 0013).
ctx.registry
  .register(makeGetBalanceTool(ctx))
  .register(makeGenerateImageTool(ctx))
  .register(makeEditImageTool(ctx))
  // get_base_world намеренно НЕ регистрируется с 05.09: заказчик убрал
  // свободные миры из игры, стартовая картинка — это задание (STATE.md).
  .register(makeGetTaskTool(ctx))
  .register(makeVerifySocialTool(ctx));
  // suggest_replies не регистрируется с 05.09: заказчик просил ровно две
  // кнопки — фиксированные под приветствием (START_CHIPS). Кнопки, которые
  // агент придумывал сам, путали участников (STATE.md, 05.09).

const { bot } = createBot(ctx, app.log);
ctx.deliverGeneration = makeDeliverer(ctx, bot, app.log);
ctx.sendMedia = makeMediaSender(ctx, bot, app.log);
ctx.uploadStoredMedia = makeMediaUploader(ctx, app.log);
ctx.sendPlaceholderCard = makePlaceholderSender(bot, app.log);
// Кнопка «Скачать и поделиться» под карточкой генерации: QR уходит
// по нажатию, а не автоматически на каждую картинку.
registerShareButton(ctx, bot, app.log);
registerTelegramWebhook(app, bot);

ctx.sendAlert = async (chatId, text) => {
  await bot.api.sendMessage(Number(chatId), text);
};

const reconciler = startReconcileWorker(ctx, app.log);

// Уборка и присмотр: удаление старых медиа и тревога по кредитам kie.ai.
const alertRaw = await ctx.settings.get('ops.alertChatId');
const housekeeper = startHousekeepingWorker(ctx, app.log, {
  lowCreditsThreshold: await ctx.settings.getInt('ops.lowCredits'),
  ...(/^-?\d+$/.test(alertRaw.trim()) ? { alertChatId: BigInt(alertRaw.trim()) } : {}),
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    app.log.info(`получен ${sig}, останавливаемся`);
    reconciler.stop();
    housekeeper.stop();
    void closeBrowser()
      .then(() => app.close())
      .then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: env.PORT, host: '127.0.0.1' });
  await bot.init();
  if (bot.botInfo.username) ctx.botUrl = `https://t.me/${bot.botInfo.username}`;
  await installWebhook(bot, app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
