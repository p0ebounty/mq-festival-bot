import { InlineKeyboard, InputFile } from 'grammy';
import type { Bot } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import { makeShortId, renderQrPng, shareUrl } from '@mq/core';
import type { AppContext } from '../context.js';
import { env } from './../env.js';

/** Префикс callback_data. Всё вместе — 42 байта, лимит Telegram 64. */
const PREFIX = 'share:';

const LABEL = 'Скачать и поделиться';
/** Пока картинка рисуется — тот же текст со знаком запрета. */
const LABEL_PENDING = `🚫 ${LABEL}`;

/**
 * Кнопка под карточкой генерации.
 *
 * Она стоит там С САМОГО НАЧАЛА, ещё на заглушке «Рисую…», и просто
 * недоступна: со знаком запрета и без реакции на нажатие. Когда картинка
 * готова, знак пропадает и кнопка оживает.
 *
 * Так участник видит, что действие будет, и не гадает, куда делась кнопка.
 * В Telegram нет «выключенных» кнопок, поэтому недоступность изображается
 * подписью, а бездействие — пустым ответом на callback.
 */
export function shareButton(generationId: string, ready: boolean): InlineKeyboard {
  return new InlineKeyboard().text(ready ? LABEL : LABEL_PENDING, PREFIX + generationId);
}

/**
 * Нажатие на кнопку: присылаем QR-карточку.
 *
 * Раньше она уходила автоматически после каждой генерации — и засоряла чат
 * вторым сообщением на каждую картинку. Теперь только по просьбе.
 */
export function registerShareButton(app: AppContext, bot: Bot, log: FastifyBaseLogger): void {
  bot.callbackQuery(new RegExp(`^${PREFIX}(.+)$`), async (ctx) => {
    /**
     * Ответить Telegram обязаны всегда, иначе на кнопке крутятся часики.
     * Но и уронить обработчик этим нельзя: на вебхуке исключение превращается
     * в 500, и Telegram присылает апдейт заново.
     */
    const done = (text?: string) =>
      ctx.answerCallbackQuery(text ? { text } : undefined).catch(() => {});

    const generationId = ctx.match?.[1];
    if (!generationId) return done();

    const gen = await app.generations.byId(generationId).catch(() => undefined);

    // Ещё рисуется — молча ничего не делаем: кнопка помечена как недоступная,
    // и подсказка здесь только раздражала бы. Ответить всё равно обязаны,
    // иначе Telegram крутит на кнопке часики.
    if (!gen || gen.status !== 'success') return done();

    let link = await app.share.byGenerationId(generationId).catch(() => undefined);
    // Ссылку заводит callback от kie.ai, но если там не вышло — заведём тут,
    // а не будем разводить руками перед участником.
    link ??= await app.share.ensure(generationId, makeShortId).catch(() => undefined);
    if (!link) {
      log.warn({ generationId }, 'нажали «поделиться», а короткой ссылки нет');
      return done('Ссылка ещё не готова, попробуй через минуту');
    }

    const page = shareUrl(env.PUBLIC_URL, link.shortId);
    try {
      const [png, hashtags] = await Promise.all([
        renderQrPng(page),
        app.settings.get('share.hashtags'),
      ]);
      const tags = hashtags.trim();
      await ctx.replyWithPhoto(new InputFile(png, 'qr.png'), {
        caption: `Наведи камеру — откроется страница со скачиванием.\n${page}${tags ? `\n\n${tags}` : ''}`,
        disable_notification: true,
      });
      log.info({ generationId, shortId: link.shortId }, 'отправлена QR-карточка по кнопке');
      return done();
    } catch (err) {
      log.warn({ generationId, err: String(err).slice(0, 140) }, 'QR-карточку отправить не вышло');
      return done('Не получилось прислать код, попробуй ещё раз');
    }
  });
}
