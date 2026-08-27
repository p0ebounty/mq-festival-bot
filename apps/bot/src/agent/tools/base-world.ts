import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import type { AgentTool } from '@mq/core';
import { baseWorlds } from '@mq/db/schema';
import type { AppContext } from '../../context.js';

/**
 * Сценарий 2 ТЗ: выдать участнику стартовый мир, который он потом изменит
 * одной фразой.
 *
 * Единственный инструмент, переживший чистку набора (ADR 0010), и вот
 * почему: картинки в пуле нарисованы заранее. Выдача мгновенна и не стоит
 * ни токена, тогда как генерация на лету — это ~40 секунд и списание ещё
 * ДО первой правки. На турнире, где у участника три минуты, разница
 * решающая, а одинаковые исходники делают сравнение работ честным.
 *
 * Дальше мир живёт как обычная картинка диалога: менять его будет
 * `edit_image`, отдельного инструмента для этого больше нет.
 */
export function makeGetBaseWorldTool(app: AppContext): AgentTool<Record<string, never>> {
  return {
    name: 'get_base_world',
    description:
      'Выдать участнику стартовый мир — готовую картинку, которую он потом изменит одной фразой. ' +
      'Вызывай, когда участник хочет поиграть в превращение миров или просит «дай мир». ' +
      'Инструмент сам отправит картинку — тебе останется объяснить правила игры. ' +
      'НЕ вызывай, если участник просит изменить картинку, которая у него уже есть: ' +
      'для этого есть edit_image.',
    input: z.object({}),
    parameters: { type: 'object', properties: {}, additionalProperties: false },

    async run(_input, ctx) {
      const [world] = await app.db.select().from(baseWorlds)
        .where(eq(baseWorlds.isActive, true))
        // Реже выданные вперёд, дальше случайно: у соседей по стенду
        // должны быть разные миры, иначе турнир скучный.
        .orderBy(baseWorlds.timesIssued, sql`random()`)
        .limit(1);

      if (!world) {
        return {
          ok: false,
          summary: 'Пул стартовых миров пуст.',
          note: 'Предложи участнику обычную генерацию картинки через generate_image.',
          error: 'no_worlds',
        };
      }

      await app.db.update(baseWorlds)
        .set({ timesIssued: sql`${baseWorlds.timesIssued} + 1` })
        .where(eq(baseWorlds.id, world.id));
      await app.worlds.setCurrent(ctx.userId, world.mediaId);

      const sent = await app.sendMedia?.(ctx.chatId, world.mediaId, `Твой мир: ${world.title}`);
      if (!sent) {
        return { ok: false, summary: 'Картинку мира отправить не вышло. Попробуй ещё раз.', error: 'send_failed' };
      }
      ctx.log.info({ worldId: world.id, title: world.title }, 'выдан стартовый мир');

      return {
        ok: true,
        summary: `Участнику выдан мир «${world.title}», картинка уже ушла ему отдельным сообщением.`,
        note:
          'Объясни правила: этот мир меняется ОДНОЙ фразой — погода, стиль, ' +
          'архитектура, жители. Дай одну-две идеи для затравки, не перечисляй всё подряд. ' +
          'Менять его будешь через edit_image — мир появится в списке картинок диалога.',
        data: { world_title: world.title },
      };
    },
  };
}
