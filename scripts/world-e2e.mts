/**
 * Игра в миры целиком, без Telegram и без кнопок — только текстом.
 *   APP_ENV=dev tsx scripts/world-e2e.mts
 * Тратит кредиты: модель и две генерации.
 *
 * Проверяет то, чего не видит unit-тест: агент действительно ВЫДАЁТ мир,
 * а не рассказывает о нём; правка ложится на выданную картинку; работа
 * записывается с world_id; следующая правка наследует тот же мир по
 * цепочке; пул миров не смешивается с пулом заданий.
 *
 * Близнец `task-e2e.mts` — то же самое для заданий.
 */
import { config as loadEnv } from 'dotenv';
import { eq, desc } from 'drizzle-orm';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { createContext } = await import('../apps/bot/src/context.js');
const { handleIncoming } = await import('../apps/bot/src/agent/runner.js');
const { makeGetBalanceTool } = await import('../apps/bot/src/agent/tools/get-balance.js');
const { makeGenerateImageTool } = await import('../apps/bot/src/agent/tools/generate-image.js');
const { makeEditImageTool } = await import('../apps/bot/src/agent/tools/edit-image.js');
const { makeGetBaseWorldTool } = await import('../apps/bot/src/agent/tools/base-world.js');
const { makeGetTaskTool } = await import('../apps/bot/src/agent/tools/get-task.js');
const { users, generations, messages, toolCalls, baseWorlds } = await import('@mq/db/schema');

const app = createContext();
app.registry
  .register(makeGetBalanceTool(app))
  .register(makeGenerateImageTool(app))
  .register(makeEditImageTool(app))
  .register(makeGetBaseWorldTool(app))
  .register(makeGetTaskTool(app));

const sentToUser: string[] = [];
app.sendMedia = async (_chat, mediaId, caption) => {
  sentToUser.push(`${caption} [media ${mediaId.slice(0, 8)}]`);
  return true;
};
const { makeMediaUploader } = await import('../apps/bot/src/bot/media-out.js');
const log = {
  info: () => {}, warn: () => {},
  error: (o: unknown, m?: string) => console.log('     ✗', m ?? '', JSON.stringify(o).slice(0, 140)),
} as never;
app.uploadStoredMedia = makeMediaUploader(app, log);

const TG_ID = 999000079n;
const CHAT = 999000079n;
let mid = 1n;
let fails = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(ok ? `   \x1b[32m✓\x1b[0m ${what}` : `   \x1b[31m✗ ${what}\x1b[0m ${detail}`);
  if (!ok) fails++;
};

async function say(text: string) {
  console.log(`\n👤 ${text}`);
  const r = await handleIncoming(app, {
    tgId: TG_ID, chatId: CHAT, tgMessageId: mid++, text,
    from: { firstName: 'Тест', username: 'e2e_world' },
  }, log);
  console.log(`🤖 ${r.text}`);
  return r;
}

async function lastTools(convId: string): Promise<string[]> {
  const msgs = await app.db.select().from(messages)
    .where(eq(messages.conversationId, convId)).orderBy(desc(messages.createdAt)).limit(2);
  const out: string[] = [];
  for (const m of msgs) {
    for (const c of await app.db.select().from(toolCalls).where(eq(toolCalls.messageId, m.id))) {
      out.push(`${c.ok ? '✓' : '✗'} ${c.toolName}`);
    }
  }
  return out;
}

const userId = async () =>
  (await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1))[0]!.id;

const lastGen = async () =>
  (await app.db.select().from(generations)
    .where(eq(generations.userId, await userId()))
    .orderBy(desc(generations.createdAt)).limit(1))[0];

/** Ждём, пока картинка доедет: без неё правка правки не с чего делается. */
async function waitDone(tries = 40): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const g = await lastGen();
    // Генерации нет вовсе — ждать нечего, иначе прогон висит три минуты
    // впустую на каждом сбое предыдущего шага.
    if (!g) return 'none';
    if (g.status === 'success' || g.status === 'failed') return g.status;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return 'timeout';
}

// ── подготовка ──
const pool = await app.db.select().from(baseWorlds).where(eq(baseWorlds.kind, 'world'));
if (pool.length === 0) {
  console.error('в пуле нет ни одного мира — сначала прогони seed-content.mts');
  process.exit(1);
}
console.log(`миров в пуле: ${pool.length}`);

const [old] = await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
if (old) await app.db.delete(users).where(eq(users.id, old.id));

// ── 1. Мир выдают, а не описывают ──
console.log('\n══════════ ВЫДАЧА МИРА ══════════');
const r1 = await say('дай мне какой-нибудь готовый мир');
const tools1 = await lastTools(r1.conversationId);
console.log('   инструменты:', tools1.join(' | ') || '—');
check(tools1.some((t) => t.includes('get_base_world')), 'вызван get_base_world');
check(sentToUser.length === 1, 'картинка мира ушла участнику', sentToUser.join('; '));

const issued = await app.worlds.getCurrent(await userId());
check(!!issued?.worldId, 'мир опознан по выданной картинке', `worldId=${issued?.worldId ?? '∅'}`);
const issuedTitle = pool.find((w) => w.id === issued?.worldId)?.title ?? '';
console.log(`   мир: «${issuedTitle}»`);

// ── 2. Правка ложится на выданный мир и записывается с его id ──
console.log('\n══════════ ПРАВКА МИРА ══════════');
const r2 = await say('сделай там ночь и северное сияние');
const tools2 = await lastTools(r2.conversationId);
console.log('   инструменты:', tools2.join(' | ') || '—');
check(tools2.some((t) => t.includes('edit_image')), 'вызван edit_image');

const gen1 = await lastGen();
check(gen1?.kind === 'world', 'работа записана как мир', `kind=${gen1?.kind}`);
check(!!gen1?.worldId, 'работа записана с id мира', gen1 ? `worldId=${gen1.worldId}` : 'генерации нет');
check(gen1?.worldId === issued?.worldId, 'id мира совпадает с выданным');
// Пулы лежат в одной таблице, но не смешиваются нигде (ADR 0013).
check(gen1?.taskId == null, 'заданием работа не считается', `taskId=${gen1?.taskId}`);

// ── 3. Мир наследуется дальше по цепочке ──
//
// Ради этого связь и заводилась: участник правит мир пять раз подряд, и
// каждая правка обязана остаться работой по тому же миру — иначе в админке
// у мира одна работа вместо пяти.
console.log('\n══════════ ЦЕПОЧКА ПРАВОК ══════════');
console.log('   ждём готовности первой картинки…');
const st = await waitDone();
console.log(`   первая генерация: ${st}`);
if (st === 'success') {
  const r3 = await say('а теперь добавь туда летающие корабли');
  const tools3 = await lastTools(r3.conversationId);
  console.log('   инструменты:', tools3.join(' | ') || '—');
  const gen2 = await lastGen();
  check(gen2?.id !== gen1?.id, 'сделана вторая работа');
  check(gen2?.worldId === issued?.worldId, 'вторая работа осталась работой по тому же миру',
    `worldId=${gen2?.worldId ?? '∅'}`);
} else {
  check(false, 'первая картинка доехала', `статус ${st} — цепочку проверить не на чем`);
}

console.log(fails === 0
  ? '\n\x1b[32mвсё сошлось\x1b[0m'
  : `\n\x1b[31mпровалов: ${fails}\x1b[0m`);
process.exit(fails === 0 ? 0 : 1);
