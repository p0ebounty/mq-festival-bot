import { z } from 'zod';
import { buildCreateTask, planModels, KieError, type ImageTask } from '@mq/core';
import type { AppContext } from '../../context.js';
import type { AgentTool } from '@mq/core';
import { env } from '../../env.js';

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
      const cost = await app.settings.getInt('economy.costPerImage');
      const concurrent = await app.settings.getInt('limits.concurrent');

      const active = await app.generations.activeCountForUser(ctx.userId);
      if (active >= concurrent) {
        return {
          ok: false,
          summary: 'У участника уже генерируется картинка. Надо дождаться её, потом делать следующую.',
          error: 'already_generating',
        };
      }

      // Списываем ДО постановки задачи и атомарно — иначе два быстрых
      // сообщения подряд уведут баланс в минус.
      const balance = await app.tokens.charge(ctx.userId, cost);
      if (balance === null) {
        return {
          ok: false,
          summary: `Токенов не хватает: нужно ${cost}. Бонусные дают за репост готовой картинки в соцсеть.`,
          error: 'insufficient_tokens',
        };
      }

      const task: ImageTask = 'text_to_image';
      const req = {
        prompt: args.prompt,
        ...(args.aspect_ratio ? { aspectRatio: args.aspect_ratio } : {}),
        quality: 'standard' as const,
      };
      const chain = planModels(task, req);

      const gen = await app.generations.create({
        userId: ctx.userId,
        kind: 'image',
        // userPrompt — дословная фраза участника, finalPrompt — что сочинил
        // агент. В админке они показываются рядом; если писать сюда args.prompt,
        // пара схлопывается и проверять становится нечего.
        userPrompt: ctx.userMessage,
        finalPrompt: args.prompt,
        model: chain[0]!.id,
        params: { aspectRatio: req.aspectRatio ?? '1:1', quality: 'standard', chain: chain.map((m) => m.id) },
        tokensCharged: cost,
        tgChatId: ctx.chatId,
      });

      // Цепочка запасных: сбой одной модели не гасит участника (ADR 0006).
      let lastError = '';
      for (const model of chain) {
        try {
          const payload = buildCreateTask(model, req, `${env.PUBLIC_URL}/hooks/kie`);
          const taskId = await app.kie.createTask(payload);
          await app.generations.markSubmitted(gen.id, taskId, model.kieModel);
          ctx.log.info({ generationId: gen.id, model: model.id, taskId }, 'генерация поставлена');
          return {
            ok: true,
            summary:
              `Задача поставлена. Картинка придёт отдельным сообщением примерно через минуту. ` +
              `Списано ${cost} токен(ов), осталось ${balance}. Скажи участнику, что делаешь, и не жди результат.`,
            data: { status: 'accepted', eta_sec: 60, balance_left: balance },
          };
        } catch (err) {
          lastError = err instanceof KieError ? err.message : String(err);
          ctx.log.warn({ generationId: gen.id, model: model.id, err: lastError },
            'модель не приняла задачу, пробуем следующую');
        }
      }

      // Ни одна модель не приняла — возвращаем токены.
      await app.tokens.grant(ctx.userId, cost);
      await app.generations.markFailed(gen.id, 'no_model', lastError);
      return {
        ok: false,
        summary: 'Сервис генерации сейчас не отвечает. Токены вернул, можно попробовать через минуту.',
        error: 'all_models_failed',
      };
    },
  };
}
