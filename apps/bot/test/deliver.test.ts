import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { AppContext } from '../src/context.js';
import { shareButton } from '../src/bot/share-button.js';

/**
 * Доставка результата — место, где чаще всего вылезали видимые участнику
 * баги: висящая заглушка, молчание после сбоя, потерянное сообщение.
 * Фаза 7 добавила сюда кнопку «Скачать и поделиться»: она стоит уже на
 * заглушке и оживает, когда картинка готова.
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

function harness(opts: { status?: string; editFails?: boolean } = {}) {
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
    share: { byGenerationId: async () => ({ shortId: 'abcd2345' }) },
    settings: { get: async () => '#ЦентрЛидер #MagnaQore' },
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
  it('кнопка под картинкой становится РАБОЧЕЙ — без знака запрета', () => {
    // На заглушке она стояла со знаком запрета; готовность снимает его.
    expect(JSON.stringify(shareButton('g1', false))).toContain('🚫');
    expect(JSON.stringify(shareButton('g1', true))).not.toContain('🚫');
  });

  it('кнопка вызывает бота, а не открывает ссылку', () => {
    // Раньше это была url-кнопка. Теперь нажатие присылает QR-карточку,
    // поэтому нужен callback_data, а не адрес.
    const json = JSON.stringify(shareButton('g1', true));
    expect(json).toContain('callback_data');
    expect(json).toContain('share:g1');
    expect(json).not.toContain('"url"');
  });

  it('под готовой картинкой стоит кнопка', async () => {
    const h = harness();
    await (await load())(h.app, h.bot as never, h.log as never)('g1');

    const edit = h.sent.find((s) => s.method === 'editMessageMedia');
    expect(edit).toBeDefined();
    const json = JSON.stringify(markupOf(edit!));
    expect(json).toContain('share:g1');
    expect(json).not.toContain('🚫');
  });

  it('QR-карточка САМА не отправляется — только по нажатию', async () => {
    // Второе сообщение на каждую генерацию засоряло чат: живая жалоба 27.08.
    const h = harness();
    await (await load())(h.app, h.bot as never, h.log as never)('g1');
    expect(h.sent.some((s) => s.method === 'sendPhoto')).toBe(false);
  });

  it('если подмена в карточке не удалась — новое сообщение с той же кнопкой', async () => {
    // Живой случай 27.08: правка упиралась в «message can't be edited»,
    // и участник не получал НИЧЕГО.
    const h = harness({ editFails: true });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');

    expect(h.sent.some((s) => s.method === 'deleteMessage')).toBe(true);
    const photos = h.sent.filter((s) => s.method === 'sendPhoto');
    expect(photos.length).toBe(1);
    expect(JSON.stringify(markupOf(photos[0]!))).toContain('share:g1');
  });

  it('при неудаче генерации заглушка убирается, картинка не шлётся', async () => {
    const h = harness({ status: 'failed' });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');
    expect(h.sent.some((s) => s.method === 'deleteMessage')).toBe(true);
    expect(h.sent.some((s) => s.method === 'sendMessage')).toBe(true);
    expect(h.sent.some((s) => s.method === 'sendPhoto')).toBe(false);
  });
});
