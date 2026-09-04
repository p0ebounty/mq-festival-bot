import { z } from 'zod';
import {
  ASPECT_RATIOS, IMAGE_MODELS, NoSuitableModelError, planModels,
  type ImageModel, type ImageRequest, type ImageTask, type TaskRecord,
} from '@mq/core';
import type { AppContext } from '../../context.js';
import { submitToChain, type TaskLogger } from './chain.js';

/**
 * Пересдача генерации следующей модели цепочки, когда kie.ai ответил
 * сбоем УЖЕ ПОСЛЕ постановки (ADR 0006, дополнение 04.09).
 *
 * До этого цепочка запасных срабатывала только на отказ createTask.
 * Асинхронный fail — таймаут 524, 501, отказ по контенту — закрывал
 * генерацию сразу: участник 108 секунд смотрел на «Рисую…» и получал
 * «не получилось». Здесь агента уже нет, поэтому всё нужное для повтора
 * читается из строки генерации: промпт, картинки, задача, кто уже пробовал.
 */

/**
 * Не больше ОДНОЙ асинхронной пересдачи на генерацию. Каждая попытка —
 * это ещё 60–100 секунд, которые участник смотрит на заглушку «Рисую…».
 * Вторая пересдача — уже третья минута ожидания; честнее вернуть токен и
 * предложить сформулировать иначе.
 */
export const MAX_ASYNC_RETRIES = 1;

type GenerationRow = NonNullable<Awaited<ReturnType<AppContext['generations']['byId']>>>;

export interface FailureDeps {
  generations: Pick<AppContext['generations'], 'claimRetry' | 'markSubmitted' | 'markFailed'>;
  kie: Pick<AppContext['kie'], 'createTask'>;
  tokens: Pick<AppContext['tokens'], 'grant'>;
  deliverGeneration?: AppContext['deliverGeneration'];
}

export type ResubmitOutcome =
  /** Задача ушла следующей модели, заглушка «Рисую…» остаётся честной. */
  | 'resubmitted'
  /** Строку по старому taskId уже забрал кто-то другой (callback или воркер). */
  | 'claimed_elsewhere'
  /** Строку забрали мы, но ни одна запасная модель не приняла задачу. */
  | 'exhausted'
  /** Пересдавать нельзя: лимит, цепочка исчерпана, нечего собрать. */
  | 'not_eligible';

const TASKS = ['text_to_image', 'restyle_photo', 'transform_world'] as const satisfies readonly ImageTask[];

/** Что мы сами положили в `params` при постановке. Старые строки имеют не всё. */
const storedParams = z.object({
  task: z.enum(TASKS).optional(),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  images: z.array(z.string()).optional(),
  tried: z.array(z.string()).optional(),
  retries: z.number().int().optional(),
});
type StoredParams = z.infer<typeof storedParams>;

function readParams(raw: unknown, generationId: string, log: TaskLogger): StoredParams {
  const parsed = storedParams.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  log.warn({ generationId, issues: parsed.error.issues.length }, 'params генерации не разобрались, пересдача без них');
  return {};
}

/**
 * Строки, созданные до 04.09, списка `tried` не имеют. Колонка `model`
 * после markSubmitted хранит kieModel текущей модели (а до неё — наш id),
 * поэтому сверяем с обоими именами.
 */
function triedFromModelColumn(model: string): string[] {
  return IMAGE_MODELS.filter((m) => m.kieModel === model || m.id === model).map((m) => m.id);
}

/**
 * Пытается пересдать упавшую задачу. Ничего не помечает провалом и не
 * возвращает токены — это дело вызывающего, если пересдача не состоялась.
 */
export async function tryResubmit(
  ctx: FailureDeps,
  gen: GenerationRow,
  rec: TaskRecord,
  log: TaskLogger,
): Promise<ResubmitOutcome> {
  const generationId = gen.id;
  const params = readParams(gen.params, generationId, log);

  if ((params.retries ?? 0) >= MAX_ASYNC_RETRIES) {
    log.info({ generationId, retries: params.retries }, 'лимит пересдач исчерпан');
    return 'not_eligible';
  }
  // Без taskId забирать нечего: строка уже без задачи, кто-то нас опередил.
  if (!gen.kieTaskId) return 'not_eligible';
  if (!params.task || !gen.finalPrompt) {
    log.warn({ generationId }, 'в строке нет task или final_prompt — пересдать нельзя');
    return 'not_eligible';
  }

  // Строки до этой правки картинок в params не имеют — там источник лежит
  // одним элементом в source_url. Пустой массив у новой строки — честное
  // «картинок не было», а не пропуск.
  const images = params.images ?? (gen.sourceUrl ? [gen.sourceUrl] : []);
  const req: ImageRequest = {
    prompt: gen.finalPrompt,
    quality: 'standard',
    ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
    ...(images.length ? { images } : {}),
  };
  const tried = params.tried ?? triedFromModelColumn(gen.model);

  let candidates: ImageModel[];
  try {
    candidates = planModels(params.task, req).filter((m) => !tried.includes(m.id));
  } catch (err) {
    if (err instanceof NoSuitableModelError) {
      log.warn({ generationId, err: err.message }, 'подходящей модели для пересдачи нет');
      return 'not_eligible';
    }
    throw err;
  }
  if (candidates.length === 0) {
    log.info({ generationId, tried }, 'цепочка исчерпана, пересдавать некому');
    return 'not_eligible';
  }

  // Атомарный захват по старому taskId: callback и воркер могут увидеть
  // один и тот же fail. Второй строку не найдёт и ничего не сделает.
  const claimed = await ctx.generations.claimRetry(generationId, gen.kieTaskId, {
    model: gen.model,
    taskId: rec.taskId || gen.kieTaskId,
    ...(rec.failCode ? { failCode: rec.failCode } : {}),
    ...(rec.failMessage ? { failMessage: rec.failMessage } : {}),
  });
  if (!claimed) {
    log.info({ generationId, taskId: gen.kieTaskId }, 'сбой уже обработан другим путём, пропускаем');
    return 'claimed_elsewhere';
  }

  const outcome = await submitToChain(ctx, generationId, req, candidates, tried, log);
  if (!outcome.placed) {
    log.warn({ generationId, tried: outcome.tried, err: outcome.lastError },
      'ни одна запасная модель не приняла задачу');
    return 'exhausted';
  }
  log.warn({
    generationId,
    from: gen.model,
    to: outcome.placed.model.id,
    fail: rec.failMessage ?? rec.failCode,
  }, 'генерация пересдана другой модели');
  return 'resubmitted';
}

/**
 * Ветка «kie.ai вернул fail» целиком: сначала пересдача, и только если она
 * не состоялась — провал, возврат токенов и сообщение участнику.
 *
 * Пересдаём при ЛЮБОМ fail, а не только на таймауте: у следующей модели
 * другой провайдер и другая политика — то, что одна не нарисовала за
 * отведённое время или отказалась по контенту, другая часто делает.
 * Ложная пересдача стоит одну минуту ожидания; ложный отказ — обиженного
 * участника с «не получилось» на нормальную просьбу.
 */
export async function handleTaskFailure(
  ctx: FailureDeps,
  gen: GenerationRow,
  rec: TaskRecord,
  log: TaskLogger,
): Promise<'failed' | 'pending'> {
  const outcome = await tryResubmit(ctx, gen, rec, log);
  if (outcome === 'resubmitted' || outcome === 'claimed_elsewhere') return 'pending';

  // После claimRetry строка в статусе pending — markFailed это допускает
  // (IN_FLIGHT). Причина — исходная от kie.ai, а не отказ запасных моделей:
  // именно её увидит участник и админка.
  const changed = await ctx.generations.markFailed(gen.id, rec.failCode, rec.failMessage);
  if (changed) {
    log.warn({ generationId: gen.id, fail: rec.failMessage }, 'генерация не удалась');
    // Токены возвращаем: участник не виноват, что модель не справилась.
    if (gen.tokensCharged) {
      await ctx.tokens.grant(gen.userId, gen.tokensCharged, { reason: 'refund', generationId: gen.id });
    }
    void ctx.deliverGeneration?.(gen.id).catch((e: unknown) =>
      log.warn({ generationId: gen.id, err: String(e) }, 'сообщение о сбое не доставлено'));
  }
  return 'failed';
}
