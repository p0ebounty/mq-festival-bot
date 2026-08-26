import { buildCreateTask, planModels, KieError, type ImageTask, type AspectRatio, type ToolResult, type ToolContext } from '@mq/core';
import type { AppContext } from '../../context.js';
import { env } from '../../env.js';

export interface SubmitInput {
  task: ImageTask;
  kind: 'image' | 'profession' | 'world';
  /** Дословная фраза участника — идёт в админку рядом с финальным промптом. */
  userPrompt: string;
  /** Собранный промпт, который уйдёт в модель. */
  finalPrompt: string;
  aspectRatio: AspectRatio;
  /** URL входных картинок (фото участника, базовый мир). */
  images?: string[];
  inputMediaIds?: string[];
  /** Что сказать агенту при успехе — он перескажет это участнику. */
  successHint: string;
  /** Подпись к готовой картинке, написанная агентом. */
  caption?: string | undefined;
}

/**
 * Общий путь постановки генерации: лимиты → списание → цепочка моделей → задача.
 *
 * Вынесено из инструментов, потому что все три сценария ТЗ делают ровно это
 * и расходятся только промптом. Дублировать списание токенов в трёх местах —
 * верный способ однажды забыть возврат при сбое.
 */
export async function submitGeneration(
  app: AppContext,
  ctx: ToolContext,
  input: SubmitInput,
): Promise<ToolResult> {
  const cost = await app.settings.getInt('economy.costPerImage');
  const concurrent = await app.settings.getInt('limits.concurrent');

  const active = await app.generations.activeCountForUser(ctx.userId);
  if (active >= concurrent) {
    return {
      ok: false,
      summary: 'У участника уже готовится картинка. Надо дождаться её, потом делать следующую.',
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

  const req = {
    prompt: input.finalPrompt,
    aspectRatio: input.aspectRatio,
    quality: 'standard' as const,
    ...(input.images?.length ? { images: input.images } : {}),
  };
  const chain = planModels(input.task, req);

  const gen = await app.generations.create({
    userId: ctx.userId,
    kind: input.kind,
    userPrompt: input.userPrompt,
    finalPrompt: input.finalPrompt,
    model: chain[0]!.id,
    params: { aspectRatio: input.aspectRatio, task: input.task, chain: chain.map((m) => m.id) },
    tokensCharged: cost,
    tgChatId: ctx.chatId,
    ...(input.caption ? { caption: input.caption } : {}),
    ...(input.inputMediaIds?.length ? { inputMediaIds: input.inputMediaIds } : {}),
  });

  // Цепочка запасных: сбой одной модели не гасит участника (ADR 0006).
  let lastError = '';
  for (const model of chain) {
    try {
      const payload = buildCreateTask(model, req, `${env.PUBLIC_URL}/hooks/kie`);
      const taskId = await app.kie.createTask(payload);
      await app.generations.markSubmitted(gen.id, taskId, model.kieModel);
      ctx.log.info({ generationId: gen.id, model: model.id, task: input.task }, 'генерация поставлена');
      return {
        ok: true,
        summary:
          `${input.successHint} Картинка придёт отдельным сообщением примерно через минуту. ` +
          `Списано ${cost} токен(ов), осталось ${balance}. Скажи это участнику своими словами и НЕ жди результат.`,
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
}
