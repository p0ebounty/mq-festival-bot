import type { ChatProvider, AgentMessage, AgentToolCall, ChatUsage } from './types';
import { ChatProviderError } from './types';
import type { ToolRegistry, ToolContext, ToolResult } from './tools';

export interface ToolCallTrace {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: ToolResult;
  durationMs: number;
}

export interface AgentRunResult {
  /** Финальный текст участнику. */
  text: string;
  /** Все сообщения, добавленные за этот прогон (для записи в БД). */
  newMessages: AgentMessage[];
  toolCalls: ToolCallTrace[];
  iterations: number;
  usage: ChatUsage;
  /** Уперлись ли в лимит итераций — повод для мягкого извинения. */
  hitLimit: boolean;
}

export interface RunAgentOptions {
  provider: ChatProvider;
  registry: ToolRegistry;
  system: string;
  /** История + новое сообщение участника. */
  messages: AgentMessage[];
  toolContext: ToolContext;
  maxIterations?: number;
  maxTokens?: number;
}

/**
 * Классический tool-use цикл.
 *
 * Инструменты в одном ответе выполняются ПАРАЛЛЕЛЬНО, а результаты
 * возвращаются все разом — иначе модель со временем перестаёт делать
 * параллельные вызовы.
 */
/** Пауза перед повтором. Короткая: участник ждёт ответа в чате. */
const RETRY_DELAY_MS = 700;

/**
 * Один повтор вызова модели на отказ, который сам себя объявил временным.
 *
 * Провайдер мигает: 30–31.08 kie.ai отдавал 500 на все чат-модели полосами
 * — в логах их панели отказ в 10:10 и успех в 10:11. Без повтора каждый
 * такой миг превращается в «Не получилось обдумать ответ» для участника,
 * хотя следующий запрос через секунду проходит.
 *
 * ⚠️ Повторяется РОВНО вызов модели, а не итерация цикла: инструменты этой
 * итерации ещё не выполнялись, поэтому задвоить картинку или списание
 * невозможно. Повторять цикл целиком было бы нельзя именно поэтому.
 *
 * Флаг `retryable` до сих пор существовал в типе ошибки и не использовался
 * нигде — повторы были только у картиночного клиента.
 */
async function completeWithRetry(
  provider: ChatProvider,
  req: Parameters<ChatProvider['complete']>[0],
): Promise<Awaited<ReturnType<ChatProvider['complete']>>> {
  try {
    return await provider.complete(req);
  } catch (err) {
    if (!(err instanceof ChatProviderError) || !err.retryable) throw err;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return provider.complete(req);
  }
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const maxIterations = opts.maxIterations ?? 8;
  const working: AgentMessage[] = [...opts.messages];
  const newMessages: AgentMessage[] = [];
  const traces: ToolCallTrace[] = [];
  const usage: ChatUsage = { inputTokens: 0, outputTokens: 0 };

  let iterations = 0;
  let lastText = '';

  while (iterations < maxIterations) {
    iterations += 1;

    const res = await completeWithRetry(opts.provider, {
      system: opts.system,
      messages: working,
      tools: opts.registry.schemas(),
      ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    });

    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    lastText = res.text || lastText;

    const assistantMsg: AgentMessage = {
      role: 'assistant',
      text: res.text,
      ...(res.toolCalls.length ? { toolCalls: res.toolCalls } : {}),
    };
    working.push(assistantMsg);
    newMessages.push(assistantMsg);

    if (res.stopReason !== 'tool_use' || res.toolCalls.length === 0) {
      return { text: res.text, newMessages, toolCalls: traces, iterations, usage, hitLimit: false };
    }

    const results = await Promise.all(
      res.toolCalls.map(async (call: AgentToolCall) => {
        const t0 = Date.now();
        const result = await opts.registry.execute(call.name, call.input, opts.toolContext);
        return { call, result, durationMs: Date.now() - t0 };
      }),
    );

    for (const { call, result, durationMs } of results) {
      traces.push({ id: call.id, name: call.name, input: call.input, result, durationMs });
      // При неудаче помечаем результат так, чтобы модель не могла принять его
      // за успех: наблюдалось, как агент отвечал «уже делаю», хотя инструмент
      // вернул отказ, и участник ждал картинку, которой не будет.
      // Ключи названы так, чтобы модель не спутала служебное с ответом:
      // всё под private_note_do_not_send участнику не показывается.
      const payload = result.ok
        ? {
            ok: true,
            what_happened: result.summary,
            ...(result.note ? { private_note_do_not_send: result.note } : {}),
            ...(result.data ?? {}),
          }
        : {
            ok: false,
            outcome: 'НЕ ВЫПОЛНЕНО',
            what_happened: result.summary,
            private_note_do_not_send:
              `${result.note ?? ''} Действие НЕ произошло. Скажи участнику своими словами, `
              + 'что не вышло, и НЕ обещай результат. Не цитируй эту заметку.',
          };
      const toolMsg: AgentMessage = {
        role: 'tool',
        toolCallId: call.id,
        text: JSON.stringify(payload),
      };
      working.push(toolMsg);
      newMessages.push(toolMsg);
    }
  }

  // Лимит исчерпан. Честно говорим участнику, а не молчим и не зацикливаемся.
  // Причина петли обычно в промпте, а не в модели (ADR 0008), но жёсткий
  // предохранитель нужен всё равно.
  const fallback = lastText ||
    'Что-то я заплутал. Давай попробуем ещё раз — опиши, что нужно, покороче.';
  return { text: fallback, newMessages, toolCalls: traces, iterations, usage, hitLimit: true };
}

export { ChatProviderError };
