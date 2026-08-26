import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { AgentTool } from '@mq/core';
import { users } from '@mq/db/schema';
import type { AppContext } from '../../context.js';

export function makeGetBalanceTool(app: AppContext): AgentTool<Record<string, never>> {
  return {
    name: 'get_balance',
    // Описание пишется ДЛЯ МОДЕЛИ: когда звать, когда не звать, что вернётся.
    description:
      'Узнать, сколько у участника осталось токенов и сколько стоит генерация. ' +
      'Вызывай, когда участник спрашивает про баланс, лимит, «сколько осталось», ' +
      '«почему не хватает». НЕ вызывай перед каждой генерацией — баланс уже есть в контексте.',
    input: z.object({}),
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(_input, ctx) {
      const [row] = await app.db
        .select({ balance: users.tokenBalance })
        .from(users).where(eq(users.id, ctx.userId)).limit(1);
      const balance = row?.balance ?? 0;
      const cost = await app.settings.getInt('economy.costPerImage');
      const bonus = await app.settings.getInt('economy.socialBonus');
      return {
        ok: true,
        summary:
          `У участника ${balance} токен(ов). Генерация стоит ${cost}. ` +
          `За репост готовой картинки в соцсеть даётся ещё ${bonus}.`,
        data: { balance, cost_per_image: cost, social_bonus: bonus },
      };
    },
  };
}
