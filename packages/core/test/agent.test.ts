import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  ToolRegistry, runAgent, OpenAiChatProvider, ChatProviderError,
  type ChatProvider, type ChatResult, type AgentTool, type ToolContext,
} from '../src/agent/index';

const ctx: ToolContext = {
  userId: 'u1', conversationId: 'c1', chatId: 1n, userMessage: 'исходная фраза участника',
  log: { info: () => {}, warn: () => {} },
};

const echoTool: AgentTool<{ text: string }> = {
  name: 'echo',
  description: 'Повторяет текст.',
  input: z.object({ text: z.string().min(1) }),
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  async run(i) { return { ok: true, summary: `Повторил: ${i.text}` }; },
};

function fakeProvider(script: ChatResult[]): ChatProvider & { calls: number } {
  let i = 0;
  return {
    id: 'fake', calls: 0,
    async complete() { this.calls++; return script[Math.min(i++, script.length - 1)]!; },
  };
}
const say = (text: string): ChatResult =>
  ({ text, toolCalls: [], stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 } });
const callTool = (name: string, input: Record<string, unknown>, id = 'c1'): ChatResult =>
  ({ text: '', toolCalls: [{ id, name, input }], stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 5 } });

describe('реестр инструментов', () => {
  it('валидирует вход и не пускает мусор', async () => {
    const r = new ToolRegistry().register(echoTool);
    const bad = await r.execute('echo', { text: '' }, ctx);
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('invalid_input');
    expect(bad.summary).toContain('echo');
  });

  it('неизвестный инструмент — результат, а не исключение', async () => {
    const res = await new ToolRegistry().execute('нет-такого', {}, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('unknown_tool');
  });

  it('падение инструмента не пробрасывается наружу', async () => {
    const boom: AgentTool<Record<string, never>> = {
      name: 'boom', description: 'падает', input: z.object({}),
      parameters: { type: 'object', properties: {} },
      async run() { throw new Error('внутренний сбой'); },
    };
    const res = await new ToolRegistry().register(boom).execute('boom', {}, ctx);
    expect(res.ok).toBe(false);
    expect(res.summary).not.toContain('внутренний сбой'); // техдетали не для участника
    expect(res.error).toContain('внутренний сбой');       // но в логе есть
  });

  it('повторная регистрация запрещена', () => {
    const r = new ToolRegistry().register(echoTool);
    expect(() => r.register(echoTool)).toThrow(/уже зарегистрирован/);
  });

  it('порядок схем стабилен — важно для кэша промпта', () => {
    const mk = (name: string): AgentTool<Record<string, never>> => ({
      name, description: 'x', input: z.object({}), parameters: {}, async run() { return { ok: true, summary: '' }; },
    });
    const a = new ToolRegistry().register(mk('zebra')).register(mk('alpha')).schemas().map(s => s.name);
    const b = new ToolRegistry().register(mk('alpha')).register(mk('zebra')).schemas().map(s => s.name);
    expect(a).toEqual(b);
  });
});

describe('повтор при мигающем провайдере', () => {
  /**
   * Провайдер, который падает заданное число раз, а потом отвечает.
   * Ровно то, что делал kie.ai 30–31.08: 500 полосами, между ними успех.
   */
  function flakyProvider(failures: number, retryable = true): ChatProvider & { calls: number } {
    let left = failures;
    return {
      id: 'flaky', calls: 0,
      async complete() {
        this.calls++;
        if (left-- > 0) throw new ChatProviderError('провайдер: HTTP 500', retryable);
        return say('готово');
      },
    };
  }

  it('один временный отказ переживает молча', async () => {
    const p = flakyProvider(1);
    const r = await runAgent({ provider: p, registry: new ToolRegistry(), system: 's',
      messages: [{ role: 'user', text: 'привет' }], toolContext: ctx });
    expect(r.text).toBe('готово');
    expect(p.calls).toBe(2);
  });

  it('два подряд — сдаётся, участник ждать не будет', async () => {
    const p = flakyProvider(2);
    await expect(runAgent({ provider: p, registry: new ToolRegistry(), system: 's',
      messages: [{ role: 'user', text: 'привет' }], toolContext: ctx })).rejects.toThrow();
    expect(p.calls).toBe(2);
  });

  it('невосстановимую ошибку не повторяет', async () => {
    // Нет ключа, фатальный код — повтор ничего не изменит, только задержит.
    const p = flakyProvider(1, false);
    await expect(runAgent({ provider: p, registry: new ToolRegistry(), system: 's',
      messages: [{ role: 'user', text: 'привет' }], toolContext: ctx })).rejects.toThrow();
    expect(p.calls).toBe(1);
  });

  it('повторяется вызов модели, а не инструменты', async () => {
    // ⚠️ Главное свойство: инструменты этой итерации ещё не выполнялись,
    // поэтому повтор не может задвоить картинку или списание.
    let runs = 0;
    const counting = {
      name: 'count', description: 'Считает вызовы.',
      input: z.object({}), parameters: { type: 'object', properties: {} },
      async run() { runs++; return { ok: true, summary: 'посчитал' }; },
    };
    let step = 0;
    const p: ChatProvider = {
      id: 'flaky-mid',
      async complete() {
        step++;
        if (step === 1) return callTool('count', {});
        if (step === 2) throw new ChatProviderError('провайдер: HTTP 500', true);
        return say('всё');
      },
    };
    const r = await runAgent({ provider: p, registry: new ToolRegistry().register(counting),
      system: 's', messages: [{ role: 'user', text: 'посчитай' }], toolContext: ctx });
    expect(r.text).toBe('всё');
    expect(runs).toBe(1);
  });
});

describe('цикл агента', () => {
  it('без инструментов сразу отдаёт текст', async () => {
    const p = fakeProvider([say('Привет!')]);
    const r = await runAgent({ provider: p, registry: new ToolRegistry(), system: 's',
      messages: [{ role: 'user', text: 'привет' }], toolContext: ctx });
    expect(r.text).toBe('Привет!');
    expect(r.iterations).toBe(1);
    expect(r.hitLimit).toBe(false);
  });

  it('выполняет инструмент и продолжает', async () => {
    const p = fakeProvider([callTool('echo', { text: 'ку' }), say('Сделал')]);
    const r = await runAgent({ provider: p, registry: new ToolRegistry().register(echoTool),
      system: 's', messages: [{ role: 'user', text: 'повтори ку' }], toolContext: ctx });
    expect(r.text).toBe('Сделал');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]!.result.summary).toBe('Повторил: ку');
    expect(r.iterations).toBe(2);
  });

  it('несколько инструментов за раз выполняются параллельно', async () => {
    const order: string[] = [];
    const slow: AgentTool<{ ms: number; tag: string }> = {
      name: 'slow', description: 'ждёт', input: z.object({ ms: z.number(), tag: z.string() }),
      parameters: {},
      async run(i) { await new Promise(r => setTimeout(r, i.ms)); order.push(i.tag); return { ok: true, summary: i.tag }; },
    };
    const p: ChatProvider = { id: 'f', complete: vi.fn()
      .mockResolvedValueOnce({ text: '', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
        toolCalls: [{ id: 'a', name: 'slow', input: { ms: 40, tag: 'медленный' } },
                    { id: 'b', name: 'slow', input: { ms: 1, tag: 'быстрый' } }] })
      .mockResolvedValue(say('готово')) };
    const t0 = Date.now();
    const r = await runAgent({ provider: p, registry: new ToolRegistry().register(slow), system: 's',
      messages: [{ role: 'user', text: 'x' }], toolContext: ctx });
    // Параллельно: общее время ближе к 40мс, а не к 41+; быстрый финиширует первым
    expect(Date.now() - t0).toBeLessThan(200);
    expect(order[0]).toBe('быстрый');
    expect(r.toolCalls).toHaveLength(2);
  });

  it('результаты всех инструментов возвращаются одним пакетом', async () => {
    const p: ChatProvider = { id: 'f', complete: vi.fn()
      .mockResolvedValueOnce({ text: '', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
        toolCalls: [{ id: 'a', name: 'echo', input: { text: '1' } }, { id: 'b', name: 'echo', input: { text: '2' } }] })
      .mockResolvedValue(say('ок')) };
    const r = await runAgent({ provider: p, registry: new ToolRegistry().register(echoTool), system: 's',
      messages: [{ role: 'user', text: 'x' }], toolContext: ctx });
    const toolMsgs = r.newMessages.filter(m => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs.map(m => m.toolCallId)).toEqual(['a', 'b']);
  });

  it('упирается в лимит итераций и НЕ виснет', async () => {
    // Модель бесконечно зовёт инструмент — ровно тот случай из ADR 0008
    const p = fakeProvider([callTool('echo', { text: 'снова' })]);
    const r = await runAgent({ provider: p, registry: new ToolRegistry().register(echoTool), system: 's',
      messages: [{ role: 'user', text: 'x' }], toolContext: ctx, maxIterations: 3 });
    expect(r.iterations).toBe(3);
    expect(r.hitLimit).toBe(true);
    expect(r.text.length).toBeGreaterThan(0); // участник получает осмысленный ответ
  });

  it('складывает расход токенов по всем виткам', async () => {
    const p = fakeProvider([callTool('echo', { text: 'a' }), say('всё')]);
    const r = await runAgent({ provider: p, registry: new ToolRegistry().register(echoTool), system: 's',
      messages: [{ role: 'user', text: 'x' }], toolContext: ctx });
    expect(r.usage.inputTokens).toBe(20);
    expect(r.usage.outputTokens).toBe(10);
  });

  it('ошибка инструмента не обрывает цикл — агент договаривает', async () => {
    const p = fakeProvider([callTool('нет-такого', {}), say('Не вышло, попробуем иначе')]);
    const r = await runAgent({ provider: p, registry: new ToolRegistry(), system: 's',
      messages: [{ role: 'user', text: 'x' }], toolContext: ctx });
    expect(r.text).toContain('Не вышло');
    expect(r.toolCalls[0]!.result.ok).toBe(false);
  });
});

describe('провайдер OpenAI-совместимого чата', () => {
  const mk = (fetchImpl: typeof fetch) =>
    new OpenAiChatProvider({ getApiKey: () => 'k', model: 'gemini-3-flash', fetchImpl });
  const body = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });

  it('разбирает обычный ответ', async () => {
    const r = await mk(vi.fn().mockResolvedValue(body({
      choices: [{ message: { role: 'assistant', content: 'Привет' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    })) as never).complete({ system: 's', messages: [], tools: [] });
    expect(r.text).toBe('Привет');
    expect(r.stopReason).toBe('end');
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('разбирает вызов инструмента через JSON.parse', async () => {
    const r = await mk(vi.fn().mockResolvedValue(body({
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [
        { id: 'x1', function: { name: 'generate_image', arguments: '{"prompt":"a \\u0063at"}' } }] } }],
    })) as never).complete({ system: 's', messages: [], tools: [] });
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolCalls[0]!.input).toEqual({ prompt: 'a cat' }); // c распакован
  });

  it('битые аргументы не роняют — инструмент отвергнет их сам', async () => {
    const r = await mk(vi.fn().mockResolvedValue(body({
      choices: [{ message: { tool_calls: [{ id: 'x', function: { name: 'echo', arguments: '{не json' } }] } }],
    })) as never).complete({ system: 's', messages: [], tools: [] });
    expect(r.toolCalls[0]!.input).toEqual({});
  });

  it('ЛОВУШКА kie.ai: HTTP 200 с code=422 — это ошибка', async () => {
    // mockImplementation, а не mockResolvedValue: тело Response читается
    // ровно один раз, а мы дёргаем провайдер дважды.
    const p = mk(vi.fn().mockImplementation(() =>
      Promise.resolve(body({ code: 422, msg: 'The model is not supported' }))) as never);
    await expect(p.complete({ system: 's', messages: [], tools: [] })).rejects.toThrow(ChatProviderError);
    await expect(p.complete({ system: 's', messages: [], tools: [] }))
      .rejects.toMatchObject({ retryable: false }); // 422 повторять бессмысленно
  });

  it('5xx помечается повторяемым', async () => {
    const p = mk(vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('{}', { status: 503 }))) as never);
    await expect(p.complete({ system: 's', messages: [], tools: [] }))
      .rejects.toMatchObject({ retryable: true });
  });

  it('пустой ключ — понятная ошибка без похода в сеть', async () => {
    const f = vi.fn();
    const p = new OpenAiChatProvider({ getApiKey: () => '', model: 'm', fetchImpl: f as never });
    await expect(p.complete({ system: 's', messages: [], tools: [] })).rejects.toThrow(/ключ провайдера не задан/);
    expect(f).not.toHaveBeenCalled();
  });

  it('картинки участника уходят блоками image_url', async () => {
    const f = vi.fn().mockResolvedValue(body({ choices: [{ message: { content: 'ок' } }] }));
    await mk(f as never).complete({ system: 's', tools: [],
      messages: [{ role: 'user', text: 'кто на фото?', imageUrls: ['https://x/1.jpg'] }] });
    const sent = JSON.parse((f.mock.calls[0]![1] as { body: string }).body);
    expect(sent.messages[1].content[0]).toEqual({ type: 'image_url', image_url: { url: 'https://x/1.jpg' } });
  });

  it('system идёт первым сообщением', async () => {
    const f = vi.fn().mockResolvedValue(body({ choices: [{ message: { content: 'ок' } }] }));
    await mk(f as never).complete({ system: 'ПРАВИЛА', messages: [{ role: 'user', text: 'hi' }], tools: [] });
    const sent = JSON.parse((f.mock.calls[0]![1] as { body: string }).body);
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'ПРАВИЛА' });
  });
});

describe('честность про неудачу инструмента', () => {
  it('отказ помечается явно, чтобы модель не приняла его за успех', async () => {
    const failing: AgentTool<Record<string, never>> = {
      name: 'fails', description: 'всегда отказывает', input: z.object({}), parameters: {},
      async run() { return { ok: false, summary: 'Уже готовится другая картинка.', error: 'busy' }; },
    };
    const p = fakeProvider([callTool('fails', {}), say('понял, подожду')]);
    const r = await runAgent({ provider: p, registry: new ToolRegistry().register(failing),
      system: 's', messages: [{ role: 'user', text: 'x' }], toolContext: ctx });

    const toolMsg = r.newMessages.find((m) => m.role === 'tool');
    const payload = JSON.parse(toolMsg!.text!) as Record<string, unknown>;
    expect(payload.ok).toBe(false);
    expect(payload.outcome).toBe('НЕ ВЫПОЛНЕНО');
    expect(String(payload.private_note_do_not_send)).toContain('НЕ обещай результат');
    // факт доезжает до модели дословно
    expect(String(payload.what_happened)).toContain('Уже готовится другая картинка');
  });

  it('успех остаётся простым и не мусорит служебными полями', async () => {
    const p = fakeProvider([callTool('echo', { text: 'ку' }), say('готово')]);
    const r = await runAgent({ provider: p, registry: new ToolRegistry().register(echoTool),
      system: 's', messages: [{ role: 'user', text: 'x' }], toolContext: ctx });
    const payload = JSON.parse(r.newMessages.find((m) => m.role === 'tool')!.text!) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.outcome).toBeUndefined();
    expect(payload.what_happened).toBe('Повторил: ку');
    // без note служебного поля вообще нет — нечего случайно процитировать
    expect(payload.private_note_do_not_send).toBeUndefined();
  });
});

describe('таймаут провайдера', () => {
  it('по умолчанию 180 секунд — живой случай показал 106 с при лимите 90', () => {
    const p = new OpenAiChatProvider({ getApiKey: () => 'k', model: 'm' });
    expect((p as unknown as { timeoutMs: number }).timeoutMs).toBe(180_000);
  });

  it('таймаут помечается повторяемым и объясняется по-человечески', async () => {
    const f = vi.fn().mockImplementation(() => {
      const e = new Error('timed out');
      e.name = 'TimeoutError';
      return Promise.reject(e);
    });
    const p = new OpenAiChatProvider({ getApiKey: () => 'k', model: 'm', fetchImpl: f as never });
    await expect(p.complete({ system: 's', messages: [], tools: [] })).rejects.toMatchObject({
      retryable: true,
    });
    await expect(p.complete({ system: 's', messages: [], tools: [] })).rejects.toMatchObject({
      userMessage: expect.stringContaining('Напиши ещё раз'),
    });
  });
});
