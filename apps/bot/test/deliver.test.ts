import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { AppContext } from '../src/context.js';

/**
 * Доставка результата — место, где чаще всего вылезали видимые участнику
 * баги: висящая заглушка, молчание после сбоя, потерянное сообщение.
 * Фаза 7 добавила сюда кнопку на страницу результата и QR-карточку.
 *
 * Переменные окружения ставим ДО импорта: `env.ts` валидирует их на входе
 * и падает, а на чистой машине `.env.dev` может и не быть.
 */
beforeAll(() => {
  const need: Record<string, string> = {
    PUBLIC_URL: 'https://bot-dev.example.com',
    PORT: '3001',
    TELEGRAM_BOT_TOKEN: '1234567890:AAtest-token-for-unit-tests-only',
    TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/none',
    SECRETS_ENC_KEY: 'a'.repeat(64),
    MEDIA_ROOT: '/tmp/mqbot-test-media',
  };
  for (const [k, v] of Object.entries(need)) process.env[k] ??= v;
});

interface Sent { method: string; args: unknown[] }

function harness(opts: {
  shortId?: string | null;
  sendQr?: string;
  status?: string;
  editFails?: boolean;
} = {}) {
  const sent: Sent[] = [];
  const rec = (method: string) => (...args: unknown[]) => {
    sent.push({ method, args });
    if (method === 'editMessageMedia' && opts.editFails) throw new Error('message can\'t be edited');
    return Promise.resolve({ message_id: 1 });
  };

  const app = {
    generations: {
      byId: async () => ({
        id: 'g1',
        tgChatId: 42n,
        placeholderMessageId: 7n,
        status: opts.status ?? 'success',
        outputMediaId: 'm1',
        caption: 'Твой кот в шляпе',
        failMessage: null,
      }),
    },
    media: { byId: async () => ({ id: 'm1', path: 'p.jpg', bytes: 10 }) },
    storage: { read: async () => Buffer.from('picture-bytes') },
    share: {
      byGenerationId: async () =>
        opts.shortId === null ? undefined : { shortId: opts.shortId ?? 'abcd2345' },
    },
    settings: {
      get: async (k: string) =>
        k === 'share.sendQr' ? (opts.sendQr ?? 'on')
        : k === 'share.hashtags' ? '#ЦентрЛидер #MagnaQore'
        : '',
    },
  } as unknown as AppContext;

  const bot = {
    api: {
      editMessageMedia: rec('editMessageMedia'),
      sendPhoto: rec('sendPhoto'),
      sendMessage: rec('sendMessage'),
      deleteMessage: rec('deleteMessage'),
    },
  };

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { app, bot, log, sent };
}

const load = async () => (await import('../src/bot/deliver.js')).makeDeliverer;

/** Аргумент reply_markup у вызова, каким бы по счёту он ни был. */
function markupOf(call: Sent): Record<string, unknown> | undefined {
  for (const a of call.args) {
    if (a && typeof a === 'object' && 'reply_markup' in a) {
      return (a as { reply_markup: Record<string, unknown> }).reply_markup;
    }
  }
  return undefined;
}

describe('доставка результата', () => {
  it('под картинкой стоит кнопка на публичную страницу', async () => {
    const h = harness();
    await (await load())(h.app, h.bot as never, h.log as never)('g1');

    const edit = h.sent.find((s) => s.method === 'editMessageMedia');
    expect(edit).toBeDefined();
    expect(JSON.stringify(markupOf(edit!)))
      .toContain('https://bot-dev.example.com/g/abcd2345');
  });

  it('следом уходит QR-карточка со ссылкой и хештегами', async () => {
    const h = harness();
    await (await load())(h.app, h.bot as never, h.log as never)('g1');

    const qr = h.sent.find((s) => s.method === 'sendPhoto');
    expect(qr).toBeDefined();
    const caption = String((qr!.args[2] as { caption?: string }).caption);
    expect(caption).toContain('/g/abcd2345');
    expect(caption).toContain('#ЦентрЛидер');
  });

  it('настройка share.sendQr=off убирает второе сообщение', async () => {
    // Второе сообщение на каждую генерацию засоряет чат — владелец должен
    // уметь выключить его без выката.
    const h = harness({ sendQr: 'off' });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');
    expect(h.sent.some((s) => s.method === 'sendPhoto')).toBe(false);
    expect(h.sent.some((s) => s.method === 'editMessageMedia')).toBe(true);
  });

  it('без короткой ссылки картинка всё равно доходит — просто без кнопки', async () => {
    const h = harness({ shortId: null });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');
    const edit = h.sent.find((s) => s.method === 'editMessageMedia');
    expect(edit).toBeDefined();
    expect(markupOf(edit!)).toBeUndefined();
    expect(h.sent.some((s) => s.method === 'sendPhoto')).toBe(false);
  });

  it('если подмена в карточке не удалась — шлём новым сообщением с кнопкой', async () => {
    // Живой случай 27.08: правка упиралась в «message can't be edited»,
    // и участник не получал НИЧЕГО.
    const h = harness({ editFails: true });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');

    expect(h.sent.some((s) => s.method === 'deleteMessage')).toBe(true);
    const photos = h.sent.filter((s) => s.method === 'sendPhoto');
    expect(photos.length).toBe(2);                     // картинка + QR
    expect(JSON.stringify(markupOf(photos[0]!))).toContain('/g/abcd2345');
  });

  it('при неудаче генерации заглушка убирается, а QR не шлётся', async () => {
    const h = harness({ status: 'failed' });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');
    expect(h.sent.some((s) => s.method === 'deleteMessage')).toBe(true);
    expect(h.sent.some((s) => s.method === 'sendMessage')).toBe(true);
    expect(h.sent.some((s) => s.method === 'sendPhoto')).toBe(false);
  });
});
