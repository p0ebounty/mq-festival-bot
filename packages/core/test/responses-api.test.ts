import { describe, it, expect, vi } from 'vitest';
import { ResponsesApiProvider, parseSse, ChatProviderError } from '../src/agent/index';

const sse = (obj: unknown) =>
  new Response(
    `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: obj })}\n\n`,
    { status: 200 },
  );
const mk = (fetchImpl: typeof fetch) =>
  new ResponsesApiProvider({ getApiKey: () => 'k', model: 'gpt-5-6-terra', fetchImpl });

describe('разбор потока SSE', () => {
  it('достаёт финальное событие из потока', () => {
    const raw = [
      'event: response.created',
      'data: {"type":"response.created","response":{"status":"in_progress"}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"status":"completed","output":[]}}',
      '',
    ].join('\n');
    expect(parseSse(raw)?.status).toBe('completed');
  });

  it('переживает обычный JSON, если поток вдруг исчезнет', () => {
    expect(parseSse('{"output":[]}')).toEqual({ output: [] });
  });

  it('мусор не роняет разбор', () => {
    expect(parseSse('не json вовсе')).toBeNull();
  });
});

describe('провайдер Responses API', () => {
  it('читает текст ответа', async () => {
    const r = await mk(vi.fn().mockImplementation(() => Promise.resolve(sse({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Привет' }] }],
      usage: { input_tokens: 5, output_tokens: 2 },
    }))) as never).complete({ system: 's', messages: [], tools: [] });
    expect(r.text).toBe('Привет');
    expect(r.stopReason).toBe('end');
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it('читает вызов инструмента', async () => {
    const r = await mk(vi.fn().mockImplementation(() => Promise.resolve(sse({
      status: 'completed',
      output: [{ type: 'function_call', name: 'edit_photo', call_id: 'c1', arguments: '{"change":"to red"}' }],
    }))) as never).complete({ system: 's', messages: [], tools: [] });
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolCalls[0]).toMatchObject({ id: 'c1', name: 'edit_photo', input: { change: 'to red' } });
  });

  it('функции уходят ПЛОСКИМИ — это формат Responses, а не chat/completions', async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(sse({ status: 'completed', output: [] })));
    await mk(f as never).complete({
      system: 's', messages: [],
      tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
    });
    const sent = JSON.parse((f.mock.calls[0]![1] as { body: string }).body);
    expect(sent.tools[0]).toEqual({ type: 'function', name: 't', description: 'd', parameters: { type: 'object' } });
    expect(sent.tools[0].function).toBeUndefined();
  });

  it('результат инструмента возвращается как function_call_output', async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(sse({ status: 'completed', output: [] })));
    await mk(f as never).complete({
      system: 's', tools: [],
      messages: [{ role: 'tool', toolCallId: 'c1', text: '{"ok":true}' }],
    });
    const sent = JSON.parse((f.mock.calls[0]![1] as { body: string }).body);
    expect(sent.input[1]).toEqual({ type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' });
  });

  it('ЛОВУШКА kie.ai: HTTP 200 с code=422 — это ошибка', async () => {
    const p = mk(vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ code: 422, msg: 'not supported' }), { status: 200 }))) as never);
    await expect(p.complete({ system: 's', messages: [], tools: [] })).rejects.toThrow(ChatProviderError);
  });

  it('картинки уходят блоками input_image', async () => {
    const f = vi.fn().mockImplementation(() => Promise.resolve(sse({ status: 'completed', output: [] })));
    await mk(f as never).complete({
      system: 's', tools: [],
      messages: [{ role: 'user', text: 'кто тут?', imageUrls: ['https://x/1.jpg'] }],
    });
    const sent = JSON.parse((f.mock.calls[0]![1] as { body: string }).body);
    expect(sent.input[1].content[0]).toEqual({ type: 'input_image', image_url: 'https://x/1.jpg' });
  });
});
