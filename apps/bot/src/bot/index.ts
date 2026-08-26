import { Bot } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { env } from '../env.js';
import { handleIncoming } from '../agent/runner.js';

/**
 * Бот — ОДИН диалог, а не меню (ADR 0003).
 * Здесь нет обработчиков команд-веток и нет клавиатур: любое сообщение
 * уходит агенту, он сам решает, что делать.
 */
export function createBot(app: AppContext, log: FastifyBaseLogger): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // /start — не команда с меню, а обычная реплика, которую агент отыграет сам.
  bot.command('start', async (c) => {
    await onMessage(c.chat.id, c.from, c.msg.message_id,
      'Привет! Я только что открыл этого бота — расскажи коротко, что тут можно делать.', [], c);
  });

  bot.on('message:text', async (c) => {
    await onMessage(c.chat.id, c.from, c.msg.message_id, c.msg.text, [], c);
  });

  bot.on('message:photo', async (c) => {
    const caption = c.msg.caption ?? 'Вот моё фото.';
    let urls: string[] = [];
    try {
      urls = [await ingestTelegramPhoto(app, c, log)];
    } catch (err) {
      log.warn({ err: String(err) }, 'не удалось забрать фото участника');
      await c.reply('Фото не получилось загрузить. Пришли ещё раз, пожалуйста.');
      return;
    }
    await onMessage(c.chat.id, c.from, c.msg.message_id, caption, urls, c);
  });

  bot.catch((err) => {
    log.error({ err: String(err.error), update: err.ctx.update.update_id }, 'ошибка в обработчике бота');
  });

  async function onMessage(
    chatId: number,
    from: { id: number; username?: string; first_name?: string; last_name?: string; language_code?: string } | undefined,
    messageId: number,
    text: string,
    imageUrls: string[],
    c: { reply: (t: string) => Promise<unknown>; replyWithChatAction?: (a: 'typing') => Promise<unknown> },
  ) {
    if (!from) return;
    // «Печатает…» — чтобы участник видел, что бот жив, пока идёт вызов модели.
    void c.replyWithChatAction?.('typing').catch(() => {});

    const reply = await handleIncoming(app, {
      tgId: BigInt(from.id),
      chatId: BigInt(chatId),
      tgMessageId: BigInt(messageId),
      text,
      ...(imageUrls.length ? { imageUrls } : {}),
      from: {
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
        languageCode: from.language_code,
      },
    }, log);

    if (reply.text.trim()) await c.reply(reply.text);
  }

  return bot;
}

/**
 * Забирает фото из Telegram и кладёт в хранилище kie.ai, чтобы модель могла
 * его прочитать по URL. Берём самый крупный размер — лицо важнее трафика.
 */
async function ingestTelegramPhoto(
  app: AppContext,
  c: { msg: { photo?: Array<{ file_id: string }> }; api: { getFile: (id: string) => Promise<{ file_path?: string }> } },
  log: FastifyBaseLogger,
): Promise<string> {
  const photos = c.msg.photo ?? [];
  const biggest = photos[photos.length - 1];
  if (!biggest) throw new Error('в сообщении нет фото');

  const file = await c.api.getFile(biggest.file_id);
  if (!file.file_path) throw new Error('Telegram не вернул путь к файлу');

  const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Telegram отдал файл с HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const uploaded = await app.kie.uploadBase64({
    base64: `data:image/jpeg;base64,${buf.toString('base64')}`,
    fileName: `tg-${biggest.file_id.slice(0, 16)}.jpg`,
  });
  log.info({ bytes: buf.length }, 'фото участника загружено');
  return uploaded.downloadUrl;
}
