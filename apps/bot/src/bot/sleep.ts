import type { Context, MiddlewareFn } from 'grammy';
import type { Update } from 'grammy/types';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { SHARE_PREFIX } from './share-button.js';

/**
 * Режим «спит»: фестиваль закончился.
 *
 * Настройка `bot.mode = asleep` (админка → Провайдер → «Режим бота»)
 * ставит заслон ПЕРЕД всеми обработчиками: ни модель, ни генератор, ни
 * команды не вызываются, участник получает заготовку. Что сделано и что
 * осталось живым:
 *
 * - любое сообщение (текст, фото, стикер, команда) → одна заготовка;
 * - кнопки-подсказки → короткая всплывашка, без сообщения в чат;
 * - кнопка «Скачать и поделиться» под готовой картинкой → РАБОТАЕТ:
 *   участник вправе забрать свою работу и после фестиваля, а страницы
 *   `/g/<shortId>` и QR-коды живут независимо от режима;
 * - доставка уже начатых генераций и воркеры не трогаются: то, что
 *   рисовалось в момент выключения, дойдёт.
 *
 * Полная заготовка уходит не чаще раза в N минут на чат: человек, который
 * пишет подряд, и так уже её видел, и десять одинаковых абзацев читались
 * бы как заевшая пластинка. На повторы — одна короткая строка.
 */

export const ASLEEP_TEXT = [
  'Фестиваль закончился, и я уснул 😴',
  '',
  'Спасибо, что рисовал со мной будущее! Всё, что мы нарисовали, никуда не делось: ' +
  'ссылки и QR-коды работают, кнопка «Скачать и поделиться» под картинками — тоже.',
  '',
  'Новых картинок пока не рисую. Увидимся на следующем фестивале!',
].join('\n');

/** На повторные сообщения в течение `REPEAT_WINDOW_MS`. */
export const ASLEEP_SHORT = 'Сплю 😴 Фестиваль закончился, а картинки и ссылки на них работают.';

/** Всплывашка на нажатие кнопки-подсказки. Лимит Telegram — 200 знаков. */
export const ASLEEP_TAP = 'Фестиваль закончился, я сплю 😴';

export const REPEAT_WINDOW_MS = 10 * 60_000;

export type SleepAction = 'pass' | 'reply' | 'toast' | 'ignore';

/**
 * Что делать со спящим ботом на этот апдейт. Чистая функция — ради теста:
 * заслон обязан пропускать кнопку «поделиться» и глушить всё остальное.
 */
export function asleepAction(update: Update): SleepAction {
  if (update.callback_query) {
    const data = update.callback_query.data ?? '';
    return data.startsWith(SHARE_PREFIX) ? 'pass' : 'toast';
  }
  if (update.message) return 'reply';
  // Правки сообщений, inline-запросы, смена статуса чата и прочее — молча.
  return 'ignore';
}

/** Полная заготовка или короткая — по тому, когда этому чату отвечали в прошлый раз. */
export function pickAsleepText(
  lastRepliedAt: number | undefined, now: number, windowMs = REPEAT_WINDOW_MS,
): string {
  return lastRepliedAt !== undefined && now - lastRepliedAt < windowMs ? ASLEEP_SHORT : ASLEEP_TEXT;
}

export function sleepGate(app: AppContext, log: FastifyBaseLogger): MiddlewareFn<Context> {
  const repliedAt = new Map<number, number>();
  const sweeper = setInterval(() => {
    const edge = Date.now() - REPEAT_WINDOW_MS;
    for (const [chat, at] of repliedAt) if (at < edge) repliedAt.delete(chat);
  }, REPEAT_WINDOW_MS);
  sweeper.unref?.();

  return async (c, next) => {
    // Настройка читается на каждый апдейт, но за ней стоит кэш с TTL 10 с:
    // переключение из админки подхватывается без рестарта.
    let mode: string;
    try {
      mode = await app.settings.get('bot.mode');
    } catch (err) {
      // База молчит — ведём себя как обычно: дальше по цепочке решат, что
      // отвечать. Усыплять бота из-за сбоя чтения настройки нельзя.
      log.warn({ err: String(err).slice(0, 140) }, 'не прочитал bot.mode, считаю бота бодрствующим');
      return next();
    }
    if (mode !== 'asleep') return next();

    const action = asleepAction(c.update);
    if (action === 'pass') return next();

    log.info({ tgId: c.from?.id, action, update: c.update.update_id }, 'бот спит: апдейт заглушён');

    if (action === 'toast') {
      await c.answerCallbackQuery({ text: ASLEEP_TAP }).catch(() => {});
      return;
    }
    if (action === 'reply') {
      const chatId = c.chat?.id;
      if (chatId === undefined) return;
      const now = Date.now();
      const text = pickAsleepText(repliedAt.get(chatId), now);
      repliedAt.set(chatId, now);
      await c.reply(text).catch((err: unknown) => {
        log.warn({ chatId, err: String(err).slice(0, 140) }, 'не отправил заготовку спящего бота');
      });
    }
  };
}
