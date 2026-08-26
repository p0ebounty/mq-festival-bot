import { z } from 'zod';
import { buildFreePrompt, DEFAULT_ASPECT, type AgentTool } from '@mq/core';
import type { AppContext } from '../../context.js';
import { submitGeneration } from './submit.js';

const input = z.object({
  prompt: z.string().min(3).max(2000),
  aspect_ratio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).optional(),
});

/**
 * Генерация картинки с нуля по тексту.
 *
 * Важно: инструмент НЕ ждёт результат. Он ставит задачу и сразу возвращает
 * управление агенту, чтобы участник не сидел в тишине 40–80 секунд.
 * Готовая картинка придёт отдельным сообщением по callback от kie.ai.
 */
export function makeGenerateImageTool(app: AppContext): AgentTool<z.infer<typeof input>> {
  return {
    name: 'generate_image',
    description:
      'Создать новую картинку по текстовому описанию. Вызывай, когда участник просит ' +
      'нарисовать, сгенерировать или показать что-либо, чего у него нет на фото. ' +
      'Поле prompt пиши ПО-АНГЛИЙСКИ, сохраняя мысль участника дословно и добавляя только ' +
      'техническую обвязку (свет, композиция, качество). Не выдумывай деталей, которых он не просил. ' +
      'Вызывай ОДИН раз на просьбу: картинка придёт отдельным сообщением сама, ждать её не нужно. ' +
      'НЕ вызывай, если участник прислал своё фото и просит его изменить.',
    input,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Описание картинки на английском. Мысль участника — дословно, плюс техническая обвязка.',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '3:4', '4:3', '9:16', '16:9'],
          description: 'Соотношение сторон. По умолчанию 1:1. Для пейзажа 16:9, для портрета 9:16.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },

    async run(args, ctx) {
      return submitGeneration(app, ctx, {
        task: 'text_to_image',
        kind: 'image',
        userPrompt: ctx.userMessage,
        finalPrompt: buildFreePrompt(args.prompt),
        aspectRatio: args.aspect_ratio ?? DEFAULT_ASPECT.free,
        successHint: 'Рисую то, что попросил участник.',
      });
    },
  };
}
