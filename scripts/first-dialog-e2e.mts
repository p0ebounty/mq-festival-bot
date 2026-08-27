/**
 * Регрессия по первому боевому диалогу (прод, 27.08).
 *
 *   APP_ENV=dev pnpm tsx scripts/first-dialog-e2e.mts
 *
 * Повторяет ровно те шаги, на которых бот повёл себя не так, и проверяет
 * каждый из трёх дефектов отдельно:
 *   1. /start отвечал без приветствия;
 *   2. на «какие есть готовые» перечислял возможности, но не давал ни одного
 *      мира — при том, что пул из шести миров лежит в базе;
 *   3. попросив фото под уже названную профессию, на само фото переспрашивал
 *      «что с ним сделать?».
 *
 * Тратит кредиты: модель на каждый шаг плюс одна генерация.
 * Выходит с кодом 1, если хоть одна проверка провалилась.
 */
import { config as loadEnv } from 'dotenv';
import { eq, desc } from 'drizzle-orm';
import fs from 'node:fs/promises';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { createContext } = await import('../apps/bot/src/context.js');
const { handleIncoming } = await import('../apps/bot/src/agent/runner.js');
const { startGreeting } = await import('../apps/bot/src/bot/greeting.js');
const { PHOTO_WITHOUT_CAPTION } = await import('../apps/bot/src/bot/index.js');
const { makeGetBalanceTool } = await import('../apps/bot/src/agent/tools/get-balance.js');
const { makeGenerateImageTool } = await import('../apps/bot/src/agent/tools/generate-image.js');
const { makeEditImageTool } = await import('../apps/bot/src/agent/tools/edit-image.js');
const { makeGetBaseWorldTool } = await import('../apps/bot/src/agent/tools/base-world.js');
const { makeSuggestTool } = await import('../apps/bot/src/agent/tools/suggest.js');
const { users, messages, toolCalls, generations } = await import('@mq/db/schema');

const app = createContext();
app.registry
  .register(makeGetBalanceTool(app))
  .register(makeGenerateImageTool(app))
  .register(makeEditImageTool(app))
  .register(makeGetBaseWorldTool(app))
  .register(makeSuggestTool());

const sentMedia: string[] = [];
app.sendMedia = async (_chat, mediaId, caption) => {
  sentMedia.push(`${caption} [${mediaId.slice(0, 8)}]`);
  return true;
};
const log = {
  info: () => {}, warn: () => {},
  error: (o: unknown, m?: string) => console.log('     ✗', m ?? '', JSON.stringify(o).slice(0, 160)),
} as never;
const { makeMediaUploader } = await import('../apps/bot/src/bot/media-out.js');
app.uploadStoredMedia = makeMediaUploader(app, log);

const TG_ID = 999000101n;
const CHAT = 999000101n;
let mid = 1n;
let failures = 0;

function check(ok: boolean, what: string, detail = '') {
  console.log(ok ? `   ✓ ${what}` : `   ✗ ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function say(text: string, imageUrls?: string[]) {
  console.log(`\n👤 ${text}${imageUrls ? '  [+ фото]' : ''}`);
  const t0 = Date.now();
  const r = await handleIncoming(app, {
    tgId: TG_ID, chatId: CHAT, tgMessageId: mid++, text,
    ...(imageUrls ? { imageUrls } : {}),
    from: { firstName: 'Артём', username: 'e2e_first' },
  }, log);
  console.log(`🤖 ${r.text}   (${((Date.now() - t0) / 1000).toFixed(1)}с)`);
  if (r.suggestions?.length) console.log(`   кнопки: ${r.suggestions.join(' | ')}`);
  return r;
}

/** Инструменты последнего ответа агента. */
async function toolsOfLastReply(convId: string): Promise<string[]> {
  const [last] = await app.db.select().from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(desc(messages.createdAt)).limit(1);
  if (!last) return [];
  const rows = await app.db.select().from(toolCalls).where(eq(toolCalls.messageId, last.id));
  return rows.map((c) => `${c.toolName}${c.ok ? '' : '(ошибка)'}`);
}

// Чистим прошлый прогон, чтобы история не подсказывала ответы.
const [old] = await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
if (old) await app.db.delete(users).where(eq(users.id, old.id));

// ── 1. /start ───────────────────────────────────────────────────────
console.log('══════════ 1. /start должен здороваться ══════════');
const t0 = Date.now();
const g = await startGreeting(app, {
  tgId: TG_ID, chatId: CHAT, tgMessageId: mid++,
  from: { firstName: 'Артём', username: 'e2e_first' },
}, log);
const startMs = Date.now() - t0;
console.log(`🤖 ${g.text}\n   кнопки: ${g.suggestions.join(' | ')}   (${startMs} мс)`);
check(/^Привет, Артём!/.test(g.text), 'поздоровался и назвал по имени');
check(g.text.includes('готовый мир'), 'сразу сказал про готовые миры');
check(startMs < 1000, 'ответил мгновенно, без похода в модель', `${startMs} мс`);

// ── 2. «какие есть готовые» ─────────────────────────────────────────
console.log('\n══════════ 2. готовые миры выдаются, а не описываются ══════════');
const r2 = await say('какие есть готовые');
const t2 = await toolsOfLastReply(r2.conversationId);
console.log(`   инструменты: ${t2.join(' | ') || '—'}`);
console.log(`   ушло картинкой: ${sentMedia.join('; ') || '—'}`);
check(t2.includes('get_base_world'), 'вызвал get_base_world');
check(sentMedia.length > 0, 'участник реально получил картинку мира');

// ── 3. профессия названа заранее, фото приходит молча ───────────────
console.log('\n══════════ 3. фото под уже названную профессию ══════════');
const r3 = await say('Хочу космонавтом');
check(/фот/i.test(r3.text), 'попросил фото', r3.text.slice(0, 80));

const b64 = (await fs.readFile('docs/experiments/assets/base-portrait.jpg')).toString('base64');
const photo = await app.kie.uploadBase64({
  base64: `data:image/jpeg;base64,${b64}`, fileName: 'first-dialog.jpg',
});

const r4 = await say(PHOTO_WITHOUT_CAPTION, [photo.downloadUrl]);
const t4 = await toolsOfLastReply(r4.conversationId);
console.log(`   инструменты: ${t4.join(' | ') || '—'}`);
check(t4.includes('edit_image'), 'взялся за работу, а не переспросил', r4.text.slice(0, 90));

const [u] = await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
const [gen] = await app.db.select().from(generations)
  .where(eq(generations.userId, u!.id)).orderBy(desc(generations.createdAt)).limit(1);
if (gen) {
  console.log(`\n   правим: ${gen.sourceUrl?.slice(-30) ?? '∅'}`);
  console.log(`   промпт: "${String(gen.finalPrompt).slice(0, 170)}"`);
  check(gen.sourceUrl === photo.downloadUrl, 'правит именно присланное фото');
  check(/astronaut|cosmonaut|spacesuit|space suit/i.test(String(gen.finalPrompt)),
    'космонавт из разговора доехал до промпта');
  check(gen.kind !== 'world', 'фото участника не подменило ему мир', String(gen.kind));
}

console.log(`\n══════════ ${failures === 0 ? 'ВСЁ ЧИСТО' : `ПРОВАЛОВ: ${failures}`} ══════════`);
process.exit(failures === 0 ? 0 : 1);
