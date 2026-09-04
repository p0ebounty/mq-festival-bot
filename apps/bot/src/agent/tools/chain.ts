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
    let taskId: string;
    try {
      taskId = await deps.kie.createTask(buildCreateTask(model, req, `${env.PUBLIC_URL}/hooks/kie`));
    } catch (err) {
      lastError = err instanceof KieError ? err.message : String(err);
      log.warn({ generationId, model: model.id, err: lastError },
        'модель не приняла задачу, пробуем следующую');
      continue;
    }
    // Запись taskId — вне try выше: ошибка БД здесь не «модель не приняла»,
    // и ставить вторую задачу у kie.ai на ту же генерацию нельзя.
    const ours = await deps.generations.markSubmitted(generationId, taskId, model.kieModel, tried);
    if (!ours) {
      // Строку успели закрыть, пока задача ставилась. Задача у kie.ai уже
      // создана и останется без хозяина — фиксируем taskId для разбора.
      log.warn({ generationId, model: model.id, taskId },
        'строка закрыта до записи задачи, задача у kie.ai осталась без хозяина');
      return { placed: null, tried, lastError: 'row_closed' };
    }
    return { placed: { model, taskId }, tried, lastError };
  }
  return { placed: null, tried, lastError };
}
