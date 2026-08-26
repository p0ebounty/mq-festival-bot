/**
 * Сквозная проверка агента без Telegram: собираем контекст приложения,
 * прогоняем реальные сообщения и смотрим, что легло в БД.
 *   APP_ENV=dev tsx scripts/agent-e2e.mts
 * Тратит кредиты (модель + возможная генерация).
 */
import { config as loadEnv } from 'dotenv';
import { eq, desc } from 'drizzle-orm';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { createContext } = await import('../apps/bot/src/context.js');
const { handleIncoming } = await import('../apps/bot/src/agent/runner.js');
const { makeGetBalanceTool } = await import('../apps/bot/src/agent/tools/get-balance.js');
const { makeGenerateImageTool } = await import('../apps/bot/src/agent/tools/generate-image.js');
const { users, conversations, messages, toolCalls, generations } = await import('@mq/db/schema');

const app = createContext();
app.registry.register(makeGetBalanceTool(app)).register(makeGenerateImageTool(app));

const log = {
  info: (o: unknown, m?: string) => console.log('   ·', m ?? '', JSON.stringify(o).slice(0, 110)),
  warn: (o: unknown, m?: string) => console.log('   ⚠', m ?? '', JSON.stringify(o).slice(0, 110)),
  error: (o: unknown, m?: string) => console.log('   ✗', m ?? '', JSON.stringify(o).slice(0, 160)),
} as never;

const TG_ID = 999000042n;
const CHAT = 999000042n;
let mid = 1n;

async function say(text: string) {
  console.log(`\n👤 ${text}`);
  const t0 = Date.now();
  const r = await handleIncoming(app, {
    tgId: TG_ID, chatId: CHAT, tgMessageId: mid++, text,
    from: { firstName: 'Тестовый', username: 'e2e_agent' },
  }, log);
  console.log(`🤖 ${r.text}`);
  console.log(`   (${((Date.now()-t0)/1000).toFixed(1)}с)`);
  return r;
}

// Чистим прошлый прогон, чтобы история не мешала
const [old] = await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
if (old) { await app.db.delete(users).where(eq(users.id, old.id)); console.log('прошлый тестовый участник удалён'); }

console.log('══════ ДИАЛОГ ══════');
await say('привет! что ты умеешь?');
await say('а сколько у меня осталось токенов?');
const last = await say('нарисуй рыжего кота в скафандре который сидит на бабушкином диване');

console.log('\n══════ ЧТО ЛЕГЛО В БАЗУ ══════');
const [u] = await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
console.log(`участник: ${u!.firstName} @${u!.username} | баланс ${u!.tokenBalance}`);

const convs = await app.db.select().from(conversations).where(eq(conversations.userId, u!.id));
console.log(`диалогов: ${convs.length} (должен быть 1 — сообщения в одном треде)`);

const msgs = await app.db.select().from(messages)
  .where(eq(messages.conversationId, last.conversationId)).orderBy(messages.createdAt);
console.log(`сообщений: ${msgs.length}`);
for (const m of msgs) {
  const tok = m.inputTokens ? ` [${m.inputTokens}→${m.outputTokens}]` : '';
  console.log(`   ${m.role.padEnd(9)}${tok} ${String(m.text ?? '').replace(/\n/g,' ').slice(0, 78)}`);
}

console.log('\nвызовы инструментов (это и видно в админке):');
for (const m of msgs) {
  const calls = await app.db.select().from(toolCalls).where(eq(toolCalls.messageId, m.id));
  for (const c of calls) {
    console.log(`   ${c.ok ? '✓' : '✗'} ${c.toolName} (${c.durationMs}мс)`);
    console.log(`      вход:  ${JSON.stringify(c.input).slice(0, 120)}`);
    console.log(`      выход: ${JSON.stringify(c.output).slice(0, 120)}`);
  }
}

const gens = await app.db.select().from(generations)
  .where(eq(generations.userId, u!.id)).orderBy(desc(generations.createdAt));
console.log(`\nгенераций: ${gens.length}`);
for (const g of gens) {
  console.log(`   ${g.status} | модель ${g.model} | списано ${g.tokensCharged}`);
  console.log(`      запрос участника: "${g.userPrompt.slice(0, 90)}"`);
  console.log(`      финальный промпт: "${String(g.finalPrompt).slice(0, 90)}"`);
}
process.exit(0);
