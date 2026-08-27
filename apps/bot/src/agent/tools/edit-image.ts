import { z } from 'zod';
import { buildEditPrompt, DEFAULT_ASPECT, type AgentTool } from '@mq/core';
import type { AppContext } from '../../context.js';
import { submitGeneration } from './submit.js';

const input = z.object({
  image_id: z.string().min(1).max(16),
  change: z.string().min(3).max(600),
  aspect_ratio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).optional(),
  caption: z.string().max(200).optional(),
});

/**
 * Единственный инструмент правки картинок.
 *
 * Заменил собой три: `edit_photo`, `restyle_photo` («я в профессии») и
 * `transform_world` («мой мир»). Все три делали одно и то же — брали
 * картинку и меняли её по фразе, — а расходились лишь промптом, который
 * теперь общий (ADR 0010).
 *
 * Ключевое отличие от предшественников: **картинку называет модель**.
 * Раньше её выбирал backend по эвристике, и модель физически не могла
 * сказать «нет, я про кота, а не про собаку».
 */
export function makeEditImageTool(app: AppContext): AgentTool<z.infer<typeof input>> {
  return {
    name: 'edit_image',
    description:
      'Изменить одну из картинок диалога по просьбе участника. ' +
      'Годится для всего: «сделай ночью», «добавь роботов», «перекрась куртку», ' +
      '«одень меня космонавтом», «пусть в моём мире будет шторм». ' +
      'image_id — id картинки из списка «Картинки в этом диалоге». Бери ту, про которую ' +
      'участник говорит СЕЙЧАС: обычно последнюю подходящую по смыслу, а не просто последнюю. ' +
      'Сказал «добавь коту мороженое» — бери самого свежего кота, а не собаку. ' +
      'change — что именно изменить, ПО-АНГЛИЙСКИ и дословно по мысли участника. ' +
      'Для профессии опиши одежду и место: "dress the person as a cosmonaut in a white ' +
      'spacesuit with mission patches, aboard a space station". ' +
      'Всё, что не названо в change, на картинке сохранится. ' +
      'НЕ вызывай, если картинки нет вообще — тогда рисуй с нуля через generate_image.',
    input,
    parameters: {
      type: 'object',
      properties: {
        image_id: {
          type: 'string',
          description: 'id картинки из списка диалога, например "img2".',
        },
        change: {
          type: 'string',
          description:
            'Что изменить, на английском, дословно по мысли участника. ' +
            'Например: "add a locomotive on the tracks".',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '3:4', '4:3', '9:16', '16:9'],
          description:
            'Кадр. Ты видишь картинку — выбери похожий: 3:4 для человека в полный рост, ' +
            '16:9 для пейзажа и мира, 1:1 если сомневаешься.',
        },
        caption: {
          type: 'string',
          description:
            'Короткая живая подпись к готовой картинке — её увидит участник под фото. ' +
            'Пиши про ЕГО идею, а не общими словами: «Твой рыжий космонавт на бабушкином диване». ' +
            'Одна фраза, по-русски, без «ваш запрос выполнен».',
        },
      },
      required: ['image_id', 'change'],
      additionalProperties: false,
    },

    async run(args, ctx) {
      const images = ctx.images ?? [];
      if (images.length === 0) {
        return {
          ok: false,
          summary: 'В этом диалоге ещё нет ни одной картинки.',
          note: 'Либо попроси прислать фото, либо нарисуй с нуля через generate_image.',
          error: 'no_images',
        };
      }

      const wanted = args.image_id.trim().toLowerCase();
      const picked = images.find((i) => i.id.toLowerCase() === wanted);
      if (!picked) {
        // Промах по id — не исключение, а повод показать список: так модель
        // поправится сама, не втягивая в это участника.
        return {
          ok: false,
          summary: `Картинки с id «${args.image_id}» в диалоге нет.`,
          note:
            'Возьми id из списка и вызови edit_image ещё раз. Доступны: ' +
            images.map((i) => `${i.id} — ${i.label}`).join('; ') +
            '. Участнику про id не пиши, это наша внутренняя нумерация.',
          error: 'unknown_image_id',
          data: { available: images.map((i) => i.id) },
        };
      }

      return submitGeneration(app, ctx, {
        // Модель выбирает код, а не агент (ADR 0006). Сигнал — происхождение
        // картинки: собственное фото участника почти всегда означает «тут
        // человек, лицо терять нельзя», и цепочка для него начинается с
        // модели, которая лучше держит лицо. Это не флаг для агента — он
        // про маршрутизацию вообще ничего не знает.
        task: picked.origin === 'user' ? 'restyle_photo' : 'transform_world',
        // ⚠️ kind='world' двигает текущий мир участника вперёд по цепочке,
        // поэтому он ставится ТОЛЬКО настоящему миру из игры. Раньше здесь
        // стояло «пришло от нас → значит мир», и правка присланного фото
        // молча угоняла мир: живой случай 27.08, город на облаках заменился
        // отредактированной башней.
        kind: picked.isWorld ? 'world' : 'image',
        userPrompt: ctx.userMessage,
        finalPrompt: buildEditPrompt({ change: args.change }),
        aspectRatio: args.aspect_ratio ?? DEFAULT_ASPECT.free,
        images: [picked.url],
        sourceUrl: picked.url,
        successHint: 'Меняю картинку по просьбе участника.',
        caption: args.caption,
      });
    },
  };
}
