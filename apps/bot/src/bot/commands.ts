import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * Команды меню: /start, /help, /balance.
 *
 * Все три отвечают заготовленным текстом и НЕ ходят в модель. Это
 * единственное место в боте, где так, и вот почему.
 *
 * Ответ на них известен заранее. Гонять ради него агента — это девять
 * секунд ожидания, деньги за токены и риск, что модель ответит по-своему:
 * /start уходил ей подставным сообщением «расскажи, что тут можно делать»,
 * и она отвечала на вопрос, не здороваясь (живой случай на проде 27.08).
 * Человек поздоровался с ботом, а бот с ним нет.
 *
 * В зале с очередью это ещё и заметно: команду жмут в самом начале, и
 * тишина на первом касании читается как «сломался». Заготовка отвечает за
 * 40 мс.
 *
 * Это не противоречит «бот — один диалог» (ADR 0003): команды не ветки
 * меню, а реплики. Каждая **пишется в историю** обычным сообщением, поэтому
 * агент дальше знает, что уже сказано.
 */
export interface CommandReply {
  text: string;
  suggestions: string[];
  /** Нужен, чтобы запомнить, под каким сообщением остались кнопки. */
  userId: string;
}

/** Общая обвязка команды: найти участника, записать вопрос и ответ в историю. */
async function reply(
  app: AppContext,
  msg: CommandInput,
  log: FastifyBaseLogger,
  command: string,
  build: (user: { firstName: string | null; tokenBalance: number }) => Promise<{ text: string; suggestions?: readonly string[] }>,
): Promise<CommandReply> {
  const startBalance = await app.settings.getInt('economy.startBalance');
  const user = await app.users.ensure({
    tgId: msg.tgId,
    username: msg.from.username ?? null,
    firstName: msg.from.firstName ?? null,
    lastName: msg.from.lastName ?? null,
    languageCode: msg.from.languageCode ?? null,
  }, startBalance);

  if (user.isBanned) {
    return { text: 'Доступ закрыт.', suggestions: [], userId: user.id };
  }

  const built = await build(user);
  const suggestions = [...(built.suggestions ?? [])];

  const conversation = await app.conversations.current(user.id, msg.chatId, 30);
  await app.conversations.addMessage({
    conversationId: conversation.id, role: 'user', text: command,
    tgMessageId: msg.tgMessageId,
  });
  await app.conversations.addMessage({
    conversationId: conversation.id, role: 'assistant', text: built.text,
  });
  await app.conversations.touch(conversation.id);

  log.info({ userId: user.id, command }, 'команда отвечена заготовкой');
  return { text: built.text, suggestions, userId: user.id };
}

export interface CommandInput {
  tgId: bigint;
  chatId: bigint;
  tgMessageId: bigint;
  from: {
    username?: string | undefined; firstName?: string | undefined;
    lastName?: string | undefined; languageCode?: string | undefined;
  };
}

/** /start — приветствие. Первое касание, случается у каждого участника. */
export async function cmdStart(
  app: AppContext, msg: CommandInput, log: FastifyBaseLogger,
): Promise<CommandReply> {
  return reply(app, msg, log, '/start', async (user) => ({
    text: greetingText(user.firstName, {
      balance: user.tokenBalance,
      costPerImage: await app.settings.getInt('economy.costPerImage'),
    }),
    suggestions: START_CHIPS,
  }));
}

/** /help — «что тут можно делать». Кнопок не даёт: их даёт /start. */
export async function cmdHelp(
  app: AppContext, msg: CommandInput, log: FastifyBaseLogger,
): Promise<CommandReply> {
  return reply(app, msg, log, '/help', async () => ({
    text: helpText(
      await app.settings.getInt('economy.costPerImage'),
      await app.settings.getInt('economy.socialBonus'),
    ),
  }));
}

/** /balance — сколько осталось и как добрать. Цифры из базы, не из модели. */
export async function cmdBalance(
  app: AppContext, msg: CommandInput, log: FastifyBaseLogger,
): Promise<CommandReply> {
  return reply(app, msg, log, '/balance', async (user) => ({
    text: balanceText(
      user.tokenBalance,
      await app.settings.getInt('economy.costPerImage'),
      await app.settings.getInt('economy.socialBonus'),
    ),
  }));
}

/**
 * Кнопки под приветствием. Обе ведут к живому действию: одна к своему фото,
 * вторая — к заданию. Третьей нет намеренно: три варианта на старте уже
 * читаются как меню, а бот у нас разговор.
 *
 * До 05.09 вторая кнопка вела к свободному «миру» из пула. Утром фестиваля
 * заказчик сказал, что для него мир и есть картинка задания, а отдельного
 * пула свободных миров быть не должно. Миры в базе остались, но из бота
 * убраны: кнопка, тексты и инструмент выдачи (см. STATE.md, 05.09).
 */
export const START_CHIPS = ['Хочу себя в профессии', 'Дай задание'] as const;

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
    'Пришли своё фото — покажу тебя космонавтом, врачом, инженером, смотрителем маяка на Марсе.',
    '',
    'Или бери **задание**: дам готовую картинку и цель, что из неё получить, а ты меняешь её одной фразой — формулировку подбираешь сам.',
    '',
    `${purse}Пиши обычным текстом, я пойму — кнопки ниже просто чтобы не набирать.`,
  ].join('\n');
}

/**
 * /help — что тут можно делать.
 *
 * Отвечает на вопрос растерявшегося человека, а не рекламирует бота.
 * Поэтому здесь конкретные фразы, которые можно повторить дословно, — их
 * и повторяют.
 */
export function helpText(costPerImage: number, socialBonus: number): string {
  const price = `${costPerImage} ${plural(costPerImage, 'токен', 'токена', 'токенов')}`;
  const bonus = `${socialBonus} ${plural(socialBonus, 'токен', 'токена', 'токенов')}`;

  return [
    'Я рисую картинки про будущее.',
    '',
    'Пришли своё фото и скажи, кем хочешь себя увидеть: космонавтом, врачом, инженером, смотрителем маяка на Марсе.',
    '',
    'Или попроси **задание** — выдаю бесплатно: дам картинку и цель, что из неё нужно получить, а ты меняешь её одной фразой. Формулировку подбираешь сам.',
    '',
    'Ещё могу нарисовать что угодно с нуля по описанию и переделать любую картинку нашего разговора: перекрасить одежду, сменить фон, погоду и время суток, добавить или убрать предметы, перевести в акварель, комикс или пиксель-арт, дорисовать край кадра.',
    '',
    'Список открытый — это примеры, а не всё, что можно. Проси словами то, что придумал.',
    '',
    'Говори обычным языком — я не меню. Можно передумать, попросить переделать, вернуться к старой картинке или сменить тему.',
    '',
    `Картинка стоит ${price}. Опубликуешь готовую работу в соцсети и пришлёшь ссылку — добавлю ещё ${bonus}.`,
    '',
    'Сколько осталось — /balance.',
  ].join('\n');
}

/**
 * /balance — сколько осталось и как добрать.
 *
 * Числа берутся из базы, а не у модели: на вопрос «почему у меня столько»
 * нужен точный ответ, а не правдоподобный.
 */
export function balanceText(balance: number, costPerImage: number, socialBonus: number): string {
  const tokens = `${balance} ${plural(balance, 'токен', 'токена', 'токенов')}`;
  const price = `${costPerImage} ${plural(costPerImage, 'токен', 'токена', 'токенов')}`;
  const bonus = `${socialBonus} ${plural(socialBonus, 'токен', 'токена', 'токенов')}`;
  const shots = costPerImage > 0 ? Math.floor(balance / costPerImage) : 0;

  const head = shots > 0
    ? `У тебя **${tokens}** — это ещё ${shots} ${plural(shots, 'картинка', 'картинки', 'картинок')}.`
    : `Токены кончились: **${tokens}**.`;

  return [
    head,
    '',
    `Одна картинка — ${price}. Задание бесплатное, за него не списываю, и переделка после сбоя тоже возвращается.`,
    '',
    `Нужно ещё? Опубликуй любую свою работу в соцсети и пришли мне ссылку на пост — проверю сам и добавлю ${bonus}. Подойдёт любая соцсеть: Telegram, VK, Одноклассники, Дзен, YouTube, TikTok, X, Instagram.`,
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
