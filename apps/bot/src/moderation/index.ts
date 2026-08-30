import { moderationLog } from '@mq/db/schema';
import type { AppContext } from '../context.js';
import { askClassifier, type ModerationVerdict } from './classifier.js';
import { checkStoplist } from './stoplist.js';

export { askClassifier, parseVerdict, type ModerationVerdict, type ModerationCategory } from './classifier.js';
export { checkStoplist } from './stoplist.js';

/** Сколько ждём ответ проверки. Дольше — участник решит, что бот завис. */
const TIMEOUT_MS = 12_000;

export interface ModerateInput {
  userId?: string | undefined;
  /** Где проверяем: присланное фото или запрос к генератору. */
  stage: 'photo' | 'prompt';
  text: string;
  imageUrls?: string[] | undefined;
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
export async function moderate(app: AppContext, input: ModerateInput): Promise<ModerationVerdict> {
  const verdict = await classify(app, input);
  if (!verdict.allowed) await record(app, input, verdict);
  return verdict;
}

async function classify(app: AppContext, input: ModerateInput): Promise<ModerationVerdict> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const provider = await app.moderationProvider();
      return await withTimeout(askClassifier(provider, {
        text: input.text,
        ...(input.imageUrls?.length ? { imageUrls: input.imageUrls } : {}),
      }));
    } catch {
      // Первая попытка могла упасть на сетевой икоте — пробуем ещё раз.
    }
  }

  const hit = checkStoplist(input.text);
  return hit
    ? { allowed: false, category: hit, reason: 'такое я не рисую' }
    : { allowed: false, category: null, reason: 'проверка сейчас недоступна' };
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('moderation timeout')), TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Журнал отказов. Без него границу не откалибровать: понять, что режется
 * зря, можно только по фактическим отказам.
 */
async function record(app: AppContext, input: ModerateInput, v: ModerationVerdict): Promise<void> {
  try {
    await app.db.insert(moderationLog).values({
      ...(input.userId ? { userId: input.userId } : {}),
      stage: input.stage,
      source: v.reason === 'проверка сейчас недоступна' ? 'unavailable'
        : v.reason === 'такое я не рисую' ? 'stoplist' : 'classifier',
      category: v.category,
      reason: v.reason,
      snippet: input.text.slice(0, 500),
    });
  } catch {
    // Журнал не должен ронять отказ: решение уже принято, а запись —
    // вспомогательная. Молча глотать нельзя только ошибки решения.
  }
}
