import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { AppContext } from '../src/context.js';

/**
 * Пересдача генерации другой модели при асинхронном fail от kie.ai
 * (ADR 0006, дополнение 04.09).
 *
 * Живой случай 04.09: «добавь человека паука» → nano-banana-2 через 108 с
 * вернула fail 524 «generate task timeout», и участник получил
 * «не получилось нарисовать», хотя в цепочке стояли ещё две модели.
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

const load = async () => (await import('../src/routes/kie-callback.js')).applyTaskResult;
const loadKieError = async () => (await import('@mq/core')).KieError;

const SOURCE = 'https://cdn.example/world.jpg';
const PROMPT = 'Add Spider-Man swinging between the cloud towers, keep the scene';

/** Fail от kie.ai, каким его отдаёт parseTaskRecord. */
const failRecord = {
  taskId: 't-old',
  model: 'nano-banana-2',
  state: 'fail' as const,
  resultUrls: [] as string[],
  failCode: '524',
  failMessage: 'generate task timeout',
};

interface HarnessOpts {
  params?: Record<string, unknown>;
  claim?: boolean;
  /** Что делает createTask: список taskId по вызовам либо отказ на всех. */
  createTask?: 'accept' | 'reject';
  model?: string;
}

function harness(opts: HarnessOpts = {}) {
  const row = {
    id: 'g1',
    userId: 'u1',
    status: 'generating',
    kind: 'world',
    kieTaskId: 't-old',
    model: opts.model ?? 'nano-banana-2',
    userPrompt: 'добавь человека паука',
    finalPrompt: PROMPT,
    sourceUrl: SOURCE,
    tokensCharged: 1,
    tgChatId: 42n,
    placeholderMessageId: 7n,
    params: opts.params ?? {
      aspectRatio: '1:1',
      task: 'transform_world',
      chain: ['nano-banana-2', 'gpt-image-2-i2i', 'grok-imagine-2-edit'],
      images: [SOURCE],
      tried: ['nano-banana-2'],
    },
    createdAt: new Date(),
  };

  let n = 0;
  const createTask = vi.fn(async () => {
    n += 1;
    if (opts.createTask === 'reject') {
      const KieError = await loadKieError();
      throw new KieError('kie.ai: превышен лимит запросов', 429, true, 'очередь');
    }
    return `t-new-${n}`;
  });

  const generations = {
    byId: vi.fn(async () => row),
    claimRetry: vi.fn(async () => opts.claim ?? true),
    markSubmitted: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => true),
    markGenerating: vi.fn(async () => undefined),
  };
  const tokens = { grant: vi.fn(async () => 10) };
  const deliverGeneration = vi.fn(async () => undefined);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const ctx = {
    generations, kie: { createTask }, tokens, deliverGeneration,
  } as unknown as AppContext;

  return { ctx, row, generations, createTask, tokens, deliverGeneration, log };
}

/** Тело createTask, как оно ушло в kie.ai. */
function payloadOf(call: unknown[]): { model: string; input: Record<string, unknown> } {
  return call[0] as { model: string; input: Record<string, unknown> };
}

describe('пересдача генерации другой модели при асинхронном fail', () => {
  it('(a) есть следующая модель — задача уходит ей с тем же промптом и картинками', async () => {
    const h = harness();
    const outcome = await (await load())(h.ctx, 'g1', failRecord, h.log);

    expect(outcome).toBe('pending');
    expect(h.createTask).toHaveBeenCalledTimes(1);
    const payload = payloadOf(h.createTask.mock.calls[0]!);
    // Вторая модель в transform_world — gpt-image-2-i2i; поле картинок у неё input_urls.
    expect(payload.model).toBe('gpt-image-2-image-to-image');
    expect(payload.input.prompt).toBe(PROMPT);
    expect(payload.input.input_urls).toEqual([SOURCE]);

    expect(h.generations.claimRetry).toHaveBeenCalledWith('g1', 't-old', expect.objectContaining({
      model: 'nano-banana-2', taskId: 't-old', failCode: '524', failMessage: 'generate task timeout',
    }));
    expect(h.generations.markSubmitted).toHaveBeenCalledWith(
      'g1', 't-new-1', 'gpt-image-2-image-to-image', ['nano-banana-2', 'gpt-image-2-i2i'],
    );

    // Токен не возвращаем и участнику ничего не шлём: заглушка «Рисую…» честна.
    expect(h.tokens.grant).not.toHaveBeenCalled();
    expect(h.deliverGeneration).not.toHaveBeenCalled();
    expect(h.generations.markFailed).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: 'g1', from: 'nano-banana-2', to: 'gpt-image-2-i2i' }),
      'генерация пересдана другой модели',
    );
  });

  it('(b) уже была одна пересдача — вторая не даётся, обычный провал', async () => {
    const h = harness({
      params: {
        aspectRatio: '1:1', task: 'transform_world', images: [SOURCE],
        tried: ['nano-banana-2', 'gpt-image-2-i2i'], retries: 1,
      },
    });
    const outcome = await (await load())(h.ctx, 'g1', failRecord, h.log);

    expect(outcome).toBe('failed');
    expect(h.createTask).not.toHaveBeenCalled();
    expect(h.generations.claimRetry).not.toHaveBeenCalled();
    expect(h.generations.markFailed).toHaveBeenCalledWith('g1', '524', 'generate task timeout');
    expect(h.tokens.grant).toHaveBeenCalledWith('u1', 1, { reason: 'refund', generationId: 'g1' });
    expect(h.deliverGeneration).toHaveBeenCalledWith('g1');
  });

  it('(c) строку уже забрал другой путь (callback vs воркер) — ничего не делаем', async () => {
    const h = harness({ claim: false });
    const outcome = await (await load())(h.ctx, 'g1', failRecord, h.log);

    expect(outcome).toBe('pending');
    expect(h.generations.claimRetry).toHaveBeenCalledTimes(1);
    expect(h.createTask).not.toHaveBeenCalled();
    expect(h.generations.markSubmitted).not.toHaveBeenCalled();
    expect(h.generations.markFailed).not.toHaveBeenCalled();
    expect(h.tokens.grant).not.toHaveBeenCalled();
    expect(h.deliverGeneration).not.toHaveBeenCalled();
  });

  it('(d) все запасные отвергли createTask — провал с ИСХОДНОЙ причиной kie.ai', async () => {
    const h = harness({ createTask: 'reject' });
    const outcome = await (await load())(h.ctx, 'g1', failRecord, h.log);

    expect(outcome).toBe('failed');
    // В transform_world после nano-banana-2 остаются две модели — обеим предложили.
    expect(h.createTask).toHaveBeenCalledTimes(2);
    expect(h.generations.markSubmitted).not.toHaveBeenCalled();
    // Причина — 524 от kie.ai, а не 429 запасных: её увидит участник и админка.
    expect(h.generations.markFailed).toHaveBeenCalledWith('g1', '524', 'generate task timeout');
    expect(h.tokens.grant).toHaveBeenCalledWith('u1', 1, { reason: 'refund', generationId: 'g1' });
    expect(h.deliverGeneration).toHaveBeenCalledWith('g1');
  });

  it('(e) старая строка без images/tried: картинка из source_url, tried — из колонки model', async () => {
    // Строки до 04.09: params = { aspectRatio, task, chain }, model = kieModel.
    const h = harness({
      params: { aspectRatio: '1:1', task: 'transform_world', chain: ['nano-banana-2', 'gpt-image-2-i2i', 'grok-imagine-2-edit'] },
      model: 'nano-banana-2',
    });
    const outcome = await (await load())(h.ctx, 'g1', failRecord, h.log);

    expect(outcome).toBe('pending');
    const payload = payloadOf(h.createTask.mock.calls[0]!);
    expect(payload.model).toBe('gpt-image-2-image-to-image');
    expect(payload.input.input_urls).toEqual([SOURCE]);
    expect(h.generations.markSubmitted).toHaveBeenCalledWith(
      'g1', 't-new-1', 'gpt-image-2-image-to-image', ['nano-banana-2', 'gpt-image-2-i2i'],
    );
  });

  it('(e2) старая строка с kieModel в колонке model, отличным от id, тоже узнаётся', async () => {
    // gpt-image-2-i2i хранится в model как 'gpt-image-2-image-to-image'.
    const h = harness({
      params: { aspectRatio: '1:1', task: 'transform_world' },
      model: 'gpt-image-2-image-to-image',
    });
    const outcome = await (await load())(h.ctx, 'g1', failRecord, h.log);

    expect(outcome).toBe('pending');
    // Кандидаты минус gpt-image-2-i2i: первой идёт nano-banana-2.
    expect(payloadOf(h.createTask.mock.calls[0]!).model).toBe('nano-banana-2');
    expect(h.generations.markSubmitted).toHaveBeenCalledWith(
      'g1', 't-new-1', 'nano-banana-2', ['gpt-image-2-i2i', 'nano-banana-2'],
    );
  });

  it('(f) цепочка исчерпана — пересдавать некому, обычный провал', async () => {
    const h = harness({
      params: {
        aspectRatio: '1:1', task: 'transform_world', images: [SOURCE],
        tried: ['nano-banana-2', 'gpt-image-2-i2i', 'grok-imagine-2-edit'],
      },
    });
    const outcome = await (await load())(h.ctx, 'g1', failRecord, h.log);

    expect(outcome).toBe('failed');
    expect(h.generations.claimRetry).not.toHaveBeenCalled();
    expect(h.createTask).not.toHaveBeenCalled();
    expect(h.generations.markFailed).toHaveBeenCalledWith('g1', '524', 'generate task timeout');
    expect(h.tokens.grant).toHaveBeenCalledWith('u1', 1, { reason: 'refund', generationId: 'g1' });
    expect(h.deliverGeneration).toHaveBeenCalledWith('g1');
  });

  it('пересдаётся и отказ по контенту, а не только таймаут', async () => {
    // У следующей модели другой провайдер и другая политика.
    const h = harness();
    const rec = { ...failRecord, failCode: '501', failMessage: 'content policy violation' };
    const outcome = await (await load())(h.ctx, 'g1', rec, h.log);

    expect(outcome).toBe('pending');
    expect(h.createTask).toHaveBeenCalledTimes(1);
    expect(h.generations.markFailed).not.toHaveBeenCalled();
  });
});
