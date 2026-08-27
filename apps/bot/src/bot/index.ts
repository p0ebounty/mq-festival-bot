import { Bot, Keyboard, type Context } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import { UserGate } from '@mq/core';
import type { AppContext } from '../context.js';
import { env } from '../env.js';
import { handleIncoming } from '../agent/runner.js';
import { phrases, unsupportedReply, stillThinking } from './phrases.js';
import { prepareMessage } from './format.js';
import { ingestPhoto } from './media.js';
import { cmdStart, cmdHelp, cmdBalance, greetingText, START_CHIPS, type CommandInput, type CommandReply } from './commands.js';

/**
 * Что уходит агенту вместо подписи, когда фото прислали молча.
 *
 * Экспортируется, чтобы регрессия гоняла ровно эту строку, а не её копию:
 * поведение бота на фото целиком зависит от формулировки, и разъехавшийся
 * дубль в тесте проверял бы не то, что работает на проде.
 */
export const PHOTO_WITHOUT_CAPTION =
  '[Участник прислал фото без подписи. Если из разговора выше уже ясно, ' +
  'чего он хочет от снимка, — делай это сразу, переспрашивать не надо. ' +
  'Если не ясно — посмотри, что на снимке, и спроси одной фразой. ' +
  'Своих идей не придумывай.]';

/**
 * Бот — ОДИН диалог, а не меню (ADR 0003).
 * Здесь нет обработчиков команд-веток и нет клавиатур: любое сообщение
 * уходит агенту, он сам решает, что делать.
 */
export function createBot(app: AppContext, log: FastifyBaseLogger): { bot: Bot; gate: UserGate } {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  const gate = new UserGate();


  // Раз в 10 минут подчищаем счётчики, чтобы карта не росла всю смену.
  const sweeper = setInterval(() => gate.sweep(), 10 * 60_000);
  sweeper.unref?.();

  /**
   * Команды меню отвечают СРАЗУ и без модели — см. `commands.ts`, там же почему.
   * Если БД недоступна, на /start всё равно здороваемся: молчание на первом
   * касании хуже, чем приветствие без имени и баланса.
   */
  const command = (name: string, run: (i: CommandInput) => Promise<CommandReply>) => {
    bot.command(name, async (c) => {
      const from = c.from;
      if (!from) return;
      try {
        const r = await run({
          tgId: BigInt(from.id),
          chatId: BigInt(c.chat.id),
          tgMessageId: BigInt(c.msg.message_id),
          from: {
            username: from.username, firstName: from.first_name,
            lastName: from.last_name, languageCode: from.language_code,
          },
        });
        await send(c, r.text, undefined, r.suggestions, r.keyboardWasShown);
      } catch (err) {
        log.error({ err: String(err), tgId: from.id, command: name }, 'команда не собралась');
        await send(c, greetingText(from.first_name, null), undefined, [...START_CHIPS], false);
      }
    });
  };

  command('start', (i) => cmdStart(app, i, log));
  command('help', (i) => cmdHelp(app, i, log));
  command('balance', (i) => cmdBalance(app, i, log));

  bot.on('message:text', async (c) => {
    await accept(c, c.msg.text);
  });

  bot.on('message:photo', async (c) => {
    // Без подписи намерение может быть уже названо РАНЬШЕ: «хочу космонавтом»
    // → «пришли фото» → фото. Первая версия этой пометки была категоричной
    // («участник НЕ сказал, что делать, спроси»), и агент переспрашивал даже
    // там, где сам минуту назад попросил снимок, — живой случай на проде
    // 27.08. Просить фото и тут же не помнить зачем — худшее, что бот может
    // сделать с человеком, который всё сделал правильно.
    //
    // Пометка осталась ради обратного случая (молча прислал фото — не
    // выдумывай ему профессию), но теперь она указывает на разговор, а не
    // запрещает действовать.
    await accept(c, c.msg.caption?.trim() || PHOTO_WITHOUT_CAPTION, { photo: true });
  });

  /**
   * Всё остальное, включая голосовые. Без этого обработчика бот на видео или
   * стикер просто молчал бы, и участник решил бы, что он сломался.
   *
   * Голосовые сюда попадают намеренно: речь понимал только Gemini, и то через
   * недокументированный трюк с блоком image_url. У моделей OpenAI, на которых
   * мы работаем, этот путь отвечает HTTP 400 — участник получал «не получилось
   * обдумать ответ» вместо ответа. Поддержку убрали, см. ADR 0009.
   */
  bot.on('message', async (c) => {
    const m = c.msg;
    const kind =
      m.voice ? 'voice' : m.video_note ? 'video_note'
      : m.video ? 'video' : m.document ? 'document' : m.sticker ? 'sticker'
      : m.audio ? 'audio' : m.animation ? 'animation' : m.location ? 'location'
      : m.contact ? 'contact' : m.poll ? 'poll' : 'other';
    log.info({ tgId: c.from?.id, kind }, 'неподдерживаемый тип сообщения');
    await c.reply(unsupportedReply(kind), { reply_markup: { remove_keyboard: true } }).catch(() => {});
  });

  bot.catch((err) => {
    log.error({ err: String(err.error), update: err.ctx.update.update_id }, 'ошибка в обработчике бота');
  });

  // Общий Context, а не сужённый под message:text — обработчиков несколько
  // (текст, фото, голос, всё остальное), и все зовут одни и те же функции.
  type Ctx = Context;

  /**
   * Приём сообщения: сначала место в очереди, потом работа.
   *
   * Сообщения одного участника выполняются ПО ОЧЕРЕДИ, а не отбрасываются:
   * человек часто дописывает мысль вторым сообщением, и потерять его хуже,
   * чем ответить на секунду позже.
   */
  async function accept(c: Ctx, text: string, media: { photo?: boolean } = {}): Promise<void> {
    const from = c.from;
    if (!from) return;
    const key = String(from.id);
    const perHour = await app.settings.getInt('limits.perHour');

    const placement = gate.submit(key, () => work(c, text, media), {
      messagesPerWindow: perHour,
    });

    if (placement.status === 'rejected') {
      const msg =
        placement.reason === 'rate' ? phrases.rateLimited()
        : placement.reason === 'overloaded' ? phrases.overloaded()
        : phrases.queueFull();
      log.info({ tgId: from.id, reason: placement.reason }, 'сообщение отклонено заслоном');
      await c.reply(msg, { reply_markup: { remove_keyboard: true } }).catch(() => {});
      return;
    }

    if (placement.status === 'queued') {
      // Честно говорим, что приняли и вернёмся — но работать будем по порядку.
      await c.reply(phrases.queued(placement.ahead), { reply_markup: { remove_keyboard: true } }).catch(() => {});
    }
  }

  /** Одна единица работы: заглушка → агент → замена заглушки ответом. */
  async function work(c: Ctx, text: string, media: { photo?: boolean }): Promise<void> {
    const from = c.from!;

    const imageUrls: string[] = [];

    if (media.photo) {
      try {
        imageUrls.push(await ingestPhoto(app, c.api, c.msg?.photo ?? [], log));
      } catch (err) {
        log.warn({ err: String(err) }, 'не удалось забрать фото участника');
        await c.reply('Фото не получилось загрузить. Пришли ещё раз, пожалуйста.',
          { reply_markup: { remove_keyboard: true } }).catch(() => {});
        return;
      }
    }

    // Сразу отдаём короткую живую реплику: участник видит, что бот думает,
    // а не молчит. Потом ЭТО ЖЕ сообщение заменяем настоящим ответом —
    // в чате не остаётся мусора вроде «Думаю…».
    let placeholderId: number | undefined;
    try {
      // ⚠️ БЕЗ reply_markup. Проверено запросами к API: сообщение,
      // отправленное с remove_keyboard, Telegram делает НЕРЕДАКТИРУЕМЫМ —
      // editMessageText отвечает «message can't be edited». Прошлая версия
      // цепляла снятие сюда, и ответ участнику не уходил вообще.
      const sent = await c.reply(phrases.thinking());
      placeholderId = sent.message_id;
    } catch {
      // Не смогли — не беда, просто ответим обычным сообщением.
    }

    // Telegram гасит индикатор «печатает» через ~5 секунд, а ответ идёт
    // дольше (модель 6–11 с, плюс инструменты). Держим его повтором,
    // иначе участник видит тишину и думает, что бот отвалился.
    const stopTyping = keepTyping(c);
    // Если ответ затянулся, обновляем заглушку: полторы минуты немой
    // «печатает» читаются как поломка, даже когда всё в порядке.
    const stopProgress = placeholderId === undefined
      ? () => {}
      : keepProgress(c, placeholderId);

    let reply;
    try {
      reply = await handleIncoming(app, {
        tgId: BigInt(from.id),
        chatId: BigInt(c.chat!.id),
        tgMessageId: BigInt(c.msg?.message_id ?? 0),
        text,
        ...(imageUrls.length ? { imageUrls } : {}),
        from: {
          username: from.username,
          firstName: from.first_name,
          lastName: from.last_name,
          languageCode: from.language_code,
        },
      }, log);
    } finally {
      stopTyping();
      stopProgress();
    }

    const body = reply.text.trim();
    if (!body) {
      if (placeholderId) await c.api.deleteMessage(c.chat!.id, placeholderId).catch(() => {});
      return;
    }

    // Если ушла карточка «Рисую…», свой текст отправляем НОВЫМ сообщением:
    // заглушка была отправлена раньше карточки, и правка легла бы НАД ней.
    // Участнику логичнее видеть сначала картинку-место, потом пояснение.
    await send(c, body, reply.cardSent ? undefined : placeholderId,
      reply.suggestions, reply.keyboardWasShown, reply.cardSent ? placeholderId : undefined);
  }

  /**
   * Отправка с форматированием. Если Telegram отверг HTML — шлём простым
   * текстом: потерять оформление не страшно, потерять сообщение страшно.
   */
  async function send(
    c: Ctx, raw: string, editId: number | undefined,
    suggestions?: string[], keyboardWasShown = false,
    dropMessageId?: number,
  ): Promise<void> {
    // Заглушка больше не нужна: текст пойдёт новым сообщением под карточкой.
    if (dropMessageId !== undefined) {
      await c.api.deleteMessage(c.chat!.id, dropMessageId).catch(() => {});
    }
    const { html, plain, useHtml } = prepareMessage(raw);

    const attempts: Array<{ text: string; html: boolean }> = useHtml
      ? [{ text: html, html: true }, { text: plain, html: false }]
      : [{ text: plain, html: false }];

    const chatId = c.chat!.id;
    const withKeyboard = Boolean(suggestions?.length);

    // Клавиатуру можно задать только при ОТПРАВКЕ — к правке не цепляется.
    // Значит новым сообщением отвечаем в двух случаях: ставим кнопки или
    // снимаем висящие. В остальном правим заглушку, как и раньше.
    const markup = withKeyboard
      ? suggestions!.reduce((k, s) => k.text(s).row(), new Keyboard())
          .oneTime().resized().placeholder('Или напиши своими словами…')
      : keyboardWasShown
        ? { remove_keyboard: true as const }
        : undefined;

    if (markup && editId !== undefined) {
      await c.api.deleteMessage(chatId, editId).catch(() => {});
      editId = undefined;
    }

    for (const attempt of attempts) {
      // Сначала правка (если можно), потом — обязательно отправка новым.
      // Без второго шага участник при сбое правки не получал НИЧЕГО:
      // живой случай 27.08, обе попытки упёрлись в «message can't be edited».
      const ways: Array<() => Promise<unknown>> = [];
      const parse = attempt.html ? { parse_mode: 'HTML' as const } : {};
      if (editId !== undefined) {
        ways.push(() => c.api.editMessageText(chatId, editId!, attempt.text, parse));
      }
      ways.push(async () => {
        if (editId !== undefined) await c.api.deleteMessage(chatId, editId).catch(() => {});
        return c.reply(attempt.text, { ...parse, ...(markup ? { reply_markup: markup } : {}) });
      });

      for (const way of ways) {
        try {
          await way();
          return;
        } catch (err) {
          log.warn({ html: attempt.html, err: String(err).slice(0, 140) },
            'отправка не прошла, пробуем следующий способ');
        }
      }
    }
    log.error({ chatId: c.chat?.id }, 'не удалось отправить ответ ни одним способом');
  }

  return { bot, gate };
}

/**
 * Держит индикатор «печатает» живым до конца ответа.
 * Telegram гасит его через ~5 секунд, поэтому шлём заново каждые 4.
 * Возвращает функцию остановки — вызывать обязательно, даже при ошибке.
 */
/**
 * Обновляет сообщение-заглушку, пока идёт долгий ответ.
 * Первое обновление — через 25 секунд: раньше не нужно, обычный ответ
 * укладывается в 3–18 секунд и заглушка просто сменится настоящим текстом.
 */
function keepProgress(c: Context, messageId: number): () => void {
  const chatId = c.chat?.id;
  if (chatId === undefined) return () => {};
  let step = 0;
  const timer = setInterval(() => {
    void c.api.editMessageText(chatId, messageId, stillThinking(step++)).catch(() => {});
  }, 25_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

function keepTyping(c: { replyWithChatAction: (a: 'typing') => Promise<unknown> }): () => void {
  const ping = () => void c.replyWithChatAction('typing').catch(() => {});
  ping();
  const timer = setInterval(ping, 4000);
  timer.unref?.();
  return () => clearInterval(timer);
}
