import { InputFile } from 'grammy';
import type { Bot } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';

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
