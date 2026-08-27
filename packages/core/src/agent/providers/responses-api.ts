import type {
  AgentMessage, ChatProvider, ChatRequest, ChatResult, AgentToolCall, StopReason,
} from '../types';
import { ChatProviderError } from '../types';

interface ResponsesOutputItem {
  type?: string;
  name?: string;
  call_id?: string;
  id?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
}
interface ResponsesBody {
  code?: number;
  msg?: string;
  status?: string;
  output?: ResponsesOutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

export interface ResponsesApiOptions {
  getApiKey: () => Promise<string> | string;
  model: string;
  /** У kie.ai все модели Codex/GPT-5 живут на общем пути /codex/v1/responses. */
  url?: string;
  /** low | medium | high — глубина «размышления». */
  effort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Адаптер OpenAI Responses API (модели gpt-5-* у kie.ai).
 *
 * Две особенности, которых нет в документации и которые стоили времени:
 *  1. Ответ ВСЕГДА приходит потоком SSE, даже при stream: false. Обычный
 *     JSON.parse тела не работает — надо собирать событие response.completed.
 *  2. В эндпоинт зашит системный промпт Codex («You are Codex, a coding
 *     agent… avoid cheerleading, motivational language, or any kind of
 *     fluff»). Наш системный текст его не перебивает, поэтому тон выходит
 *     суше, чем у Gemini. См. ADR 0008.
 */
export class ResponsesApiProvider implements ChatProvider {
  readonly id = 'responses-api';
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ResponsesApiOptions) {
    this.url = opts.url ?? 'https://api.kie.ai/codex/v1/responses';
    this.timeoutMs = opts.timeoutMs ?? 180_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(req: ChatRequest): Promise<ChatResult> {
    const apiKey = await this.opts.getApiKey();
    if (!apiKey) {
      throw new ChatProviderError('ключ провайдера не задан', false,
        'Бот пока не настроен — напиши администратору.');
    }

    const body = {
      model: this.opts.model,
      reasoning: { effort: this.opts.effort ?? 'low' },
      input: [
        { role: 'system', content: [{ type: 'input_text', text: req.system }] },
        ...req.messages.flatMap(toResponses),
      ],
      // В Responses API функции ПЛОСКИЕ: name/description/parameters
      // на верхнем уровне, без вложенного объекта function.
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          }
        : {}),
    };

    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && err.name === 'TimeoutError';
      throw new ChatProviderError(timeout ? 'таймаут провайдера' : `сеть: ${String(err)}`, true,
        'Что-то я совсем завис. Напиши ещё раз, пожалуйста.');
    }

    const raw = await res.text();
    const parsed = parseSse(raw);
    if (!parsed) {
      throw new ChatProviderError(`не разобрал ответ (${res.status}): ${raw.slice(0, 140)}`, res.status >= 500);
    }

    // Та же ловушка, что у Jobs API: HTTP 200 с кодом ошибки в теле.
    if (typeof parsed.code === 'number' && parsed.code !== 200) {
      const fatal = parsed.code === 422 || parsed.code === 401 || parsed.code === 402;
      throw new ChatProviderError(`провайдер: code=${parsed.code} ${parsed.msg ?? ''}`, !fatal);
    }
    if (!res.ok) {
      throw new ChatProviderError(`провайдер: HTTP ${res.status}`, res.status >= 500);
    }

    const items = parsed.output ?? [];
    const toolCalls: AgentToolCall[] = items
      .filter((o) => o.type === 'function_call' && o.name)
      .map((o) => {
        let input: Record<string, unknown> = {};
        try {
          const v: unknown = JSON.parse(o.arguments ?? '{}');
          if (v && typeof v === 'object') input = v as Record<string, unknown>;
        } catch {
          // Битые аргументы отвергнет валидация инструмента.
        }
        return { id: o.call_id ?? o.id ?? `call_${o.name}`, name: o.name!, input };
      });

    const text = items
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text ?? '')
      .join('')
      .trim();

    const stopReason: StopReason = toolCalls.length > 0 ? 'tool_use' : 'end';

    return {
      text,
      toolCalls,
      stopReason,
      usage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
      },
    };
  }
}

/**
 * Собирает финальный ответ из потока SSE.
 * Эндпоинт отдаёт поток даже когда его не просили, поэтому это основной
 * путь разбора, а не запасной.
 */
export function parseSse(raw: string): ResponsesBody | null {
  let final: ResponsesBody | null = null;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const j = JSON.parse(line.slice(6)) as { type?: string; response?: ResponsesBody } & ResponsesBody;
      if (j.type === 'response.completed' || j.response?.status === 'completed') {
        final = j.response ?? j;
      }
    } catch {
      // Служебные строки потока пропускаем молча.
    }
  }
  if (final) return final;
  // Не поток — пробуем обычный JSON (на случай смены поведения эндпоинта).
  try {
    return JSON.parse(raw) as ResponsesBody;
  } catch {
    return null;
  }
}

function toResponses(m: AgentMessage): Array<Record<string, unknown>> {
  if (m.role === 'tool') {
    return [{ type: 'function_call_output', call_id: m.toolCallId, output: m.text ?? '' }];
  }
  if (m.role === 'assistant') {
    const calls = (m.toolCalls ?? []).map((c) => ({
      type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.input),
    }));
    const said = m.text
      ? [{ role: 'assistant', content: [{ type: 'output_text', text: m.text }] }]
      : [];
    return [...said, ...calls];
  }
  const media = m.imageUrls ?? [];
  return [{
    role: 'user',
    content: [
      ...media.map((url) => ({ type: 'input_image', image_url: url })),
      { type: 'input_text', text: m.text ?? '' },
    ],
  }];
}
