/**
 * Нажатие на кнопку-подсказку — сквозь настоящий вебхук.
 *
 *   APP_ENV=dev pnpm tsx scripts/tap-e2e.mts
 *
 * Не эмулируем Telegram, а бьём в свой же обработчик корректным Update
 * (правило 60-testing) и смотрим, что легло в базу. Чат синтетический:
 * отправка наружу провалится и будет проглочена, а проверяем мы свой путь —
 * разбор callback_data, запись сообщения от лица участника и работу агента.
 *
 * Тратит кредиты: один ответ модели.
 */
import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { eq, desc } from 'drizzle-orm';
config({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { createDb } = await import('@mq/db');
const { users, messages, conversations, toolCalls } = await import('@mq/db/schema');
const db = createDb(process.env.DATABASE_URL!, { max: 1 });

const update = JSON.parse(await readFile('apps/bot/test/fixtures/updates/suggestion-tap.json', 'utf8'));
const TG_ID = BigInt(update.callback_query.from.id);
const CHOICE: string = update.callback_query.data.slice('sg:'.length);

const [old] = await db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
if (old) await db.delete(users).where(eq(users.id, old.id));

const url = `${process.env.PUBLIC_URL}/tg/${process.env.TELEGRAM_WEBHOOK_SECRET}`;
console.log(`бью в вебхук: ${url.replace(/\/tg\/.*/, '/tg/***')}`);

let fail = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(ok ? `  ✓ ${what}` : `  ✗ ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail++;
};

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Telegram-Bot-Api-Secret-Token': process.env.TELEGRAM_WEBHOOK_SECRET!,
  },
  body: JSON.stringify(update),
});
// ⚠️ 200 обязателен даже при внутренней ошибке: на вебхуке любой другой код
// заставляет Telegram прислать апдейт заново, то есть списать токены дважды.
check(res.status === 200, 'вебхук ответил 200', String(res.status));

console.log('\nжду, пока агент отработает…');
let msgs: Array<{ role: string; text: string | null; id: string }> = [];
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const [u] = await db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
  if (!u) continue;
  const [conv] = await db.select().from(conversations)
    .where(eq(conversations.userId, u.id)).orderBy(desc(conversations.lastMessageAt)).limit(1);
  if (!conv) continue;
  msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(messages.createdAt);
  if (msgs.some((m) => m.role === 'assistant')) break;
}

for (const m of msgs) console.log(`  ${m.role === 'user' ? '👤' : '🤖'} ${(m.text ?? '').slice(0, 110)}`);

check(msgs.some((m) => m.role === 'user' && m.text === CHOICE),
  'текст кнопки записан как сообщение участника', msgs.map((m) => m.text).join(' | ').slice(0, 90));
check(msgs.some((m) => m.role === 'assistant' && (m.text ?? '').length > 0), 'агент ответил');

const assistant = msgs.find((m) => m.role === 'assistant');
if (assistant) {
  const calls = await db.select().from(toolCalls).where(eq(toolCalls.messageId, assistant.id));
  console.log(`  инструменты: ${calls.map((c) => c.toolName).join(', ') || '—'}`);
  check(calls.some((c) => c.toolName === 'get_base_world'), 'нажатие «Дай готовый мир» выдало мир');
}

const userMsg = msgs.find((m) => m.role === 'user');
check(userMsg?.tgMessageId === null || userMsg?.tgMessageId === 0n,
  'id сообщения бота не записан как входящий', String(userMsg?.tgMessageId));

console.log(`\n${fail === 0 ? '══ ВСЁ ЧИСТО ══' : `══ ПРОВАЛОВ: ${fail} ══`}`);
process.exit(fail === 0 ? 0 : 1);
