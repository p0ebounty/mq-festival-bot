import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface StoredFile {
  /** Путь относительно корня хранилища — его и пишем в БД. */
  relPath: string;
  absPath: string;
  bytes: number;
  sha256: string;
  mimeType: string;
}

export interface StorageAdapter {
  save(buf: Buffer, opts: { ext: string; mimeType: string; subdir?: string }): Promise<StoredFile>;
  read(relPath: string): Promise<Buffer>;
  delete(relPath: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
}

/**
 * Локальный диск. Интерфейс вынесен, чтобы при переезде на S3 не переписывать
 * вызывающий код — на текущем масштабе фестиваля S3 не нужен.
 *
 * Раскладка: <root>/<YYYY>/<MM>/<sha16>.<ext> — по датам, чтобы чистка
 * по сроку хранения была простым обходом каталогов.
 */
export class LocalStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  async save(buf: Buffer, opts: { ext: string; mimeType: string; subdir?: string }): Promise<StoredFile> {
    const sha = createHash('sha256').update(buf).digest('hex');
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const ext = opts.ext.replace(/^\./, '');

    const relDir = opts.subdir ? path.join(opts.subdir, yyyy, mm) : path.join(yyyy, mm);
    const relPath = path.join(relDir, `${sha.slice(0, 16)}.${ext}`);
    const absPath = this.resolve(relPath);

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buf);

    return { relPath, absPath, bytes: buf.length, sha256: sha, mimeType: opts.mimeType };
  }

  // async, а не «return promise»: resolve() бросает синхронно, и без async
  // метод кидал бы исключение мимо промиса — вызывающий код с .catch()
  // такое не поймает.
  async read(relPath: string): Promise<Buffer> {
    return fs.readFile(this.resolve(relPath));
  }

  async delete(relPath: string): Promise<void> {
    await fs.rm(this.resolve(relPath), { force: true });
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relPath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Защита от выхода за корень: relPath приходит из БД, но лучше не давать
   * ни единого шанса '../' добраться до чужих файлов.
   */
  private resolve(relPath: string): string {
    const abs = path.resolve(this.root, relPath);
    const rootAbs = path.resolve(this.root);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
      throw new Error(`путь выходит за пределы хранилища: ${relPath}`);
    }
    return abs;
  }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Забирает результат от kie.ai к себе. Обязательный шаг: их медиа живёт
 * 14 дней, а QR-коды с фестиваля должны работать и потом.
 */
export async function ingestRemote(
  url: string,
  storage: StorageAdapter,
  opts: { subdir?: string; maxBytes?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<StoredFile> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? 30 * 1024 * 1024;

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
  if (!res.ok) throw new Error(`не удалось скачать результат: HTTP ${res.status}`);

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared && declared > maxBytes) {
    throw new Error(`файл слишком большой: ${declared} байт`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`файл слишком большой: ${buf.length} байт`);
  if (buf.length === 0) throw new Error('скачан пустой файл');

  const mimeType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim();
  const ext = EXT_BY_MIME[mimeType] ?? guessExtFromUrl(url);

  return storage.save(buf, { ext, mimeType, ...(opts.subdir ? { subdir: opts.subdir } : {}) });
}

function guessExtFromUrl(url: string): string {
  const m = /\.(jpe?g|png|webp)(?:\?|$)/i.exec(url);
  return m ? m[1]!.toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}
