import { z } from 'zod';
import type { ToolSchema } from './types';

/**
 * Результат инструмента. Ошибка — это НЕ исключение, а нормальный результат
 * с ok:false и причиной, понятной модели: тогда агент может объяснить
 * участнику, что пошло не так, и предложить выход.
 * См. .claude/rules/20-bot-agent.md
 */
export interface ToolResult {
  ok: boolean;
  /**
   * ФАКТ о том, что произошло. Это можно пересказать участнику.
   * Пиши утверждением, а не приказом: «Задача поставлена», а не
   * «Скажи участнику, что задача поставлена».
   */
  summary: string;
  /**
   * Служебные указания агенту: чего НЕ делать, куда двигаться дальше.
   * Участник этого не видит и видеть не должен.
   *
   * Разделение появилось после живого случая: указания лежали прямо в
   * summary («Объясни участнику, что…»), и агент однажды напечатал их
   * в чат дословно — «Артём говорит, что не понял. Нужно коротко объяснить…».
   */
  note?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ToolContext {
  userId: string;
  conversationId: string;
  /** Telegram chat id — нужен инструментам, которые досылают сообщения. */
  chatId: bigint;
  /**
   * Исходная фраза участника ДОСЛОВНО, как он её написал.
   * Нужна, чтобы в админке лежала пара «что сказал человек» ↔ «что ушло в
   * модель»: без неё нельзя проверить, не увёл ли агент авторскую мысль.
   * См. .claude/rules/20-bot-agent.md
   */
  userMessage: string;
  /**
   * Все картинки диалога с короткими id (img1, img2…).
   *
   * Пришло на смену `lastImageUrl` / `currentImageUrl`: те выбирали картинку
   * ЗА модель, по эвристике «в этом сообщении фото нет → бери последний
   * результат». Эвристика ошибалась молча — например, накладывала правку на
   * генерацию 22-минутной давности вместо только что присланного фото.
   * Теперь список отдаётся модели целиком, а выбор делает она (ADR 0010).
   */
  images?: ReadonlyArray<{ id: string; url: string; origin: 'user' | 'bot'; label: string }> | undefined;
  /**
   * Предложить участнику кнопки-подсказки под ответом. Нажатие вставляет
   * текст как обычное сообщение, поэтому кнопки — **ускоритель, а не меню**:
   * убери их, и бот останется полностью рабочим (ADR 0003).
   */
  suggest?: ((options: string[]) => void) | undefined;
  /**
   * Инструмент сообщает, что уже отправил участнику карточку «Рисую…».
   * Бот по этому признаку решает, отправить свой текст НОВЫМ сообщением —
   * чтобы оно легло ПОД карточкой, а не над ней.
   */
  notePlaceholderSent?: (() => void) | undefined;
  /** Логгер вызывающей стороны. */
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void };
}

export interface AgentTool<TInput = unknown> {
  name: string;
  description: string;
  /** zod-схема входа: и валидация, и источник JSON Schema для модели. */
  input: z.ZodType<TInput>;
  /** JSON Schema параметров — пишем руками, чтобы описания полей были для модели. */
  parameters: Record<string, unknown>;
  run(input: TInput, ctx: ToolContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool<never>>();

  register<T>(tool: AgentTool<T>): this {
    if (this.tools.has(tool.name)) throw new Error(`инструмент ${tool.name} уже зарегистрирован`);
    this.tools.set(tool.name, tool as AgentTool<never>);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Схемы для модели. Порядок стабилен — важно для кэша промпта. */
  schemas(): ToolSchema[] {
    return [...this.tools.values()]
      .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Выполняет инструмент. Любая беда превращается в ToolResult, а не в
   * исключение: цикл агента не должен обрываться из-за одного инструмента.
   */
  async execute(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        summary: `Инструмента ${name} не существует.`,
        error: 'unknown_tool',
      };
    }

    const parsed = tool.input.safeParse(rawInput);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((i) => `${i.path.join('.') || 'вход'}: ${i.message}`)
        .join('; ');
      return {
        ok: false,
        summary: `Не хватает данных для ${name}: ${details}. Уточни у участника или заполни сам.`,
        error: 'invalid_input',
      };
    }

    try {
      return await tool.run(parsed.data as never, ctx);
    } catch (err) {
      ctx.log.warn({ tool: name, err: String(err) }, 'инструмент упал');
      return {
        ok: false,
        summary: `Инструмент ${name} не сработал. Можно попробовать ещё раз.`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
