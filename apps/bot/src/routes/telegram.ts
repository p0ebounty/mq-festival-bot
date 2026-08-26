import type { FastifyInstance } from 'fastify';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import { env } from '../env.js';

/**
 * Вебхук Telegram.
 *
 * Две независимые защиты: секрет в пути и секретный заголовок. Первая
 * прячет эндпоинт от сканеров, вторая подтверждает, что запрос от Telegram.
 */
export function registerTelegramWebhook(app: FastifyInstance, bot: Bot): void {
  const path = `/tg/${env.TELEGRAM_WEBHOOK_SECRET}`;
  const handle = webhookCallback(bot, 'fastify');

  app.post(path, async (req, reply) => {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== env.TELEGRAM_WEBHOOK_SECRET) {
      req.log.warn({ ip: req.ip }, 'вебхук: неверный секретный заголовок');
      return reply.code(401).send({ ok: false });
    }
    return handle(req, reply);
  });

  app.log.info({ path: `/tg/${env.TELEGRAM_WEBHOOK_SECRET.slice(0, 6)}…` }, 'вебхук Telegram зарегистрирован');
}

/** Ставит вебхук в Telegram. Вызывается на старте — идемпотентно. */
export async function installWebhook(bot: Bot, log: FastifyInstance['log']): Promise<void> {
  const url = `${env.PUBLIC_URL}/tg/${env.TELEGRAM_WEBHOOK_SECRET}`;
  try {
    await bot.api.setWebhook(url, {
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    const me = await bot.api.getMe();
    log.info({ bot: me.username, host: new URL(url).host }, 'вебхук установлен');
  } catch (err) {
    log.error({ err: String(err) }, 'не удалось установить вебхук');
  }
}
