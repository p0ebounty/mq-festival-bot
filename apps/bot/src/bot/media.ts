import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { env } from '../env.js';

/** Скачивает файл Telegram по file_id. */
async function fetchTelegramFile(
  api: { getFile: (id: string) => Promise<{ file_path?: string }> },
  fileId: string,
): Promise<Buffer> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error('Telegram не вернул путь к файлу');
  const res = await fetch(
    `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) throw new Error(`Telegram отдал файл с HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Фото участника: кладём в хранилище kie.ai, модель читает по URL.
 * Берём самый крупный размер — лицо важнее трафика.
 */
export async function ingestPhoto(
  app: AppContext,
  api: { getFile: (id: string) => Promise<{ file_path?: string }> },
  photos: readonly { file_id: string }[],
  log: FastifyBaseLogger,
): Promise<string> {
  const biggest = photos[photos.length - 1];
  if (!biggest) throw new Error('в сообщении нет фото');
  const buf = await fetchTelegramFile(api, biggest.file_id);
  const uploaded = await app.kie.uploadBase64({
    base64: `data:image/jpeg;base64,${buf.toString('base64')}`,
    fileName: `tg-${biggest.file_id.slice(0, 16)}.jpg`,
  });
  log.info({ bytes: buf.length }, 'фото участника загружено');
  return uploaded.downloadUrl;
}
