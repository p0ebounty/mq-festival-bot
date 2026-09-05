import type { FastifyBaseLogger } from 'fastify';
import type { Bot } from 'grammy';
import type { AppContext } from '../context.js';
import { drawingCaption } from '../bot/phrases.js';

/**
 * Живая подпись на карточке «Рисую…» и статус «отправляет фото».
 *
 * Генерация идёт от одной до четырёх минут, и всё это время карточка была
 * неподвижной: участники 05.09 решали, что бот завис, и писали «не
 * работает». Теперь раз в CAPTION_EVERY_MS подпись карточки меняется
 * заготовленной фразой про процесс («Подбираю цвета…»), а в шапке чата
 * держится статус «отправляет фото».
 *
 * Состояние — в базе, а не в памяти: воркер каждые несколько секунд берёт
 * генерации в полёте с карточкой и считает шаг от created_at. Поэтому он
 * переживает рестарт бота и не требует таймера на каждую генерацию.
 * По готовности подпись снимается доставкой (deliver.ts подменяет медиа без
 * подписи), и строка уходит из выборки сама.
 */
export interface ProgressDeps {
  generations: Pick<AppContext['generations'], 'inFlightWithCard' | 'byId'>;
  api: Pick<Bot['api'], 'editMessageCaption' | 'sendChatAction'>;
  log: Pick<FastifyBaseLogger, 'warn' | 'debug'>;
}

export const CAPTION_EVERY_MS = 15_000;
/** Дольше этого карточку не трогаем: такая генерация уже почти наверняка закрыта добором. */
const MAX_AGE_SEC = 15 * 60;

/** Один проход. `lastStep` — какой шаг подписи уже стоит на карточке (память между проходами). */
export async function progressTick(
  deps: ProgressDeps,
  lastStep: Map<string, number>,
  now = Date.now(),
): Promise<void> {
  const rows = await deps.generations.inFlightWithCard(MAX_AGE_SEC, 50);
  const alive = new Set<string>();

  for (const gen of rows) {
    if (!gen.tgChatId || !gen.placeholderMessageId) continue;
    alive.add(gen.id);
    const chatId = Number(gen.tgChatId);
    const elapsedMs = now - gen.createdAt.getTime();

    // Статус живёт в Telegram около пяти секунд — шлём на каждом проходе.
    await deps.api.sendChatAction(chatId, 'upload_photo').catch(() => {});

    const step = Math.floor(elapsedMs / CAPTION_EVERY_MS);
    if (step < 1 || lastStep.get(gen.id) === step) continue;

    // Перед правкой подписи — свежий статус: между выборкой и правкой
    // картинка могла успеть подмениться, и подпись легла бы на готовую.
    const fresh = await deps.generations.byId(gen.id);
    if (!fresh || (fresh.status !== 'submitted' && fresh.status !== 'generating')) continue;

    try {
      await deps.api.editMessageCaption(chatId, Number(gen.placeholderMessageId), {
        caption: drawingCaption(Math.round(elapsedMs / 1000)),
      });
      lastStep.set(gen.id, step);
    } catch (err) {
      // «message is not modified» и удалённая карточка — не повод шуметь.
      deps.log.debug({ generationId: gen.id, err: String(err).slice(0, 120) }, 'подпись карточки не обновилась');
      lastStep.set(gen.id, step);
    }
  }

  for (const id of [...lastStep.keys()]) if (!alive.has(id)) lastStep.delete(id);
}

export function startProgressWorker(
  ctx: AppContext,
  bot: Bot,
  log: FastifyBaseLogger,
  opts: { intervalMs?: number } = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 5_000;
  const lastStep = new Map<string, number>();
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await progressTick({ generations: ctx.generations, api: bot.api, log }, lastStep);
    } catch (err) {
      log.warn({ err: String(err) }, 'воркер живой подписи упал на проходе');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return { stop() { stopped = true; clearInterval(timer); } };
}
