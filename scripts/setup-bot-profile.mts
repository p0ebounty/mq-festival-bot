/**
 * Оформление профиля бота: аватар, имя, описания, меню команд.
 *
 *   APP_ENV=prod tsx scripts/setup-bot-profile.mts [--avatar путь.jpg] [--no-avatar]
 *
 * Аватар, если не передан файл, рисуется через kie.ai — тратит одну
 * генерацию. Всё остальное бесплатно.
 *
 * Идемпотентно: гоняйте сколько угодно, Telegram просто перезапишет поля.
 *
 * ⚠️ Смотрит на APP_ENV: без него оформит DEV-бота. Это сделано нарочно —
 * лучше лишний раз указать стенд, чем случайно переписать прод.
 */
import { config as loadEnv } from 'dotenv';
import { readFile } from 'node:fs/promises';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });

const APP_ENV = process.env.APP_ENV ?? 'dev';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error('нет TELEGRAM_BOT_TOKEN'); process.exit(1); }

const args = process.argv.slice(2);
const argOf = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const skipAvatar = args.includes('--no-avatar');

const api = (m: string) => `https://api.telegram.org/bot${TOKEN}/${m}`;

async function call(method: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(api(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { ok: boolean; description?: string };
  console.log(`  ${json.ok ? '✓' : '✗'} ${method}${json.ok ? '' : ` — ${json.description}`}`);
  return json.ok;
}

const me = await (await fetch(api('getMe'))).json() as { result?: { username?: string; first_name?: string } };
console.log(`Оформляю ${APP_ENV}-бота: @${me.result?.username} («${me.result?.first_name}»)\n`);

// ── тексты ──────────────────────────────────────────────────────────
//
// Имя видно в списке чатов, короткое описание — в карточке бота под именем,
// длинное — на пустом экране до первого сообщения. Именно длинное читает
// человек, который открыл бота и не знает, что делать, поэтому там не
// реклама, а инструкция одной фразой.

const NAME = APP_ENV === 'prod' ? 'MagnaQore · Лидер' : 'MQ dev';

const SHORT = 'Делаю картинки про будущее: ты в профессии мечты и миры, которые меняются одной фразой.';

const ABOUT = [
  'Фестивальный бот центра «Лидер» и MagnaQore.',
  '',
  'Пришли своё фото — покажу тебя в профессии будущего: космонавтом, врачом, инженером, кем захочешь.',
  'Или скажи «дай мир» — получишь готовую картинку и будешь менять её одной фразой: погоду, стиль, жителей.',
  '',
  'Просто пиши словами, кнопки не нужны.',
].join('\n');

console.log('тексты профиля:');
await call('setMyName', { name: NAME });
await call('setMyShortDescription', { short_description: SHORT });
await call('setMyDescription', { description: ABOUT });

// ── меню команд ─────────────────────────────────────────────────────
//
// Команд намеренно мало: бот — это ОДИН диалог, а не меню (ADR 0003).
// В списке только то, что человек ищет глазами, когда растерялся.
console.log('\nменю команд:');
await call('setMyCommands', {
  commands: [
    { command: 'start', description: 'начать заново' },
    { command: 'help', description: 'что тут можно делать' },
    { command: 'balance', description: 'сколько осталось токенов' },
  ],
  scope: { type: 'default' },
});
await call('setChatMenuButton', { menu_button: { type: 'commands' } });

// ── аватар ──────────────────────────────────────────────────────────
if (skipAvatar) {
  console.log('\nаватар: пропущен (--no-avatar)');
  process.exit(0);
}

let photo: Buffer;
const given = argOf('avatar');
if (given) {
  photo = await readFile(given);
  console.log(`\nаватар: беру файл ${given}`);
} else {
  console.log('\nаватар: рисую через kie.ai (одна генерация)…');
  const { KieClient, buildCreateTask, planModels } = await import('@mq/core');
  const { createDb } = await import('@mq/db');
  const { settings } = await import('@mq/db/schema');
  const { eq } = await import('drizzle-orm');
  const { decryptSecret, isEncrypted } = await import('@mq/config');

  const db = createDb(process.env.DATABASE_URL!, { max: 1 });
  const [row] = await db.select().from(settings).where(eq(settings.key, 'kie.apiKey')).limit(1);
  const key = row?.value && isEncrypted(row.value)
    ? decryptSecret(row.value, process.env.SECRETS_ENC_KEY!)
    : (row?.value ?? process.env.KIE_API_KEY ?? '');
  if (!key) { console.error('нет ключа kie.ai'); process.exit(1); }

  const kie = new KieClient({ getApiKey: () => key, baseUrl: process.env.KIE_API_BASE });

  // Квадрат, крупная фигура по центру, без текста: аватар Telegram режет
  // в круг и показывает размером с ноготь.
  const prompt = [
    'A friendly robot artist mascot, head and shoulders, centered, facing forward.',
    'Holding a glowing paintbrush that leaves a trail of colourful light.',
    'Deep indigo background with soft violet and teal glow.',
    'Bold simple shapes, clean vector-like illustration, high contrast,',
    'readable when scaled down to a tiny circular avatar.',
    'No text, no letters, no watermarks, no logos.',
  ].join(' ');

  const model = planModels('text_to_image', { prompt, aspectRatio: '1:1', quality: 'standard' })[0]!;
  const taskId = await kie.createTask(buildCreateTask(model, { prompt, aspectRatio: '1:1', quality: 'standard' }));
  console.log(`  задача ${taskId} (${model.id}), жду…`);

  let url: string | undefined;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const rec = await kie.getTask(taskId);
    if (rec.state === 'success') { url = rec.resultUrls[0]; break; }
    if (rec.state === 'fail') { console.error(`  не нарисовалось: ${rec.failMessage}`); process.exit(1); }
  }
  if (!url) { console.error('  не дождался результата'); process.exit(1); }

  photo = Buffer.from(await (await fetch(url)).arrayBuffer());
  console.log(`  готово, ${Math.round(photo.length / 1024)} КБ`);
}

// ⚠️ Метод называется setMyProfilePhoto, и файл к нему цепляется НЕ
// напрямую: `photo` — это объект InputProfilePhoto со ссылкой attach://,
// а сам файл идёт отдельным полем. Проверено запросами к API:
// `setMyPhoto` не существует вовсе, а `photo=@файл` отвечает
// «photo isn't specified».
const form = new FormData();
form.set('photo', JSON.stringify({ type: 'static', photo: 'attach://pic' }));
form.set('pic', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'avatar.jpg');
const res = await fetch(api('setMyProfilePhoto'), { method: 'POST', body: form });
const json = await res.json() as { ok: boolean; description?: string };
console.log(`  ${json.ok ? '✓' : '✗'} setMyProfilePhoto${json.ok ? '' : ` — ${json.description}`}`);

// Кладём рядом, чтобы второй стенд оформить тем же файлом и не тратить
// ещё одну генерацию.
if (!given) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile('docs/experiments/assets/bot-avatar.jpg', photo);
  console.log('  файл сохранён: docs/experiments/assets/bot-avatar.jpg');
}

process.exit(0);
