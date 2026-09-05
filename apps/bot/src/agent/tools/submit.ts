import { planModels, type ImageTask, type AspectRatio, type ToolResult, type ToolContext } from '@mq/core';
import { submitToChain } from './chain.js';
import type { AppContext } from '../../context.js';
import { moderate, MODERATE_IMAGES } from '../../moderation/index.js';

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
  /**
   * Какая картинка ушла в модель. Пишется в БД, чтобы источник был виден в
   * админке: когда бот отредактировал не тот снимок, выяснять это пришлось
   * запросом в kie.ai — у нас он не хранился нигде.
   */
  sourceUrl?: string | undefined;
  /**
   * По какому заданию сделана работа, если правилась картинка задания или
   * её потомок. Проставляется из реестра картинок, а не из состояния
   * участника: связь выводится из того, что правили (ADR 0013).
   */
  taskId?: string | undefined;
  /** Из какого стартового мира выросла работа — оттуда же, из реестра. */
  worldId?: string | undefined;
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
  // Проверка контента стоит ДО списания и до постановки задачи: через эту
  // функцию проходят все генерации разом, а промпт для генератора пишет сам
  // агент, и второго мнения в цепочке больше нет (ADR 0014).
  const verdict = await moderate(app, {
    userId: ctx.userId,
    stage: 'prompt',
    text: [ctx.userMessage, input.finalPrompt].filter(Boolean).join('\n'),
    ...(MODERATE_IMAGES && input.images?.length ? { imageUrls: input.images } : {}),
    log: ctx.log,
  });
  if (!verdict.allowed) {
    ctx.log.info({ category: verdict.category, source: verdict.source }, 'запрос отклонён проверкой');
    // Проверка не ответила — это сбой на нашей стороне, а не запрет.
    // Говорить «такое рисовать нельзя» здесь значит соврать участнику и
    // отправить его придумывать другую идею вместо простого повтора.
    if (verdict.source === 'unavailable') {
      return {
        ok: false,
        summary: 'Проверка не ответила — это сбой на нашей стороне, а не запрет.',
        note:
          'Скажи КОРОТКО, что у тебя моргнула проверка, и попроси повторить ту же просьбу ' +
          'через минуту. Не намекай, что идея запрещённая, и не предлагай другую: ' +
          'она в порядке. Токены не списаны.',
        error: 'moderation_unavailable',
      };
    }
    return {
      ok: false,
      summary: `Такое рисовать нельзя: ${verdict.reason}.`,
      note:
        'Скажи это КОРОТКО и дружелюбно, одной фразой, без нотаций и без списка правил, ' +
        'и сразу предложи другую идею. Токены не списаны. Спорить и обсуждать запрет не надо: ' +
        'уговоры на него не действуют.',
      error: 'moderation_blocked',
      data: { category: verdict.category },
    };
  }

  const cost = await app.settings.getInt('economy.costPerImage');
  const concurrent = await app.settings.getInt('limits.concurrent');

  const active = await app.generations.activeCountForUser(ctx.userId);
  if (active >= concurrent) {
    return {
      ok: false,
      summary: 'У участника уже готовится другая картинка.',
      note: 'Скажи, что доделаешь текущую и сразу возьмёшься за эту.',
      error: 'already_generating',
    };
  }

  // Списываем ДО постановки задачи и атомарно — иначе два быстрых
  // сообщения подряд уведут баланс в минус.
  const balance = await app.tokens.charge(ctx.userId, cost, { reason: 'generation' });
  if (balance === null) {
    return {
      ok: false,
      summary: `Токенов не хватает: нужно ${cost}, а их меньше.`,
      note: 'Подскажи, что бонусные токены дают за репост готовой картинки в соцсеть.',
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
    // В params — всё, что нужно пересдать задачу другой модели БЕЗ агента,
    // если kie.ai ответит сбоем уже после постановки (ADR 0006, дополнение
    // 04.09): картинки как ушли в модель, а через markSubmitted — список
    // моделей, которым задача уже предлагалась.
    params: {
      aspectRatio: input.aspectRatio,
      task: input.task,
      chain: chain.map((m) => m.id),
      images: input.images ?? [],
    },
    tokensCharged: cost,
    tgChatId: ctx.chatId,
    conversationId: ctx.conversationId,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.worldId ? { worldId: input.worldId } : {}),
    ...(input.caption ? { caption: input.caption } : {}),
    ...(input.inputMediaIds?.length ? { inputMediaIds: input.inputMediaIds } : {}),
  });

  // Цепочка запасных: сбой одной модели не гасит участника (ADR 0006).
  const outcome = await submitToChain(app, gen.id, req, chain, [], ctx.log);
  if (outcome.placed) {
    const { model } = outcome.placed;
    // Карточка «Рисую…» уходит сразу: участник видит место, где появится
    // картинка, и понимает, что работа идёт. По готовности мы подменим
    // в этом же сообщении изображение — превращение на месте.
    const placeholderId = await app.sendPlaceholderCard?.(ctx.chatId, gen.id);
    if (placeholderId) {
      await app.generations.setPlaceholder(gen.id, placeholderId);
      ctx.notePlaceholderSent?.();
    }
    ctx.log.info({ generationId: gen.id, model: model.id, task: input.task }, 'генерация поставлена');
    return {
      ok: true,
      summary:
        `${input.successHint} Картинка появится в карточке «Рисую…» через минуту-две. ` +
        `Списано ${cost} токен(ов), осталось ${balance}.`,
      note:
        'Карточка «Рисую…» уже у участника, твой текст после постановки генерации ему НЕ ' +
        'отправляется. Ответь одним словом «ок». Результат не жди — он придёт сам.',
      data: { status: 'accepted', eta_sec: 60, balance_left: balance },
    };
  }

  // Ни одна модель не приняла — возвращаем токены.
  await app.tokens.grant(ctx.userId, cost, { reason: 'refund', generationId: gen.id });
  await app.generations.markFailed(gen.id, 'no_model', outcome.lastError);
  return {
    ok: false,
    summary: 'Сервис генерации не ответил. Токены возвращены.',
    note: 'Предложи попробовать через минуту.',
    error: 'all_models_failed',
  };
}
