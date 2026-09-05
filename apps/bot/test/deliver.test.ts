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

interface HarnessOpts {
  status?: string;
  editFails?: boolean;
  /** Чем kie.ai объяснил провал — от этого зависит текст участнику. */
  failMessage?: string | null;
  /** null — генерация без диалога (например, из админки). */
  conversationId?: string | null;
}

function harness(opts: HarnessOpts = {}) {
  const sent: Sent[] = [];
  /** Что записали в историю диалога. */
  const history: Array<{ conversationId: string; role: string; text?: string | null }> = [];
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
        failMessage: opts.failMessage ?? null,
        conversationId: opts.conversationId === undefined ? 'c1' : opts.conversationId,
      }),
    },
    conversations: {
      addMessage: async (input: { conversationId: string; role: string; text?: string | null }) => {
        history.push(input);
        return { id: 'm-fail' };
      },
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
  return { app, bot, log, sent, history };
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

  it('подпись приходит отдельным сообщением ответом на карточку, а не в самой картинке', async () => {
    // 05.09: подмена картинки на месте не двигает чат и не даёт уведомления —
    // участники не замечали, что готово. Новое сообщение с цитатой карточки
    // замечают, а подпись агента в нём — про их идею, а не казённое «Готово».
    const h = harness();
    await (await load())(h.app, h.bot as never, h.log as never)('g1');

    const edit = h.sent.find((s) => s.method === 'editMessageMedia')!;
    // Третий аргумент — InputMedia; InputFile внутри в JSON не превращается,
    // поэтому смотрим на поле, а не на строку.
    expect((edit.args[2] as { caption?: string }).caption).toBeUndefined();

    const note = h.sent.find((s) => s.method === 'sendMessage')!;
    expect(note).toBeDefined();
    expect(note.args[1]).toBe('Твой кот в шляпе');
    expect(note.args[2]).toEqual({ reply_parameters: { message_id: 7 } });
    // И в историю диалога — модель видит, что картинка готова.
    expect(h.history.some((m) => m.role === 'assistant' && m.text === 'Твой кот в шляпе')).toBe(true);
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

/**
 * Живой случай 04.09: «добавь человека паука» → kie.ai через 108 с вернул
 * fail, участнику ушло «не получилось». В истории диалога при этом
 * последней репликой бота осталось «Добавил» — и на следующее «ещё раз»
 * модель отвечала из мира, где картинка уже есть, а правило «не вызывай
 * инструмент снова» блокировало переделку. Сообщение о сбое обязано
 * попадать в ту же историю, что читает модель.
 */
describe('сообщение о сбое и история диалога', () => {
  const textOf = (call: Sent) => call.args[1] as string;

  it('текст сбоя уходит участнику и тем же текстом ложится в историю', async () => {
    const h = harness({ status: 'failed' });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');

    const msg = h.sent.find((s) => s.method === 'sendMessage');
    expect(msg).toBeDefined();
    expect(h.history).toHaveLength(1);
    expect(h.history[0]).toMatchObject({ conversationId: 'c1', role: 'assistant', text: textOf(msg!) });
  });

  it('без диалога в историю ничего не пишется', async () => {
    // Генерация может прийти не из чата — записывать её сбой некуда.
    const h = harness({ status: 'failed', conversationId: null });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');
    expect(h.sent.some((s) => s.method === 'sendMessage')).toBe(true);
    expect(h.history).toHaveLength(0);
  });

  it('возвращённый токен тоже попадает в историю', async () => {
    // Статус refunded — та же ветка неудачи, что и failed.
    const h = harness({ status: 'refunded' });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');
    expect(h.history).toHaveLength(1);
    expect(h.history[0]?.role).toBe('assistant');
  });

  it('отказ генератора по контенту объясняется без запугивания', async () => {
    // Прежний текст «так бывает с известными персонажами» пугал участника
    // от Человека-паука, которого рисовать можно. Новый ведёт к выходу:
    // описать человека словами, без имени.
    const h = harness({ status: 'failed', failMessage: 'content policy violation' });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');

    const text = textOf(h.sent.find((s) => s.method === 'sendMessage')!);
    expect(text).toContain('осторожнее меня');
    expect(text).toContain('Токены вернул');
    expect(text).not.toContain('известными персонажами');
    // Совет «опиши без имени» учил бы обходить фильтр — его здесь нет.
    expect(text).not.toContain('без имени');
  });

  it('технический сбой не притворяется отказом по контенту', async () => {
    const h = harness({ status: 'failed', failMessage: 'generate task timeout' });
    await (await load())(h.app, h.bot as never, h.log as never)('g1');

    const text = textOf(h.sent.find((s) => s.method === 'sendMessage')!);
    expect(text).not.toContain('осторожнее меня');
    expect(text).toContain('Токены вернул');
  });
});
