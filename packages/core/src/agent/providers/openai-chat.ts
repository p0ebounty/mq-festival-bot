import type {
  AgentMessage, ChatProvider, ChatRequest, ChatResult, AgentToolCall, StopReason,
} from '../types';
import { ChatProviderError } from '../types';

interface OaiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface OaiMessage {
  role: string;
  content?: string | null;
  tool_calls?: OaiToolCall[];
  tool_call_id?: string;
}
interface OaiResponse {
  code?: number;
  msg?: string;
  choices?: Array<{ message?: OaiMessage; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAiChatOptions {
  /** Ключ читается функцией — меняется в админке без рестарта. */
  getApiKey: () => Promise<string> | string;
  model: string;
  /** У kie.ai путь включает имя модели: /{model}/v1/chat/completions */
  buildUrl?: (model: string) => string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Адаптер OpenAI-совместимого chat/completions.
 * Используется для gemini-3-flash / gemini-3-pro у kie.ai.
 */
export class OpenAiChatProvider implements ChatProvider {
  readonly id = 'openai-chat';
  private readonly buildUrl: (model: string) => string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OpenAiChatOptions) {
    this.buildUrl = opts.buildUrl ?? ((m) => `https://api.kie.ai/${m}/v1/chat/completions`);
    // 180 с, а не 90. Живой случай 26.08: запрос отработал у kie.ai за
    // 106 секунд и УСПЕШНО, но мы оборвали его на 90-й — участник получил
    // «попробуй повторить», а кредиты списались впустую. Обычные вызовы
    // укладываются в 3–18 с, 106 — редкий хвост, но он бывает.
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
      messages: [{ role: 'system', content: req.system }, ...req.messages.map(toOai)],
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };

    let res: Response;
    try {
      res = await this.fetchImpl(this.buildUrl(this.opts.model), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && err.name === 'TimeoutError';
      throw new ChatProviderError(
        timeout ? `таймаут провайдера (${this.timeoutMs} мс)` : `сеть: ${String(err)}`,
        true,
        timeout
          ? 'Что-то я совсем завис на этом. Напиши ещё раз, пожалуйста — обычно отвечаю быстро.'
          : 'Связь подвела. Повтори, пожалуйста.',
      );
    }

    const raw = await res.text();
    let j: OaiResponse;
    try {
      j = JSON.parse(raw) as OaiResponse;
    } catch {
      throw new ChatProviderError(`не-JSON ответ (${res.status}): ${raw.slice(0, 120)}`, res.status >= 500);
    }

    // ⚠️ Ловушка kie.ai: недоступная модель отвечает HTTP 200 с code=422 в теле.
    // Судить по статусу нельзя (та же особенность, что и в Jobs API).
    if (typeof j.code === 'number' && j.code !== 200) {
      const fatal = j.code === 422 || j.code === 401 || j.code === 402;
      throw new ChatProviderError(`провайдер: code=${j.code} ${j.msg ?? ''}`, !fatal);
    }
    if (!res.ok) {
      throw new ChatProviderError(`провайдер: HTTP ${res.status} ${raw.slice(0, 120)}`, res.status >= 500);
    }

    const choice = j.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new ChatProviderError('провайдер вернул ответ без choices', true);

    const toolCalls: AgentToolCall[] = (msg.tool_calls ?? []).flatMap((c) => {
      const name = c.function?.name;
      if (!name) return [];
      // Разбирать ТОЛЬКО через JSON.parse: модели по-разному экранируют строки,
      // сравнение подстрок здесь ломается.
      let input: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(c.function?.arguments ?? '{}');
        if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
      } catch {
        // Битые аргументы — не повод падать: инструмент сам отвергнет их
        // валидацией и вернёт модели понятную ошибку.
      }
      return [{ id: c.id ?? `call_${name}`, name, input }];
    });

    const stopReason: StopReason =
      toolCalls.length > 0 ? 'tool_use'
      : choice?.finish_reason === 'length' ? 'length'
      : 'end';

    return {
      text: (msg.content ?? '').trim(),
      toolCalls,
      stopReason,
      usage: {
        inputTokens: j.usage?.prompt_tokens ?? 0,
        outputTokens: j.usage?.completion_tokens ?? 0,
      },
    };
  }
}

function toOai(m: AgentMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId, content: m.text ?? '' };
  }
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: m.text ?? '',
      ...(m.toolCalls?.length
        ? {
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: JSON.stringify(c.input) },
            })),
          }
        : {}),
    };
  }
  // user: картинки и голос идут блоками, если они есть.
  // Аудио тоже уходит через image_url — см. комментарий у AgentMessage.audioDataUrls.
  const media = [...(m.imageUrls ?? []), ...(m.audioDataUrls ?? [])];
  if (media.length) {
    return {
      role: 'user',
      content: [
        ...media.map((url) => ({ type: 'image_url', image_url: { url } })),
        { type: 'text', text: m.text ?? '' },
      ],
    };
  }
  return { role: 'user', content: m.text ?? '' };
}
