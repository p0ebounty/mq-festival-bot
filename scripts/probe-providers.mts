/**
 * Живы ли провайдеры модели: мозг агента и классификатор модерации.
 *   APP_ENV=dev tsx scripts/probe-providers.mts
 *
 * Нужен в день фестиваля: когда бот отвечает «не получилось», первый
 * вопрос — он сам сломался или лежит kie.ai. Проверка стоит один короткий
 * вызов на каждого и отвечает за секунды.
 *
 * ⚠️ Классификатор проверяется отдельно от агента не для симметрии:
 * модерация работает fail-closed, поэтому её недоступность гасит ВСЕ
 * генерации, даже когда сам агент отвечает (ADR 0014).
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { createContext } = await import('../apps/bot/src/context.js');
const { MODERATION_MODEL } = await import('../apps/bot/src/moderation/classifier.js');

const app = createContext();
const agentModel = await app.settings.get('kie.chatModel');
console.log(`мозг агента:  ${agentModel}`);
console.log(`модерация:    ${MODERATION_MODEL} (задана в коде)`);
console.log(`кредитов:     ${await app.kie.getCredits().catch(() => '— не ответил')}\n`);

let bad = 0;
for (const [name, get] of [
  ['агент', app.chatProvider],
  ['модерация', app.moderationProvider],
] as const) {
  const t0 = Date.now();
  try {
    const provider = await get();
    const r = await provider.complete({
      system: 'Отвечай одним словом.',
      messages: [{ role: 'user', text: 'скажи: ок' }],
      tools: [],
    });
    console.log(`  ✓ ${name.padEnd(10)} ${((Date.now() - t0) / 1000).toFixed(1)}с — «${r.text.trim().slice(0, 40)}»`);
  } catch (e) {
    bad++;
    console.log(`  ✗ ${name.padEnd(10)} ${((Date.now() - t0) / 1000).toFixed(1)}с — ${(e as Error).message.slice(0, 140)}`);
  }
}

process.exit(bad === 0 ? 0 : 1);
