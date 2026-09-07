/**
 * Спящий бот — сквозь настоящий вебхук.
 *
 *   APP_ENV=dev pnpm tsx scripts/sleep-e2e.mts
 *
 * Переводит стенд в `bot.mode = asleep`, бьёт в вебхук текстом, командой
 * /start и нажатием кнопки-подсказки и проверяет по базе, что ни одно из
 * них НЕ дошло до агента: у синтетического участника не появилось ни
 * диалога, ни сообщений. В конце будит бота обратно — стенд остаётся
 * таким, каким был.
 *
 * Кредитов не тратит: в этом и смысл.
 */
import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
config({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { createDb } = await import('@mq/db');
const { users, conversations, messages } = await import('@mq/db/schema');
const { SettingsService } = await import('@mq/config');
const db = createDb(process.env.DATABASE_URL!, { max: 1 });
const settings = new SettingsService(db, process.env.SECRETS_ENC_KEY!, process.env);

const TG_ID = 999000404n;
const chat = { id: Number(TG_ID), type: 'private', first_name: 'Соня' };
const from = { id: Number(TG_ID), is_bot: false, first_name: 'Соня', username: 'e2e_sleep', language_code: 'ru' };
const message = (n: number, extra: Record<string, unknown>) => ({
  update_id: 900100 + n,
  message: { message_id: 1000 + n, date: Math.floor(Date.now() / 1000), chat, from, ...extra },
});
const tapFixture = JSON.parse(await readFile('apps/bot/test/fixtures/updates/suggestion-tap.json', 'utf8'));
tapFixture.callback_query.from = from;
tapFixture.callback_query.message.chat = chat;
tapFixture.update_id = 900199;

const url = `${process.env.PUBLIC_URL}/tg/${process.env.TELEGRAM_WEBHOOK_SECRET}`;
const post = (body: unknown) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': process.env.TELEGRAM_WEBHOOK_SECRET! },
  body: JSON.stringify(body),
});

let fail = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(ok ? `  ✓ ${what}` : `  ✗ ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail++;
};
const traces = async () => {
  const [u] = await db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
  if (!u) return { user: false, messages: 0 };
  const convs = await db.select().from(conversations).where(eq(conversations.userId, u.id));
  let n = 0;
  for (const c of convs) n += (await db.select().from(messages).where(eq(messages.conversationId, c.id))).length;
  return { user: true, messages: n };
};

const before = await settings.get('bot.mode');
console.log(`режим до: ${before}`);
const [old] = await db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
if (old) await db.delete(users).where(eq(users.id, old.id));

try {
  await settings.set('bot.mode', 'asleep');
  // Кэш настроек у бота живёт 10 с — ждём, пока он точно протух.
  console.log('усыпил, жду кэш настроек (11 с)…');
  await new Promise((r) => setTimeout(r, 11_000));

  for (const [what, body] of [
    ['текст', message(1, { text: 'хочу себя космонавтом' })],
    ['/start', message(2, { text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] })],
    ['фото', message(3, { photo: [{ file_id: 'x', file_unique_id: 'y', width: 1, height: 1 }] })],
    ['кнопка-подсказка', tapFixture],
  ] as const) {
    const res = await post(body);
    check(res.status === 200, `вебхук ответил 200 на ${what}`, String(res.status));
  }

  console.log('жду 8 с — если бы агент проснулся, он успел бы завести диалог…');
  await new Promise((r) => setTimeout(r, 8_000));
  const t = await traces();
  check(!t.user, 'участник в базе не заведён (до команд и агента не дошло)', JSON.stringify(t));
  check(t.messages === 0, 'в истории ни одного сообщения', String(t.messages));
} finally {
  await settings.set('bot.mode', before);
  console.log(`режим вернул: ${await settings.get('bot.mode')}`);
}

console.log(fail ? `\n✗ провалено: ${fail}` : '\n✓ спящий бот глушит всё и не зовёт агента');
process.exit(fail ? 1 : 0);
