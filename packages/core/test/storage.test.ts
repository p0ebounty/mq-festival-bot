import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalStorage, ingestRemote } from '../src/storage/index';

let root: string;
let storage: LocalStorage;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mq-store-'));
  storage = new LocalStorage(root);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('локальное хранилище', () => {
  it('сохраняет и читает обратно', async () => {
    const buf = Buffer.from('картинка');
    const f = await storage.save(buf, { ext: 'jpg', mimeType: 'image/jpeg' });
    expect(f.bytes).toBe(buf.length);
    expect(await storage.read(f.relPath)).toEqual(buf);
    expect(await storage.exists(f.relPath)).toBe(true);
  });

  it('раскладывает по годам и месяцам', async () => {
    const f = await storage.save(Buffer.from('x'), { ext: 'jpg', mimeType: 'image/jpeg' });
    expect(f.relPath).toMatch(/^\d{4}[/\\]\d{2}[/\\][0-9a-f]{16}\.jpg$/);
  });

  it('одинаковое содержимое даёт одинаковое имя (дедупликация)', async () => {
    const a = await storage.save(Buffer.from('same'), { ext: 'jpg', mimeType: 'image/jpeg' });
    const b = await storage.save(Buffer.from('same'), { ext: 'jpg', mimeType: 'image/jpeg' });
    expect(a.relPath).toBe(b.relPath);
    expect(a.sha256).toBe(b.sha256);
  });

  it('удаление работает и не падает на отсутствующем файле', async () => {
    const f = await storage.save(Buffer.from('x'), { ext: 'jpg', mimeType: 'image/jpeg' });
    await storage.delete(f.relPath);
    expect(await storage.exists(f.relPath)).toBe(false);
    await expect(storage.delete(f.relPath)).resolves.toBeUndefined();
  });

  it('не выпускает за пределы корня', async () => {
    await expect(storage.read('../../etc/passwd')).rejects.toThrow(/выходит за пределы/);
    await expect(storage.delete('../secret')).rejects.toThrow(/выходит за пределы/);
  });
});

describe('перекладывание результата от kie.ai', () => {
  const resp = (body: Buffer, type = 'image/jpeg', extra: Record<string, string> = {}) =>
    new Response(body, { status: 200, headers: { 'content-type': type, ...extra } });

  it('скачивает и кладёт к себе', async () => {
    const data = Buffer.from('jpegdata');
    const f = await ingestRemote('https://kie/x.jpg', storage, {
      fetchImpl: vi.fn().mockResolvedValue(resp(data)) as never,
    });
    expect(await storage.read(f.relPath)).toEqual(data);
    expect(f.mimeType).toBe('image/jpeg');
  });

  it('расширение берётся из content-type, а не из URL', async () => {
    const f = await ingestRemote('https://kie/noext', storage, {
      fetchImpl: vi.fn().mockResolvedValue(resp(Buffer.from('p'), 'image/png')) as never,
    });
    expect(f.relPath.endsWith('.png')).toBe(true);
  });

  it('падает на HTTP-ошибке', async () => {
    await expect(ingestRemote('https://kie/x', storage, {
      fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 404 })) as never,
    })).rejects.toThrow(/HTTP 404/);
  });

  it('отвергает пустой файл', async () => {
    await expect(ingestRemote('https://kie/x', storage, {
      fetchImpl: vi.fn().mockResolvedValue(resp(Buffer.alloc(0))) as never,
    })).rejects.toThrow(/пустой/);
  });

  it('отвергает слишком большой файл по заголовку, не скачивая', async () => {
    const f = vi.fn().mockResolvedValue(resp(Buffer.from('x'), 'image/jpeg', { 'content-length': '99999999' }));
    await expect(ingestRemote('https://kie/x', storage, { fetchImpl: f as never, maxBytes: 1000 }))
      .rejects.toThrow(/слишком большой/);
  });

  it('отвергает большой файл и когда заголовок соврал', async () => {
    const big = Buffer.alloc(5000, 1);
    await expect(ingestRemote('https://kie/x', storage, {
      fetchImpl: vi.fn().mockResolvedValue(resp(big)) as never, maxBytes: 1000,
    })).rejects.toThrow(/слишком большой/);
  });
});
