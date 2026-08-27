import { z } from 'zod';
import type { AgentTool } from '@mq/core';

/**
 * Ограничения НАШИ, не Telegram.
 *
 * Проверено запросами к API: сервер не режет ни длину текста кнопки
 * (проходит и 512 символов), ни количество рядов (проходит и 120).
 * Но на телефоне длинная надпись переносится на вторую строку и обрезается,
 * а десяток кнопок закрывает пол-экрана. Поэтому рамки ставим сами.
 *
 * Отдельно от этого действует лимит Telegram на callback_data — 64 БАЙТА.
 * Он байтовый, а кириллица занимает два байта на букву, так что тридцать
 * «безопасных» символов в него укладываются впритык. Досматривает
 * `fitCallbackText` в suggest-button.ts.
 */
export const MAX_SUGGESTIONS = 3;
export const MAX_SUGGESTION_LEN = 30;

const input = z.object({
  options: z.array(z.string().min(1)).min(1).max(MAX_SUGGESTIONS),
});

export function makeSuggestTool(): AgentTool<z.infer<typeof input>> {
  return {
    name: 'suggest_replies',
    description:
      'Показать участнику 1–3 кнопки с готовыми вариантами ответа под твоим сообщением. ' +
      'Нажатие отправит текст кнопки как его сообщение, а сами кнопки при этом исчезнут. Вызывай, когда предлагаешь выбор и короткий ' +
      'вариант реально экономит человеку набор текста: профессии на выбор, идеи ' +
      'изменения мира, «давай ещё раз». ' +
      `Каждый вариант — до ${MAX_SUGGESTION_LEN} символов, иначе не влезет на экран телефона. ` +
      'НЕ вызывай на каждое сообщение: кнопки под каждой репликой превращают живой ' +
      'разговор в меню, а этого мы избегаем. Если участник и так знает, что сказать, — не мешай.',
    input,
    parameters: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: { type: 'string' },
          maxItems: MAX_SUGGESTIONS,
          description:
            `От 1 до ${MAX_SUGGESTIONS} коротких вариантов, до ${MAX_SUGGESTION_LEN} символов каждый. ` +
            'Пиши их от лица участника: «Хочу космонавтом», а не «Выбрать космонавта».',
        },
      },
      required: ['options'],
      additionalProperties: false,
    },

    async run(args, ctx) {
      // Длинные варианты не отбрасываем целиком — подрезаем: лучше показать
      // укороченную подсказку, чем не показать ничего.
      const cleaned = args.options
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => (o.length > MAX_SUGGESTION_LEN ? `${o.slice(0, MAX_SUGGESTION_LEN - 1)}…` : o))
        .slice(0, MAX_SUGGESTIONS);

      if (cleaned.length === 0) {
        return { ok: false, summary: 'Пустой список вариантов — кнопки не показаны.', error: 'empty' };
      }
      if (!ctx.suggest) {
        return {
          ok: false,
          summary: 'Кнопки в этом чате недоступны.',
          note: 'Просто перечисли варианты словами.',
          error: 'unsupported',
        };
      }

      ctx.suggest(cleaned);
      return {
        ok: true,
        summary: `Кнопки показаны: ${cleaned.map((c) => `«${c}»`).join(', ')}.`,
        note: 'Не дублируй их в тексте — участник и так их видит. Напиши обычную фразу.',
        data: { shown: cleaned },
      };
    },
  };
}
