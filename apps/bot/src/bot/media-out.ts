import { InputFile } from 'grammy';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bot } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { shareButton } from './share-button.js';

// В ESM нет __dirname — путь считаем от URL модуля.
const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets');

/**
 * Карточка «Рисую…» — уходит сразу при постановке задачи.
 * Файл читаем один раз и держим в памяти: за смену фестиваля он уйдёт
 * сотни раз, перечитывать диск каждый раз незачем.
 */
let loadingCard: Buffer | null = null;

export function makePlaceholderSender(bot: Bot, log: FastifyBaseLogger) {
  return async function sendPlaceholderCard(
    chatId: bigint, caption: string, generationId: string,
  ): Promise<bigint | null> {
    try {
      loadingCard ??= await readFile(path.join(ASSETS, 'loading.png'));
      const msg = await bot.api.sendPhoto(Number(chatId), new InputFile(loadingCard, 'loading.png'), {
        caption,
        // Кнопка появляется сразу, но недоступной: участник видит, что
        // действие будет, и не ищет её потом глазами.
        reply_markup: shareButton(generationId, false),
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
 * Ссылки kie.ai живут 14 дней. Считаем копию годной 13 — сутки запаса,
 * чтобы срок не истёк ровно посреди диалога.
 */
const REMOTE_TTL_MS = 13 * 24 * 60 * 60 * 1000;

/**
 * Заливает нашу картинку в хранилище kie.ai и отдаёт URL.
 * Нужно, когда модель должна прочитать файл, который лежит у нас.
 *
 * Результат кэшируется в `media.remote_url`: реестр картинок прикладывает к
 * запросу до шести штук, и без кэша каждое сообщение участника означало бы
 * шесть заливок мегабайтных файлов (ADR 0010).
 */
export function makeMediaUploader(app: AppContext, log: FastifyBaseLogger) {
  return async function uploadStoredMedia(mediaId: string): Promise<string | null> {
    const row = await app.media.byId(mediaId);
    if (!row) return null;

    if (row.remoteUrl && row.remoteUrlExpiresAt && row.remoteUrlExpiresAt > new Date()) {
      return row.remoteUrl;
    }

    try {
      const buf = await app.storage.read(row.path);
      const up = await app.kie.uploadBase64({
        base64: `data:${row.mimeType};base64,${buf.toString('base64')}`,
        fileName: `mq-${mediaId.slice(0, 12)}.jpg`,
      });
      await app.media.rememberRemoteUrl(mediaId, up.downloadUrl, new Date(Date.now() + REMOTE_TTL_MS));
      return up.downloadUrl;
    } catch (err) {
      log.error({ mediaId, err: String(err) }, 'не удалось залить картинку в kie.ai');
      return null;
    }
  };
}
