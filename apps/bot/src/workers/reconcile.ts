import type { FastifyBaseLogger } from 'fastify';
import { KieError } from '@mq/core';
import type { AppContext } from '../context.js';
import { applyTaskResult } from '../routes/kie-callback.js';
import { handleTaskFailure } from '../agent/tools/resubmit.js';

/**
 * Через сколько строка в полёте БЕЗ задачи у kie.ai считается осиротевшей.
 * Такая строка появляется, если процесс упал между созданием строки (или
 * захватом под пересдачу) и записью taskId. Постановка с повторами
 * укладывается в десятки секунд; десять минут — запас, а не оценка.
 */
const ORPHAN_AFTER_SEC = 10 * 60;

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
      await closeOrphans(ctx, log, batchSize);

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
            // Невосстановимо (404/422) — иначе задача висела бы в опросе
            // вечно. Идём тем же путём, что и fail от kie.ai: пересдача,
            // а если некому — провал с возвратом токена и сообщением
            // участнику. Раньше здесь был голый markFailed: токен не
            // возвращался, заглушка «Рисую…» оставалась висеть.
            const row = await ctx.generations.byId(gen.id);
            if (row) {
              const rec = {
                taskId: gen.kieTaskId, model: gen.model, state: 'fail' as const, resultUrls: [],
                failCode: String(err.code), failMessage: err.message,
              };
              const outcome = await handleTaskFailure(ctx, row, rec, gen.kieTaskId, log);
              log.warn({ generationId: gen.id, code: err.code, outcome }, 'задача у kie.ai безнадёжна');
            }
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

/**
 * Закрывает осиротевшие строки: в полёте, без задачи у kie.ai, старше
 * порога. Провал привязан к «задачи всё ещё нет» (`onlyIfTaskId: null`) —
 * если постановка всё-таки успела записать taskId, строка не наша.
 */
async function closeOrphans(ctx: AppContext, log: FastifyBaseLogger, limit: number): Promise<void> {
  const orphans = await ctx.generations.orphanedInFlight(ORPHAN_AFTER_SEC, limit);
  for (const gen of orphans) {
    const changed = await ctx.generations.markFailed(
      gen.id, 'orphaned', 'задача потеряна между постановкой и записью', { onlyIfTaskId: null },
    );
    if (!changed) continue;
    log.warn({ generationId: gen.id, createdAt: gen.createdAt }, 'осиротевшая генерация закрыта');
    if (gen.tokensCharged) {
      await ctx.tokens.grant(gen.userId, gen.tokensCharged, { reason: 'refund', generationId: gen.id });
    }
    void ctx.deliverGeneration?.(gen.id).catch((e: unknown) =>
      log.warn({ generationId: gen.id, err: String(e) }, 'сообщение о сбое не доставлено'));
  }
}
