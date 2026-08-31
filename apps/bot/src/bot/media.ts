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

export interface IngestedPhoto {
  /** Ссылка, по которой картинку прочитает модель. */
  url: string;
  /** Наша копия. Без неё ссылку нельзя обновить, когда она протухнет. */
  mediaId: string;
}

/**
 * Фото участника: кладём СНАЧАЛА к себе, потом в хранилище kie.ai.
 * Берём самый крупный размер — лицо важнее трафика.
 *
 * ⚠️ Своя копия обязательна по двум причинам, и обе выяснились дорого.
 *
 * **Ссылки kie.ai умирают раньше обещанного.** 31.08 фото, залитые 27-го,
 * отдавали 404 на четвёртый день вместо четырнадцати. Реестр диалога
 * исправно подставлял мёртвый адрес, модель не могла его скачать и
 * отвечала HTTP 400 на ЛЮБОЕ сообщение — участник не мог даже поздороваться.
 * Пока копии не было, перезалить было нечего: оригинал существовал только
 * у провайдера.
 *
 * **Фото участника — персональные данные** (`rules/50-security.md`), и
 * храниться они должны в нашем приватном хранилище, а не у подрядчика.
 */
export async function ingestPhoto(
  app: AppContext,
  api: { getFile: (id: string) => Promise<{ file_path?: string }> },
  photos: readonly { file_id: string }[],
  log: FastifyBaseLogger,
): Promise<IngestedPhoto> {
  const biggest = photos[photos.length - 1];
  if (!biggest) throw new Error('в сообщении нет фото');
  const buf = await fetchTelegramFile(api, biggest.file_id);

  const stored = await app.storage.save(buf, { ext: 'jpg', mimeType: 'image/jpeg', subdir: 'incoming' });
  const media = await app.media.create({
    path: stored.relPath, mimeType: stored.mimeType, bytes: stored.bytes,
    sha256: stored.sha256, source: 'telegram',
  });

  const uploaded = await app.kie.uploadBase64({
    base64: `data:image/jpeg;base64,${buf.toString('base64')}`,
    fileName: `tg-${biggest.file_id.slice(0, 16)}.jpg`,
  });
  // Срок доверия к ссылке — тот же, что у наших генераций (см. media-out.ts).
  await app.media.rememberRemoteUrl(media.id, uploaded.downloadUrl, new Date(Date.now() + 24 * 60 * 60 * 1000));

  log.info({ bytes: buf.length, mediaId: media.id }, 'фото участника загружено');
  return { url: uploaded.downloadUrl, mediaId: media.id };
}
