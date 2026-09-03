import type { FastifyBaseLogger } from 'fastify';
import { moderationLog } from '@mq/db/schema';
import type { AppContext } from '../context.js';
import { askClassifier, type ModerationVerdict } from './classifier.js';
import { checkStoplist } from './stoplist.js';

export { askClassifier, parseVerdict, type ModerationVerdict, type ModerationCategory } from './classifier.js';
export { checkStoplist } from './stoplist.js';

/**
 * Сколько ждём ответ проверки. Дольше — участник решит, что бот завис.
 *
 * ⚠️ Со зрением проверка идёт в РАЗЫ дольше, и общий срок на оба случая
 * был дефектом. Замеры 03.09 на живой модели, один и тот же запрос с
 * картинкой: 8.8 / 11.0 / 20.2 / 37.5 с — против ~5 с на чистом тексте.
 * Прежние общие 12 с обрывали проверку на середине, а fail-closed
 * превращает наш собственный таймаут в отказ участнику: он получал
 * «проверка сейчас недоступна» на совершенно нормальное фото.
 *
 * Ждать здесь безопаснее, чем отказать зря: участник в это время видит
 * живую заглушку, то есть бот для него думает, а не молчит.
 */
const TIMEOUT_TEXT_MS = 20_000;
const TIMEOUT_VISION_MS = 60_000;

/** Наш таймаут, а не отказ провайдера. Повторять его бессмысленно. */
class ModerationTimeout extends Error {}

/**
 * Пауза между попытками. Без неё повтор уходил в ту же секунду, что и
 * сбой: 03.09 kie.ai отдавал быстрый HTTP 500 «server is currently being
 * maintained», обе попытки укладывались в 4 секунды и участник получал
 * отказ на нормальное фото.
 */
const RETRY_PAUSE_MS = 700;
const ATTEMPTS = 3;

/** Кто принял решение. Отдельным полем — раньше это выяснялось сравнением русских фраз. */
export type ModerationSource = 'classifier' | 'stoplist' | 'unavailable';

export interface ModerationDecision extends ModerationVerdict {
  source: ModerationSource;
}

export interface ModerateInput {
  userId?: string | undefined;
  /** Где проверяем: присланное фото или запрос к генератору. */
  stage: 'photo' | 'prompt';
  text: string;
  imageUrls?: string[] | undefined;
  /**
   * Куда писать сбой проверки. Без него отказ выглядел в журнале как
   * решение классификатора: «фото отклонено проверкой» и ни слова о том,
   * что проверка вообще не ответила.
   */
  log?: Pick<FastifyBaseLogger, 'warn'> | undefined;
}

/**
 * Проверка перед тем, как что-то нарисовать или впустить в разговор (ADR 0014).
 *
 * Порядок именно такой: сначала классификатор — он понимает контекст и
 * отличает арену Колизея от крови крупным планом. Список слов включается
 * ТОЛЬКО когда классификатор не ответил: он слишком туп, чтобы решать
 * в обычном режиме, и зарезал бы половину исторических заданий.
 *
 * ⚠️ Не ответила и проверка, и список — всё равно ЗАПРЕТ. Пропускать в
 * обход нельзя даже временно: цена пропуска выше цены паузы. Риск
 * известен и принят — 27.08 kie.ai отдавал 500 на все модели, и в такой
 * день бот перестанет рисовать.
 */
export async function moderate(app: AppContext, input: ModerateInput): Promise<ModerationDecision> {
  const decision = await classify(app, input);
  if (!decision.allowed) await record(app, input, decision);
  return decision;
}

async function classify(app: AppContext, input: ModerateInput): Promise<ModerationDecision> {
  const budget = input.imageUrls?.length ? TIMEOUT_VISION_MS : TIMEOUT_TEXT_MS;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await pause(RETRY_PAUSE_MS * (attempt - 1));
    try {
      const provider = await app.moderationProvider();
      const verdict = await withTimeout(askClassifier(provider, {
        text: input.text,
        ...(input.imageUrls?.length ? { imageUrls: input.imageUrls } : {}),
      }), budget);
      return { ...verdict, source: 'classifier' };
    } catch (err) {
      // Молчать здесь нельзя: отказ по недоступности внешне не отличим от
      // решения классификатора, и причину потом не найти.
      input.log?.warn(
        { attempt, stage: input.stage, vision: Boolean(input.imageUrls?.length), err: String(err) },
        'проверка контента не ответила',
      );
      // Первая попытка могла упасть на сетевой икоте — пробуем ещё раз.
      // Но НЕ после таймаута: вторая попытка только удвоит ожидание
      // участника, а ответ придёт так же поздно.
      if (err instanceof ModerationTimeout) break;
    }
  }

  const hit = checkStoplist(input.text);
  return hit
    ? { allowed: false, category: hit, reason: 'такое я не рисую', source: 'stoplist' }
    : { allowed: false, category: null, reason: 'проверка сейчас недоступна', source: 'unavailable' };
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => { setTimeout(r, ms); });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ModerationTimeout(`moderation timeout ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Журнал отказов. Без него границу не откалибровать: понять, что режется
 * зря, можно только по фактическим отказам.
 */
async function record(app: AppContext, input: ModerateInput, v: ModerationDecision): Promise<void> {
  try {
    await app.db.insert(moderationLog).values({
      ...(input.userId ? { userId: input.userId } : {}),
      stage: input.stage,
      source: v.source,
      category: v.category,
      reason: v.reason,
      snippet: input.text.slice(0, 500),
    });
  } catch {
    // Журнал не должен ронять отказ: решение уже принято, а запись —
    // вспомогательная. Молча глотать нельзя только ошибки решения.
  }
}
