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

    const res = await opts.provider.complete({
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
      const payload = result.ok
        ? { ok: true, summary: result.summary, ...(result.data ?? {}) }
        : {
            ok: false,
            outcome: 'НЕ ВЫПОЛНЕНО',
            reason: result.summary,
            instruction: 'Действие НЕ произошло. Объясни это участнику своими словами и НЕ обещай результат.',
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
