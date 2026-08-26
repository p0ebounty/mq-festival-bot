import type { FastifyBaseLogger } from 'fastify';
import { KieError } from '@mq/core';
import type { AppContext } from '../context.js';
import { applyTaskResult } from '../routes/kie-callback.js';

/**
 * Добор задач, по которым не пришёл callback.
 *
 * Callback — основной путь, но он может потеряться: сеть, рестарт, сбой у
 * kie.ai. Без этого воркера участник фестиваля просто никогда не получит
 * картинку и останется с списанными токенами. Поэтому опрос — не роскошь,
 * а обязательная страховка.
 */
export interface ReconcileOptions {
  /** Через сколько секунд после создания задача считается «подозрительной». */
  staleAfterSec?: number;
  intervalMs?: number;
  batchSize?: number;
}

export function startReconcileWorker(
  ctx: AppContext,
  log: FastifyBaseLogger,
  opts: ReconcileOptions = {},
): { stop: () => void } {
  // 90 секунд: самая медленная модель в замере укладывалась в ~84 с.
  const staleAfterSec = opts.staleAfterSec ?? 90;
  const intervalMs = opts.intervalMs ?? 30_000;
  const batchSize = opts.batchSize ?? 20;

  let stopped = false;
  let running = false;

  const tick = async () => {
    // Защита от наложения тиков: медленный проход не должен запускать второй.
    if (stopped || running) return;
    running = true;
    try {
      const stale = await ctx.generations.staleInFlight(staleAfterSec, batchSize);
      if (stale.length === 0) return;

      log.info({ count: stale.length }, 'добираем задачи без callback');
      for (const gen of stale) {
        if (stopped) break;
        if (!gen.kieTaskId) continue;
        try {
          const rec = await ctx.kie.getTask(gen.kieTaskId);
          const outcome = await applyTaskResult(ctx, gen.id, rec, log, gen);
          if (outcome !== 'pending') {
            log.info({ generationId: gen.id, outcome }, 'задача добрана опросом');
          }
        } catch (err) {
          if (err instanceof KieError && !err.retryable) {
            // Невосстановимо (404/422) — закрываем, иначе задача будет
            // висеть в опросе вечно.
            await ctx.generations.markFailed(gen.id, String(err.code), err.message);
            log.warn({ generationId: gen.id, code: err.code }, 'задача закрыта как безнадёжная');
          } else {
            log.warn({ generationId: gen.id, err: String(err) }, 'добор не удался, повторим позже');
          }
        }
      }
    } catch (err) {
      log.error({ err: String(err) }, 'воркер добора упал на проходе');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  // Воркер не должен удерживать процесс при завершении.
  timer.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
