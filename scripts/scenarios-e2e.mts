/**
 * Проверка обоих сценариев ТЗ целиком, без Telegram и БЕЗ КНОПОК —
 * только текстом, как это делает участник.
 *   APP_ENV=dev tsx scripts/scenarios-e2e.mts
 * Тратит кредиты: модель + до трёх генераций.
 */
import { config as loadEnv } from 'dotenv';
import { eq, desc } from 'drizzle-orm';
import fs from 'node:fs/promises';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { createContext } = await import('../apps/bot/src/context.js');
const { handleIncoming } = await import('../apps/bot/src/agent/runner.js');
const { makeGetBalanceTool } = await import('../apps/bot/src/agent/tools/get-balance.js');
const { makeGenerateImageTool } = await import('../apps/bot/src/agent/tools/generate-image.js');
const { makeEditImageTool } = await import('../apps/bot/src/agent/tools/edit-image.js');
const { makeGetBaseWorldTool } = await import('../apps/bot/src/agent/tools/base-world.js');
const { users, generations, messages, toolCalls } = await import('@mq/db/schema');

const app = createContext();
app.registry
  .register(makeGetBalanceTool(app))
  .register(makeGenerateImageTool(app))
  .register(makeEditImageTool(app))
  .register(makeGetBaseWorldTool(app));

// Telegram в тесте нет — подменяем отправку, но заливку оставляем настоящей.
const sentToUser: string[] = [];
app.sendMedia = async (_chat, mediaId, caption) => {
  sentToUser.push(`${caption} [media ${mediaId.slice(0, 8)}]`);
  return true;
};
const { makeMediaUploader } = await import('../apps/bot/src/bot/media-out.js');
const log = {
  info: (o: unknown, m?: string) => console.log('     ·', m ?? '', JSON.stringify(o).slice(0, 100)),
  warn: (o: unknown, m?: string) => console.log('     ⚠', m ?? '', JSON.stringify(o).slice(0, 100)),
  error: (o: unknown, m?: string) => console.log('     ✗', m ?? '', JSON.stringify(o).slice(0, 140)),
} as never;
app.uploadStoredMedia = makeMediaUploader(app, log);

const TG_ID = 999000077n;
const CHAT = 999000077n;
let mid = 1n;

async function say(text: string, imageUrls?: string[]) {
  console.log(`\n👤 ${text}${imageUrls ? '  [+ фото]' : ''}`);
  const t0 = Date.now();
  const r = await handleIncoming(app, {
    tgId: TG_ID, chatId: CHAT, tgMessageId: mid++, text,
    ...(imageUrls ? { imageUrls } : {}),
    from: { firstName: 'Тест', username: 'e2e_scen' },
  }, log);
  console.log(`🤖 ${r.text}   (${((Date.now() - t0) / 1000).toFixed(1)}с)`);
  return r;
}

async function lastToolCalls(convId: string) {
  const msgs = await app.db.select().from(messages)
    .where(eq(messages.conversationId, convId)).orderBy(desc(messages.createdAt)).limit(2);
  const out: string[] = [];
  for (const m of msgs) {
    for (const c of await app.db.select().from(toolCalls).where(eq(toolCalls.messageId, m.id))) {
      out.push(`${c.ok ? '✓' : '✗'} ${c.toolName} ${JSON.stringify(c.input).slice(0, 90)}`);
    }
  }
  return out;
}

// Чистим прошлый прогон
const [old] = await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
if (old) await app.db.delete(users).where(eq(users.id, old.id));

// Фото участника: берём синтетический портрет, настоящее лицо для теста не нужно
const b64 = (await fs.readFile('docs/experiments/assets/base-portrait.jpg')).toString('base64');
const photo = await app.kie.uploadBase64({
  base64: `data:image/jpeg;base64,${b64}`, fileName: 'e2e-selfie.jpg',
});

console.log('══════════ СЦЕНАРИЙ 1 ТЗ: профессии будущего ══════════');
await say('привет, а кем я могу себя увидеть?');
const s1 = await say('о, космонавтом! вот моё фото, только чтобы на фоне был мой родной город', [photo.downloadUrl]);
console.log('   инструменты:', (await lastToolCalls(s1.conversationId)).join(' | ') || '—');

// Проверяем честность: пока первая генерация в работе, вторую начать нельзя.
console.log('\n────── проверка честности при отказе ──────');
const busy = await say('а ещё сделай меня врачом');
console.log('   инструменты:', (await lastToolCalls(busy.conversationId)).join(' | ') || '—');
const lied = /дела|готов|скоро|прилет|навож|создаю|рису/i.test(busy.text) && !/подожд|доделаю|сначала|потом|уже готов/i.test(busy.text);
console.log(lied ? '   ✗ АГЕНТ СОВРАЛ: обещал результат при отказе' : '   ✓ агент честно сказал, что надо подождать');

console.log('\n   ждём готовности первой картинки…');
for (let i = 0; i < 40; i++) {
  const [g] = await app.db.select().from(generations)
    .where(eq(generations.userId, (await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1))[0]!.id))
    .orderBy(desc(generations.createdAt)).limit(1);
  if (g && (g.status === 'success' || g.status === 'failed')) { console.log(`   готово: ${g.status}`); break; }
  await new Promise((r) => setTimeout(r, 5000));
}

console.log('\n══════════ СЦЕНАРИЙ 2 ТЗ: из одного мира — другой ══════════');
const w0 = await say('а давай теперь поиграем в миры');
console.log('   инструменты:', (await lastToolCalls(w0.conversationId)).join(' | ') || '—');
console.log('   отправлено участнику:', sentToUser.join('; ') || '—');

const w1 = await say('сделай там шторм и пусть рыцари станут роботами');
console.log('   инструменты:', (await lastToolCalls(w1.conversationId)).join(' | ') || '—');

// ── Сценарий владельца: два разных снимка, просьба про первый ──
// Живой дефект 27.08: участник прислал новое фото, попросил «сделай ночь»,
// а правка легла на картинку 22-минутной давности. Проверяем на реальном
// пути — с реестром, собранным из БД, а не подсунутым в тесте.
console.log('\n══════════ ВЫБОР КАРТИНКИ: два разных снимка ══════════');
console.log('   ждём готовности картинки мира…');
for (let i = 0; i < 40; i++) {
  const [g] = await app.db.select().from(generations)
    .where(eq(generations.userId, (await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1))[0]!.id))
    .orderBy(desc(generations.createdAt)).limit(1);
  if (g && (g.status === 'success' || g.status === 'failed')) { console.log(`   готово: ${g.status}`); break; }
  await new Promise((r) => setTimeout(r, 5000));
}

const second = await app.kie.uploadBase64({
  base64: `data:image/jpeg;base64,${(await fs.readFile('docs/experiments/assets/base-portrait.jpg')).toString('base64')}`,
  fileName: 'e2e-second.jpg',
});
await say('а тут что у меня?', [second.downloadUrl]);
const pick = await say('добавь на мой мир северное сияние');
const picked = (await lastToolCalls(pick.conversationId)).join(' | ');
console.log('   инструменты:', picked || '—');
console.log(/edit_image/.test(picked)
  ? '   ✓ выбрал правку картинки, а не генерацию с нуля'
  : '   ✗ не вызвал edit_image');

console.log('\n══════════ ЧТО ЛЕГЛО В БАЗУ ══════════');
const [u] = await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
console.log(`баланс: ${u!.tokenBalance} | текущий мир: ${u!.currentWorldMediaId?.slice(0, 8) ?? '∅'}`);

const gens = await app.db.select().from(generations)
  .where(eq(generations.userId, u!.id)).orderBy(generations.createdAt);
for (const g of gens) {
  console.log(`\n[${g.kind}] ${g.status} | модель ${g.model}`);
  console.log(`  сказал участник: "${g.userPrompt.slice(0, 95)}"`);
  console.log(`  ушло в модель:   "${String(g.finalPrompt).slice(0, 190)}"`);
  console.log(`  исходная картинка: ${g.sourceUrl?.slice(-34) ?? '∅ (рисовали с нуля)'}`);
}
process.exit(0);
