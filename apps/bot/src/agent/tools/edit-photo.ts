import { z } from 'zod';
import { buildWorldPrompt, DEFAULT_ASPECT, type AgentTool } from '@mq/core';
import type { AppContext } from '../../context.js';
import { submitGeneration } from './submit.js';

const input = z.object({
  change: z.string().min(3).max(600),
  aspect_ratio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).optional(),
  caption: z.string().max(200).optional(),
});

/**
 * Правка ЛЮБОГО присланного фото по инструкции.
 *
 * Зачем отдельный инструмент, когда есть restyle_photo и transform_world:
 * те два закрывают строго сценарии ТЗ — «я в профессии» и «мой мир».
 * А участник присылает что угодно: конфеты, кота, кадр из мультика, — и
 * говорит «в космос», «сделай ночью», «добавь роботов».
 *
 * Живой прогон 26.08 показал, чем это кончается без такого инструмента:
 * агент не находил подходящего tool и звал generate_image, то есть рисовал
 * похожее С НУЛЯ, игнорируя присланный кадр. Участник получал не свою
 * картинку и справедливо считал это поломкой.
 */
export function makeEditPhotoTool(app: AppContext): AgentTool<z.infer<typeof input>> {
  return {
    name: 'edit_photo',
    description:
      'Изменить фотографию, которую прислал участник, по его инструкции. ' +
      'Вызывай, когда участник прислал фото (любое: себя, вещь, кадр, животное) и просит ' +
      'что-то с ним сделать: «отправь в космос», «сделай ночью», «добавь роботов», ' +
      '«сделай акварелью», «убери фон». ' +
      'change — что именно изменить, ПО-АНГЛИЙСКИ и дословно по мысли участника. ' +
      'Всё остальное на фото сохранится, поменяется только названное. ' +
      'НЕ вызывай, если участник хочет увидеть СЕБЯ в профессии — для этого есть restyle_photo. ' +
      'НЕ вызывай, если фото не присылали — тогда рисуй с нуля через generate_image.',
    input,
    parameters: {
      type: 'object',
      properties: {
        change: {
          type: 'string',
          description:
            'Что изменить на фото, на английском, дословно по мысли участника. ' +
            'Например: "send this character into outer space".',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '3:4', '4:3', '9:16', '16:9'],
          description: 'Соотношение сторон. По умолчанию как у исходника — 1:1.',
        },
        caption: {
          type: 'string',
          description:
            'Короткая живая подпись к готовой картинке — её увидит участник под фото. ' +
            'Пиши про ЕГО идею, а не общими словами: «Твой рыжий космонавт на бабушкином диване 🚀». ' +
            'Одна фраза, по-русски, без «ваш запрос выполнен».',
        },
      },
      required: ['change'],
      additionalProperties: false,
    },

    async run(args, ctx) {
      // Берём последнюю картинку, а не исходное фото: правки должны
      // накладываться друг на друга, а не откатывать предыдущую.
      const photo = ctx.currentImageUrl ?? ctx.lastImageUrl;
      if (!photo) {
        return {
          ok: false,
          summary: 'Фото участника в этом диалоге нет.',
          note: 'Либо попроси прислать картинку, либо нарисуй с нуля через generate_image.',
          error: 'no_photo',
        };
      }

      // Обвязка та же, что у миров: менять ровно названное, остальное сохранить.
      return submitGeneration(app, ctx, {
        task: 'transform_world',
        kind: 'image',
        userPrompt: ctx.userMessage,
        finalPrompt: buildWorldPrompt({ change: args.change }),
        aspectRatio: args.aspect_ratio ?? DEFAULT_ASPECT.free,
        images: [photo],
        successHint: 'Переделываю присланное фото по просьбе участника.',
        caption: args.caption,
      });
    },
  };
}
