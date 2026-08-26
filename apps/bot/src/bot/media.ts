import { spawn } from 'node:child_process';
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

/**
 * Голосовое: Telegram отдаёт opus в контейнере ogg, а модель его не берёт.
 * Перегоняем в mp3 через ffmpeg и отдаём data-URL — единственная форма,
 * которую поняли обе модели Gemini (проверено, в документации не описано).
 */
export async function ingestVoice(
  api: { getFile: (id: string) => Promise<{ file_path?: string }> },
  fileId: string,
  log: FastifyBaseLogger,
): Promise<string> {
  const ogg = await fetchTelegramFile(api, fileId);
  const mp3 = await transcode(ogg);
  log.info({ oggBytes: ogg.length, mp3Bytes: mp3.length }, 'голосовое перекодировано');
  return `data:audio/mpeg;base64,${mp3.toString('base64')}`;
}

/** ogg/opus → mp3 16 кГц моно. Поток в поток, без временных файлов. */
function transcode(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-ar', '16000', '-ac', '1', '-b:a', '48k',
      '-f', 'mp3', 'pipe:1',
    ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    ff.stdout.on('data', (c: Buffer) => out.push(c));
    ff.stderr.on('data', (c: Buffer) => err.push(c));
    ff.on('error', (e) => reject(new Error(`ffmpeg не запустился: ${e.message}`)));
    ff.on('close', (code) => {
      if (code === 0 && out.length) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg вышел с кодом ${code}: ${Buffer.concat(err).toString().slice(0, 200)}`));
    });
    // Таймаут: битый файл не должен подвесить обработчик навсегда.
    const t = setTimeout(() => ff.kill('SIGKILL'), 30_000);
    ff.on('close', () => clearTimeout(t));
    ff.stdin.on('error', () => {});
    ff.stdin.end(input);
  });
}
