import { InlineKeyboard, InputFile, InputMediaBuilder } from 'grammy';
import type { Bot } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import { renderQrPng, shareUrl } from '@mq/core';
import type { AppContext } from '../context.js';
import { env } from '../env.js';

/**
 * Досылка готовой картинки участнику.
 *
 * Вызывается из обработчика callback от kie.ai, а не из цикла агента:
 * генерация идёт 40–80 секунд, столько держать диалог нельзя.
 * Поэтому агент говорит «делаю», а картинка приходит сюда.
 */
export function makeDeliverer(app: AppContext, bot: Bot, log: FastifyBaseLogger) {
  return async function deliverGeneration(generationId: string): Promise<void> {
    const gen = await app.generations.byId(generationId);
    if (!gen) return;

    if (!gen.tgChatId) {
      log.warn({ generationId }, 'некуда доставлять: у генерации нет chat id');
      return;
    }

    const chatId = Number(gen.tgChatId);
    const cardId = gen.placeholderMessageId ? Number(gen.placeholderMessageId) : undefined;

    if (gen.status === 'failed' || gen.status === 'refunded') {
      // Карточку «Рисую…» убираем: висящая заглушка при неудаче выглядит так,
      // будто работа всё ещё идёт.
      if (cardId !== undefined) {
        await bot.api.deleteMessage(chatId, cardId).catch(() => {});
      }
      await bot.api.sendMessage(chatId, failureText(gen.failMessage))
        .catch((e: unknown) => log.warn({ generationId, err: String(e) }, 'не смог отправить сообщение о сбое'));
      return;
    }

    if (gen.status !== 'success' || !gen.outputMediaId) return;

    const media = await app.media.byId(gen.outputMediaId);
    if (!media) {
      log.warn({ generationId }, 'генерация успешна, но записи медиа нет');
      return;
    }

    // Подпись пишет агент при постановке задачи — она про идею участника,
    // а не казённое «Готово!». Если агент её не дал, обходимся без подписи:
    // пустая лучше безликой.
    const caption = gen.caption?.trim();

    let buf: Buffer;
    try {
      buf = await app.storage.read(media.path);
    } catch (err) {
      log.error({ generationId, err: String(err) }, 'файл результата не читается');
      return;
    }

    // Короткая ссылка на публичную страницу — цель QR-кода из ТЗ.
    // Её могло не быть, если создание упало: тогда просто отдаём картинку.
    const link = await shortLinkFor(app, generationId, log);
    const page = link ? shareUrl(env.PUBLIC_URL, link) : null;
    const markup = page
      ? new InlineKeyboard().url('Скачать и поделиться', page)
      : undefined;

    // Основной путь: подменяем картинку ВНУТРИ карточки «Рисую…».
    // Участник видит превращение прямо там, где ждал, без второго сообщения.
    let delivered = false;
    if (cardId !== undefined) {
      try {
        await bot.api.editMessageMedia(chatId, cardId,
          InputMediaBuilder.photo(new InputFile(buf, 'mqbot.jpg'), caption ? { caption } : {}),
          markup ? { reply_markup: markup } : {});
        log.info({ generationId, bytes: media.bytes }, 'картинка подменена в карточке');
        delivered = true;
      } catch (err) {
        // Карточку могли удалить, или сообщение слишком старое.
        log.warn({ generationId, err: String(err).slice(0, 140) },
          'подменить картинку в карточке не вышло, шлём отдельным сообщением');
        await bot.api.deleteMessage(chatId, cardId).catch(() => {});
      }
    }

    // Запасной путь: обычная отправка. Шлём файлом, а не ссылкой — Telegram
    // кэширует и показывает мгновенно, и картинка не зависит от нашего домена.
    if (!delivered) {
      try {
        await bot.api.sendPhoto(chatId, new InputFile(buf, 'mqbot.jpg'), {
          ...(caption ? { caption } : {}),
          ...(markup ? { reply_markup: markup } : {}),
        });
        log.info({ generationId, bytes: media.bytes }, 'картинка доставлена отдельным сообщением');
        delivered = true;
      } catch (err) {
        log.error({ generationId, err: String(err) }, 'не удалось доставить картинку');
      }
    }

    if (delivered && page) await sendQrCard(app, bot, chatId, page, log);
  };
}

/** Короткий id генерации, если он есть. */
async function shortLinkFor(
  app: AppContext, generationId: string, log: FastifyBaseLogger,
): Promise<string | undefined> {
  try {
    const row = await app.share.byGenerationId(generationId);
    return row?.shortId;
  } catch (err) {
    log.warn({ generationId, err: String(err) }, 'короткая ссылка не найдена');
    return undefined;
  }
}

/**
 * QR отдельным сообщением.
 *
 * ТЗ требует QR каждому участнику. В Telegram картинка и так под рукой,
 * поэтому ценность кода — показать его с экрана другу и забрать готовые
 * хештеги. Второе сообщение на каждую генерацию засоряет чат, поэтому
 * поведение выключается настройкой `share.sendQr` без выката.
 */
async function sendQrCard(
  app: AppContext, bot: Bot, chatId: number, page: string, log: FastifyBaseLogger,
): Promise<void> {
  if (await app.settings.get('share.sendQr') === 'off') return;
  try {
    const [png, hashtags] = await Promise.all([
      renderQrPng(page),
      app.settings.get('share.hashtags'),
    ]);
    const tags = hashtags.trim();
    await bot.api.sendPhoto(chatId, new InputFile(png, 'qr.png'), {
      caption: `Наведи камеру — откроется страница со скачиванием.\n${page}${tags ? `\n\n${tags}` : ''}`,
      disable_notification: true,
    });
  } catch (err) {
    // Не доставили QR — не беда: картинка у участника уже есть, а ссылка
    // осталась кнопкой под ней.
    log.warn({ err: String(err).slice(0, 140) }, 'QR-карточку отправить не вышло');
  }
}

/**
 * Текст про неудачу. Отдельно разбираем отказ по контенту: участнику важно
 * понять, что дело в его запросе, а не в поломке бота, — иначе он будет
 * повторять то же самое и тратить токены.
 */
function failureText(failMessage: string | null): string {
  const policy = /policy|prohibited|filtered|violat/i.test(failMessage ?? '');
  return policy
    ? 'Эту картинку модель рисовать отказалась — так бывает с известными персонажами ' +
      'и защищённой авторским правом натурой. Токены вернул. Давай придумаем что-нибудь своё?'
    : 'Не получилось нарисовать — картинка не вышла. Токены вернул, попробуй сформулировать чуть иначе.';
}
