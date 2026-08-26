import { InputFile } from 'grammy';
import type { Bot } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';

/**
 * Досылка готовой картинки участнику.
 *
 * Вызывается из обработчика callback от kie.ai, а не из цикла агента:
 * генерация идёт 40–80 секунд, столько держать диалог нельзя.
 * Поэтому агент говорит «делаю», а картинка прилетает отдельным сообщением.
 */
export function makeDeliverer(app: AppContext, bot: Bot, log: FastifyBaseLogger) {
  return async function deliverGeneration(generationId: string): Promise<void> {
    const gen = await app.generations.byId(generationId);
    if (!gen) return;

    if (!gen.tgChatId) {
      log.warn({ generationId }, 'некуда доставлять: у генерации нет chat id');
      return;
    }

    if (gen.status === 'failed' || gen.status === 'refunded') {
      await bot.api.sendMessage(Number(gen.tgChatId),
        'Не получилось нарисовать — картинка не вышла. Токены вернул, попробуй сформулировать чуть иначе.')
        .catch((e: unknown) => log.warn({ generationId, err: String(e) }, 'не смог отправить сообщение о сбое'));
      return;
    }

    if (gen.status !== 'success' || !gen.outputMediaId) return;

    const media = await app.media.byId(gen.outputMediaId);
    if (!media) {
      log.warn({ generationId }, 'генерация успешна, но записи медиа нет');
      return;
    }

    try {
      const buf = await app.storage.read(media.path);
      // Шлём файлом, а не ссылкой: Telegram кэширует и показывает мгновенно,
      // и картинка не зависит от доступности нашего домена.
      // Подпись пишет агент при постановке задачи — она про идею участника,
      // а не казённое «Готово!». Если агент её не дал, обходимся без подписи:
      // пустая лучше безликой.
      const caption = gen.caption?.trim();
      await bot.api.sendPhoto(Number(gen.tgChatId), new InputFile(buf, 'mqbot.jpg'),
        caption ? { caption } : {});
      log.info({ generationId, bytes: media.bytes }, 'картинка доставлена участнику');
    } catch (err) {
      log.error({ generationId, err: String(err) }, 'не удалось доставить картинку');
    }
  };
}
