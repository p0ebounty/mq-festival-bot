/** Роль сообщения в диалоге. Провайдеро-независимо. */
export type AgentRole = 'user' | 'assistant' | 'tool';

export interface AgentToolCall {
  /** Идентификатор вызова от модели — по нему возвращается результат. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentMessage {
  role: AgentRole;
  text?: string;
  /** Вызовы инструментов в ответе ассистента. */
  toolCalls?: AgentToolCall[];
  /** Для role='tool': на какой вызов это ответ. */
  toolCallId?: string;
  /** URL картинок для vision (фото участника, скриншот репоста). */
  imageUrls?: string[];
}

/** Описание инструмента для модели. */
export interface ToolSchema {
  name: string;
  /**
   * Пишется ДЛЯ МОДЕЛИ, а не для человека: когда вызывать, когда НЕ вызывать,
   * что вернётся. См. .claude/rules/20-bot-agent.md
   */
  description: string;
  parameters: Record<string, unknown>;
}

export type StopReason = 'end' | 'tool_use' | 'length' | 'error';

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  text: string;
  toolCalls: AgentToolCall[];
  stopReason: StopReason;
  usage: ChatUsage;
}

export interface ChatRequest {
  system: string;
  messages: AgentMessage[];
  tools: ToolSchema[];
  maxTokens?: number;
  temperature?: number;
}

/**
 * Провайдер чата. Реализаций несколько, потому что у kie.ai три разных
 * формата (см. ADR 0008): OpenAI-совместимый chat/completions, Responses API
 * с SSE и неработающий Anthropic. Цикл агента от формата не зависит.
 */
export interface ChatProvider {
  readonly id: string;
  complete(req: ChatRequest): Promise<ChatResult>;
}

export class ChatProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly userMessage = 'Не получилось обдумать ответ. Попробуй ещё раз.',
  ) {
    super(message);
    this.name = 'ChatProviderError';
  }
}
