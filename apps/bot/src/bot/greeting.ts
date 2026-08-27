import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * Ответ на /start.
 *
 * Написан руками и уходит МГНОВЕННО, минуя агента, — и это единственное
 * место, где мы так делаем. Причины ровно две.
 *
 * Первая: это первое впечатление, и оно случается у каждого участника.
 * Раньше /start шёл через модель с подставным сообщением «расскажи, что тут
 * можно делать», и модель отвечала на вопрос — по делу, но без приветствия
 * («Тут можно делать три вещи…»). Живой случай на проде 27.08: человек
 * поздоровался с ботом, а бот с ним — нет.
 *
 * Вторая: девять секунд тишины на самом первом касании читаются как
 * «не работает», а в зале с очередью это ещё и девять секунд у стенда.
 *
 * Это не противоречит «бот — один диалог» (ADR 0003): приветствие не ветка
 * меню, а реплика. Она пишется в историю обычным сообщением, поэтому агент
 * дальше знает, что уже поздоровался и что именно пообещал.
 */
export interface Greeting {
  text: string;
  suggestions: string[];
  keyboardWasShown: boolean;
}

export async function startGreeting(
  app: AppContext,
  msg: {
    tgId: bigint;
    chatId: bigint;
    tgMessageId: bigint;
    from: {
      username?: string | undefined; firstName?: string | undefined;
      lastName?: string | undefined; languageCode?: string | undefined;
    };
  },
  log: FastifyBaseLogger,
): Promise<Greeting> {
  const startBalance = await app.settings.getInt('economy.startBalance');
  const user = await app.users.ensure({
    tgId: msg.tgId,
    username: msg.from.username ?? null,
    firstName: msg.from.firstName ?? null,
    lastName: msg.from.lastName ?? null,
    languageCode: msg.from.languageCode ?? null,
  }, startBalance);

  if (user.isBanned) {
    return { text: 'Доступ закрыт.', suggestions: [], keyboardWasShown: false };
  }

  const costPerImage = await app.settings.getInt('economy.costPerImage');
  const text = greetingText(user.firstName, { balance: user.tokenBalance, costPerImage });

  const conversation = await app.conversations.current(user.id, msg.chatId, 30);
  await app.conversations.addMessage({
    conversationId: conversation.id, role: 'user', text: '/start',
    tgMessageId: msg.tgMessageId,
  });
  await app.conversations.addMessage({
    conversationId: conversation.id, role: 'assistant', text,
  });
  await app.conversations.touch(conversation.id);

  const keyboardWasShown = user.keyboardShown;
  if (!keyboardWasShown) await app.keyboard.setShown(user.id, true);

  log.info({ userId: user.id, tgId: String(msg.tgId) }, 'приветствие на /start');

  return { text, suggestions: [...START_CHIPS], keyboardWasShown };
}

/**
 * Кнопки под приветствием. Обе ведут к живому действию: одна к своему фото,
 * вторая — к готовому миру. Третьей нет намеренно: три варианта на старте уже
 * читаются как меню, а бот у нас разговор.
 */
export const START_CHIPS = ['Хочу себя в профессии', 'Дай готовый мир'] as const;

export function greetingText(
  firstName: string | null | undefined,
  /** Баланс и цена. `null` — узнать не удалось (БД молчит): строку о токенах опускаем. */
  purseOf: { balance: number; costPerImage: number } | null,
): string {
  const name = firstName?.trim();
  const hello = name ? `Привет, ${name}!` : 'Привет!';

  // Считаем в картинках, а не в токенах: «10 токенов» участнику ничего не
  // говорит, «хватит на 10 картинок» — говорит всё.
  const shots = purseOf && purseOf.costPerImage > 0
    ? Math.floor(purseOf.balance / purseOf.costPerImage)
    : 0;
  const purse = !purseOf ? ''
    : shots > 0
      ? `У тебя ${purseOf.balance} ${plural(purseOf.balance, 'токен', 'токена', 'токенов')} — хватит на ${shots} ${plural(shots, 'картинку', 'картинки', 'картинок')}. `
      : 'Токенов на картинку сейчас не хватает, но за репост готовой работы дают ещё. ';

  return [
    `${hello} Я рисую картинки про будущее — вместе с тобой.`,
    '',
    'Умею три вещи:',
    '- показать **тебя в профессии будущего** — пришли своё фото;',
    '- выдать **готовый мир**, который меняется одной фразой: «сделай ночь», «добавь роботов»;',
    '- нарисовать **что угодно с нуля** — просто опиши словами.',
    '',
    `${purse}Пиши обычным текстом, я пойму: кнопки ниже — чтобы не набирать.`,
  ].join('\n');
}

/** Русские склонения после числа: 1 картинка, 2 картинки, 5 картинок. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = mod100 % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
