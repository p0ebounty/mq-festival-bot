import { InputFile, InputMediaBuilder } from 'grammy';
import type { Bot } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { shareButton } from './share-button.js';

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
      const text = failureText(gen.failMessage);
      await bot.api.sendMessage(chatId, text)
        .catch((e: unknown) => log.warn({ generationId, err: String(e) }, 'не смог отправить сообщение о сбое'));
      // Сообщение о сбое попадает и в историю диалога. Иначе следующее
      // «ещё раз» участника приходит модели без знания, что картинки не
      // было: в её истории последняя реплика — собственное «Добавил», и
      // правило «не вызывай инструмент снова» блокирует переделку.
      if (gen.conversationId) {
        await app.conversations.addMessage({ conversationId: gen.conversationId, role: 'assistant', text })
          .catch((e: unknown) => log.warn({ generationId, err: String(e) }, 'сообщение о сбое не записалось в историю'));
      }
      return;
    }

    if (gen.status !== 'success' || !gen.outputMediaId) return;

    const media = await app.media.byId(gen.outputMediaId);
    if (!media) {
      log.warn({ generationId }, 'генерация успешна, но записи медиа нет');
      return;
    }

    // Подпись пишет агент при постановке задачи — она про идею участника,
    // а не казённое «Готово!». Когда картинка подменяется в карточке,
    // подпись уходит ОТДЕЛЬНЫМ сообщением ответом на карточку: подмена на
    // месте не двигает чат и не даёт уведомления, и участники не замечали,
    // что готово (05.09). Новое сообщение с цитатой карточки — замечают.
    const caption = gen.caption?.trim();
    const doneText = caption || 'Готово! Картинка выше.';

    let buf: Buffer;
    try {
      buf = await app.storage.read(media.path);
    } catch (err) {
      log.error({ generationId, err: String(err) }, 'файл результата не читается');
      return;
    }

    // Кнопка та же, что стояла на заглушке, но теперь рабочая: знак запрета
    // уходит, нажатие присылает QR-карточку.
    const markup = shareButton(generationId, true);

    // Основной путь: подменяем картинку ВНУТРИ карточки «Рисую…».
    // Участник видит превращение прямо там, где ждал, без второго сообщения.
    let delivered = false;
    if (cardId !== undefined) {
      try {
        await bot.api.editMessageMedia(chatId, cardId,
          InputMediaBuilder.photo(new InputFile(buf, 'mqbot.jpg')),
          { reply_markup: markup });
        log.info({ generationId, bytes: media.bytes }, 'картинка подменена в карточке');
        delivered = true;
        await bot.api.sendMessage(chatId, doneText, { reply_parameters: { message_id: cardId } })
          .catch((e: unknown) => log.warn({ generationId, err: String(e) }, 'подпись к готовой картинке не отправилась'));
        // В историю — как реплика бота: модель видит, что картинка готова,
        // и «ещё раз» читается как переделка, а не как ожидание.
        if (gen.conversationId) {
          await app.conversations.addMessage({ conversationId: gen.conversationId, role: 'assistant', text: doneText })
            .catch((e: unknown) => log.warn({ generationId, err: String(e) }, 'подпись не записалась в историю'));
        }
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
          reply_markup: markup,
        });
        log.info({ generationId, bytes: media.bytes }, 'картинка доставлена отдельным сообщением');
        delivered = true;
      } catch (err) {
        log.error({ generationId, err: String(err) }, 'не удалось доставить картинку');
      }
    }

    // QR-карточку здесь НЕ шлём: она уходит только по нажатию кнопки.
    // Второе сообщение на каждую генерацию засоряло чат (см. share-button.ts).
  };
}

/**
 * Текст про неудачу. Отдельно разбираем отказ по контенту: участнику важно
 * понять, что дело в его запросе, а не в поломке бота, — иначе он будет
 * повторять то же самое и тратить токены.
 */
function failureText(failMessage: string | null): string {
  const policy = /policy|prohibited|filtered|violat/i.test(failMessage ?? '');
  return policy
    ? 'Эту картинку генератор рисовать не стал — с реальными людьми и известными героями он ' +
      'осторожнее меня. Токены вернул. Попробуй другую идею или скажи, что ещё поменять.'
    : 'Не получилось нарисовать — картинка не вышла. Токены вернул, попробуй сформулировать чуть иначе.';
}
