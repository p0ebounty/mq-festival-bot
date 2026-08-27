import { InputFile } from 'grammy';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bot } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';

// В ESM нет __dirname — путь считаем от URL модуля.
const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets');

/**
 * Карточка «Рисую…» — уходит сразу при постановке задачи.
 * Файл читаем один раз и держим в памяти: за смену фестиваля он уйдёт
 * сотни раз, перечитывать диск каждый раз незачем.
 */
let loadingCard: Buffer | null = null;

export function makePlaceholderSender(bot: Bot, log: FastifyBaseLogger) {
  return async function sendPlaceholderCard(chatId: bigint, caption: string): Promise<bigint | null> {
    try {
      loadingCard ??= await readFile(path.join(ASSETS, 'loading.png'));
      const msg = await bot.api.sendPhoto(Number(chatId), new InputFile(loadingCard, 'loading.png'), {
        caption,
      });
      return BigInt(msg.message_id);
    } catch (err) {
      // Не смогли — не беда: картинка просто придёт отдельным сообщением.
      log.warn({ err: String(err) }, 'карточка «Рисую…» не отправилась');
      return null;
    }
  };
}

/** Отправка сохранённой у нас картинки участнику (базовый мир и т.п.). */
export function makeMediaSender(app: AppContext, bot: Bot, log: FastifyBaseLogger) {
  return async function sendMedia(chatId: bigint, mediaId: string, caption: string): Promise<boolean> {
    const row = await app.media.byId(mediaId);
    if (!row) {
      log.warn({ mediaId }, 'нет записи медиа для отправки');
      return false;
    }
    try {
      const buf = await app.storage.read(row.path);
      await bot.api.sendPhoto(Number(chatId), new InputFile(buf, 'mqbot.jpg'), { caption });
      return true;
    } catch (err) {
      log.error({ mediaId, err: String(err) }, 'не удалось отправить картинку');
      return false;
    }
  };
}

/**
 * Заливает нашу картинку в хранилище kie.ai и отдаёт URL.
 * Нужно, когда модель должна прочитать файл, который лежит у нас.
 */
export function makeMediaUploader(app: AppContext, log: FastifyBaseLogger) {
  return async function uploadStoredMedia(mediaId: string): Promise<string | null> {
    const row = await app.media.byId(mediaId);
    if (!row) return null;
    try {
      const buf = await app.storage.read(row.path);
      const up = await app.kie.uploadBase64({
        base64: `data:${row.mimeType};base64,${buf.toString('base64')}`,
        fileName: `world-${mediaId.slice(0, 12)}.jpg`,
      });
      return up.downloadUrl;
    } catch (err) {
      log.error({ mediaId, err: String(err) }, 'не удалось залить картинку в kie.ai');
      return null;
    }
  };
}
