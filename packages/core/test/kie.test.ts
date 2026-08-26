import { describe, it, expect, vi } from 'vitest';
import {
  KieClient, KieError, kieErrorFor, KIE_CODES, RateLimiter, parseTaskRecord,
} from '../src/kie/index';

const noSleep = async () => {};
const ok = (data: unknown) =>
  new Response(JSON.stringify({ code: 200, msg: 'success', data }), { status: 200 });
const kieFail = (code: number, msg = 'boom') =>
  new Response(JSON.stringify({ code, msg }), { status: 200 }); // именно 200 — так делает kie.ai

function client(fetchImpl: typeof fetch, extra = {}) {
  return new KieClient({ getApiKey: () => 'k', fetchImpl, sleep: noSleep, ...extra });
}

describe('разбор кодов', () => {
  it('401/402/422 не повторяются', () => {
    for (const c of [KIE_CODES.UNAUTHORIZED, KIE_CODES.NO_CREDITS, KIE_CODES.VALIDATION]) {
      expect(kieErrorFor(c).retryable, String(c)).toBe(false);
    }
  });
  it('429/455/501 повторяются', () => {
    for (const c of [KIE_CODES.RATE_LIMITED, KIE_CODES.MAINTENANCE, KIE_CODES.GENERATION_FAILED]) {
      expect(kieErrorFor(c).retryable, String(c)).toBe(true);
    }
  });
  it('у каждой ошибки есть текст для участника, без технических деталей', () => {
    for (const c of [401, 402, 422, 429, 455, 500, 501, 505]) {
      const e = kieErrorFor(c, 'internal stacktrace bla');
      expect(e.userMessage.length).toBeGreaterThan(10);
      expect(e.userMessage).not.toContain('stacktrace');
      expect(e.userMessage).not.toMatch(/\b(401|402|422|429|500|501)\b/);
    }
  });
});

describe('транспорт', () => {
  it('HTTP 200 с кодом ошибки внутри тела — это ошибка', async () => {
    const c = client(vi.fn().mockResolvedValue(kieFail(402, 'no credits')) as never);
    await expect(c.getCredits()).rejects.toThrow(KieError);
  });

  it('шлёт Bearer-заголовок', async () => {
    const f = vi.fn().mockResolvedValue(ok(100));
    await client(f as never).getCredits();
    expect(f.mock.calls[0]![1].headers.Authorization).toBe('Bearer k');
  });

  it('пустой ключ — сразу понятная ошибка, без похода в сеть', async () => {
    const f = vi.fn();
    const c = new KieClient({ getApiKey: () => '', fetchImpl: f as never, sleep: noSleep });
    await expect(c.getCredits()).rejects.toThrow(/ключ kie.ai не задан/);
    expect(f).not.toHaveBeenCalled();
  });

  it('ключ читается на КАЖДЫЙ запрос — смена в админке подхватывается', async () => {
    const keys = ['old', 'new'];
    // mockImplementation, а не mockResolvedValue: тело Response читается
    // ровно один раз, поэтому на каждый вызов нужен свежий объект.
    const f = vi.fn().mockImplementation(() => Promise.resolve(ok(1)));
    const c = new KieClient({ getApiKey: () => keys.shift()!, fetchImpl: f as never, sleep: noSleep });
    await c.getCredits(); await c.getCredits();
    expect(f.mock.calls[0]![1].headers.Authorization).toBe('Bearer old');
    expect(f.mock.calls[1]![1].headers.Authorization).toBe('Bearer new');
  });

  it('повторяет 429 и в итоге проходит', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(kieFail(429))
      .mockResolvedValueOnce(kieFail(429))
      .mockResolvedValueOnce(ok({ taskId: 't1' }));
    expect(await client(f as never).createTask({ model: 'm' })).toBe('t1');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('НЕ повторяет 401', async () => {
    const f = vi.fn().mockResolvedValue(kieFail(401));
    await expect(client(f as never).getCredits()).rejects.toThrow(KieError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('не-JSON ответ не роняет клиент', async () => {
    const f = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }));
    await expect(client(f as never, { maxRetries: 0 }).getCredits()).rejects.toThrow(KieError);
  });

  it('createTask без taskId — ошибка, а не undefined', async () => {
    const f = vi.fn().mockResolvedValue(ok({}));
    await expect(client(f as never, { maxRetries: 0 }).createTask({})).rejects.toThrow(/taskId/);
  });

  it('credits принимает и число, и объект', async () => {
    expect(await client(vi.fn().mockImplementation(() => Promise.resolve(ok(42))) as never).getCredits()).toBe(42);
    expect(await client(vi.fn().mockImplementation(() => Promise.resolve(ok({ credit: 7 }))) as never).getCredits()).toBe(7);
  });
});

describe('разбор записи задачи', () => {
  it('достаёт URL из resultJson (это строка с JSON)', () => {
    const r = parseTaskRecord({
      taskId: 't', model: 'm', state: 'success',
      resultJson: '{"resultUrls":["https://a/1.jpg","https://a/2.jpg"]}',
      creditsConsumed: 8, costTime: 15000,
    });
    expect(r.resultUrls).toHaveLength(2);
    expect(r.creditsConsumed).toBe(8);
    expect(r.costTimeMs).toBe(15000);
  });

  it('битый resultJson не роняет разбор', () => {
    const r = parseTaskRecord({ taskId: 't', state: 'success', resultJson: '{не json' });
    expect(r.resultUrls).toEqual([]);
  });

  it('пустой resultJson у незавершённой задачи — норма', () => {
    expect(parseTaskRecord({ taskId: 't', state: 'generating' }).resultUrls).toEqual([]);
  });

  it('переносит причину падения', () => {
    const r = parseTaskRecord({ taskId: 't', state: 'fail', failCode: '501', failMsg: 'nsfw' });
    expect(r.failMessage).toBe('nsfw');
  });
});

describe('ожидание задачи', () => {
  it('возвращает результат, когда состояние стало success', async () => {
    const states = ['waiting', 'generating', 'success'];
    const f = vi.fn().mockImplementation(() => {
      const s = states.shift()!;
      return Promise.resolve(ok({
        taskId: 't', state: s,
        ...(s === 'success' ? { resultJson: '{"resultUrls":["u"]}' } : {}),
      }));
    });
    const rec = await client(f as never).waitForTask('t', { intervalMs: 0 });
    expect(rec.resultUrls).toEqual(['u']);
  });

  it('fail превращается в KieError', async () => {
    const f = vi.fn().mockImplementation(() =>
      Promise.resolve(ok({ taskId: 't', state: 'fail', failMsg: 'bad prompt' })));
    await expect(client(f as never).waitForTask('t', { intervalMs: 0 })).rejects.toThrow(KieError);
  });
});

describe('ограничитель 20 задач / 10 сек', () => {
  it('первые 20 проходят мгновенно, 21-я ждёт', () => {
    let now = 0;
    const rl = new RateLimiter(20, 10_000, () => now);
    for (let i = 0; i < 20; i++) { expect(rl.delayMs()).toBe(0); rl.consume(); }
    expect(rl.delayMs()).toBeGreaterThan(0);
  });

  it('окно освобождается со временем', () => {
    let now = 0;
    const rl = new RateLimiter(20, 10_000, () => now);
    for (let i = 0; i < 20; i++) rl.consume();
    now = 10_001;
    expect(rl.delayMs()).toBe(0);
    expect(rl.used()).toBe(0);
  });

  it('считает занятые слоты', () => {
    let now = 0;
    const rl = new RateLimiter(20, 10_000, () => now);
    rl.consume(); rl.consume();
    expect(rl.used()).toBe(2);
  });
});
