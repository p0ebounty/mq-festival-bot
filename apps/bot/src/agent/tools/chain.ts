import { buildCreateTask, KieError, type ImageModel, type ImageRequest } from '@mq/core';
import type { AppContext } from '../../context.js';
import { env } from '../../env.js';

/** Минимум логгера, общий для инструментов (`ToolContext.log`) и маршрутов (pino). */
export type TaskLogger = {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
};

export interface ChainDeps {
  kie: Pick<AppContext['kie'], 'createTask'>;
  generations: Pick<AppContext['generations'], 'markSubmitted'>;
}

export interface ChainPlacement {
  model: ImageModel;
  taskId: string;
}

export interface ChainOutcome {
  /** Модель, принявшая задачу, и её taskId; null — не приняла ни одна. */
  placed: ChainPlacement | null;
  /** Кому задача уже предлагалась, включая отказавших синхронно. */
  tried: string[];
  /** Текст последней ошибки — для markFailed, когда не принял никто. */
  lastError: string;
}

/**
 * Предлагает задачу моделям по очереди, пока одна не примет (ADR 0006).
 *
 * Одна функция на первую постановку и на пересдачу после асинхронного
 * сбоя: цикл «createTask → markSubmitted → при отказе следующая» у них
 * общий, различается только происходящее вокруг — карточку «Рисую…» шлёт
 * первая постановка, пересдача её не трогает.
 *
 * `tried` копится и при синхронном отказе: модель, не принявшая задачу
 * сейчас, не должна стать кандидатом на пересдачу через минуту.
 */
export async function submitToChain(
  deps: ChainDeps,
  generationId: string,
  req: ImageRequest,
  candidates: readonly ImageModel[],
  alreadyTried: readonly string[],
  log: TaskLogger,
): Promise<ChainOutcome> {
  const tried = [...alreadyTried];
  let lastError = '';
  for (const model of candidates) {
    tried.push(model.id);
    try {
      const payload = buildCreateTask(model, req, `${env.PUBLIC_URL}/hooks/kie`);
      const taskId = await deps.kie.createTask(payload);
      await deps.generations.markSubmitted(generationId, taskId, model.kieModel, tried);
      return { placed: { model, taskId }, tried, lastError };
    } catch (err) {
      lastError = err instanceof KieError ? err.message : String(err);
      log.warn({ generationId, model: model.id, err: lastError },
        'модель не приняла задачу, пробуем следующую');
    }
  }
  return { placed: null, tried, lastError };
}
