import type { FastifyBaseLogger } from 'fastify';
import { inArray, lt } from 'drizzle-orm';
import { media } from '@mq/db/schema';
import type { AppContext } from '../context.js';

export interface HousekeepingOptions {
  intervalMs?: number;
  /** Порог, ниже которого кредиты kie.ai считаются тревожными. */
  lowCreditsThreshold?: number;
  /** Кому написать про кончающиеся кредиты. */
  alertChatId?: bigint | undefined;
}

/**
 * Фоновая уборка и присмотр за стендом.
 *
 * Два дела, которые нельзя делать по требованию:
 *
 *  1. **Удаление старых медиа.** Настройка «Хранить медиа, дней» была в
 *     админке с фазы 2 и ни на что не влияла — файлы копились вечно.
 *     Фото участников это персональные данные, держать их дольше
 *     обещанного нельзя.
 *  2. **Присмотр за кредитами kie.ai.** Кончившиеся кредиты посреди
 *     фестиваля выглядят как «бот сломался»: генерации начинают падать
 *     все разом. Предупреждение заранее стоит одного запроса в час.
 */
export function startHousekeepingWorker(
  ctx: AppContext,
  log: FastifyBaseLogger,
  opts: HousekeepingOptions = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 60 * 60_000;
  const threshold = opts.lowCreditsThreshold ?? 200;

  let stopped = false;
  let running = false;
  // Чтобы не написать про кредиты двадцать раз за смену.
  let creditsWarned = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await sweepMedia(ctx, log);
      creditsWarned = await watchCredits(ctx, log, threshold, creditsWarned, opts.alertChatId);
    } catch (err) {
      log.warn({ err: String(err).slice(0, 200) }, 'уборка не отработала');
    } finally {
      running = false;
    }
  };

  // Первый проход не сразу: на старте и так шумно.
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  const first = setTimeout(() => void tick(), 60_000);
  first.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(first);
    },
  };
}

/** Удаление медиа старше срока хранения — и с диска, и из БД. */
async function sweepMedia(ctx: AppContext, log: FastifyBaseLogger): Promise<void> {
  const days = await ctx.settings.getInt('media.retentionDays');
  if (!days || days <= 0) return;

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const stale = await ctx.db.select({ id: media.id, path: media.path })
    .from(media)
    .where(lt(media.createdAt, cutoff))
    .limit(200);
  if (stale.length === 0) return;

  // Сначала файлы, потом строки одним запросом. Порядок важен: упадём
  // посередине — останется строка без файла, её подчистит следующий
  // проход. Наоборот было бы хуже: файл потерялся бы без следа в БД.
  for (const row of stale) {
    await ctx.storage.delete(row.path).catch(() => {
      // Файла уже нет — не повод оставлять строку.
    });
  }
  await ctx.db.delete(media).where(inArray(media.id, stale.map((r) => r.id)));
  log.info({ removed: stale.length, days }, 'старые медиа удалены');
}

/**
 * Проверка остатка кредитов. Возвращает новое состояние «уже предупреждали»,
 * чтобы не долбить одним и тем же сообщением каждый час.
 */
async function watchCredits(
  ctx: AppContext,
  log: FastifyBaseLogger,
  threshold: number,
  warned: boolean,
  alertChatId: bigint | undefined,
): Promise<boolean> {
  const credits = await ctx.kie.getCredits().catch(() => null);
  if (credits === null) return warned;

  if (credits > threshold) {
    if (warned) log.info({ credits }, 'кредиты kie.ai пополнены');
    return false;
  }

  log.warn({ credits, threshold }, 'кредиты kie.ai на исходе');
  if (!warned && alertChatId !== undefined) {
    await ctx.sendAlert?.(
      alertChatId,
      `⚠️ Кредиты kie.ai на исходе: осталось ${credits}. ` +
      'Когда закончатся, генерации начнут падать у всех сразу.',
    ).catch(() => {});
  }
  return true;
}
