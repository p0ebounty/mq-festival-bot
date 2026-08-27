/**
 * Сквозная проверка бонуса за репост на РЕАЛЬНЫХ публикациях.
 *   APP_ENV=dev tsx scripts/social-e2e.mts
 *
 * Как устроен честный тест «участник выложил нашу картинку»: берём реальный
 * публичный пост, скачиваем его картинку и кладём её себе как результат
 * генерации тестового участника. Дальше каскад идёт по-настоящему —
 * браузер, скачивание, pHash, — и обязан узнать картинку.
 *
 * Тратит один вызов модели на отрицательном случае (там работает
 * проверяющий). Генерации картинок не запускаются.
 */
import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { createContext } = await import('../apps/bot/src/context.js');
const { makeVerifySocialTool } = await import('../apps/bot/src/agent/tools/verify-social.js');
const { makeMediaUploader } = await import('../apps/bot/src/bot/media-out.js');
const { fetchOpenGraph, downloadImage, closeBrowser } = await import('../apps/bot/src/social/page-fetch.js');
const { perceptualHash } = await import('@mq/core');
const { users, generations, socialClaims, tokenLedger } = await import('@mq/db/schema');

/** Пост, картинку которого мы «выдадим» за свою генерацию. */
const MINE = process.env.E2E_POST_URL ?? 'https://t.me/telegram/141';
/** Чужой пост — на нём каскад обязан отказать. */
const FOREIGN = process.env.E2E_FOREIGN_URL ?? 'https://vk.com/wall-22822305_1637373';

const app = createContext();
const log = {
  info: (o: unknown, m?: string) => console.log('     ·', m ?? '', JSON.stringify(o).slice(0, 120)),
  warn: (o: unknown, m?: string) => console.log('     ⚠', m ?? '', JSON.stringify(o).slice(0, 120)),
};
app.uploadStoredMedia = makeMediaUploader(app, log as never);
const tool = makeVerifySocialTool(app);

const TG_ID = 999000088n;
const [old] = await app.db.select().from(users).where(eq(users.tgId, TG_ID)).limit(1);
if (old) await app.db.delete(users).where(eq(users.id, old.id));
const user = await app.users.ensure({ tgId: TG_ID, firstName: 'Тест', username: 'e2e_social' }, 10);
console.log(`участник заведён, баланс ${user.tokenBalance}`);

// ── «его генерация» = картинка из настоящего поста ──
const og = await fetchOpenGraph(MINE);
const imgUrl = og.imageUrls[0];
if (!imgUrl) { console.log(`✗ у ${MINE} нет og:image — возьми другой пост`); process.exit(1); }
const buf = await downloadImage(imgUrl);
if (!buf) { console.log('✗ картинка поста не скачалась'); process.exit(1); }

const stored = await app.storage.save(buf, { subdir: 'generations', ext: 'jpg', mimeType: 'image/jpeg' });
const media = await app.media.create({
  path: stored.relPath, mimeType: 'image/jpeg', bytes: buf.length,
  sha256: stored.sha256, source: 'kie',
});
await app.media.rememberPhash(media.id, await perceptualHash(buf));
const gen = await app.generations.create({
  userId: user.id, kind: 'image', userPrompt: 'тестовая генерация',
  model: 'test', tokensCharged: 1,
});
await app.generations.completeSuccess(gen.id, { outputMediaId: media.id });
console.log(`«его картинка» подготовлена: ${media.id.slice(0, 8)}`);

const ctx = { userId: user.id, conversationId: 'c', chatId: 1n, userMessage: MINE, log } as never;

async function run(title: string, url: string) {
  console.log(`\n${'═'.repeat(66)}\n${title}\n  ${url}`);
  const t0 = Date.now();
  const r = await tool.run({ url }, ctx);
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.summary}   (${((Date.now() - t0) / 1000).toFixed(1)}с)`);
  if (r.data) console.log(`  данные: ${JSON.stringify(r.data)}`);
  return r;
}

await run('1. Ссылка на профиль — отказ на первом шаге, без сети', 'https://t.me/durov');
await run('2. Чужая площадка — отказ на первом шаге', 'https://example.com/p/1');
await run('3. НАША картинка на публичном посте — должен начислить', MINE);
await run('4. Та же ссылка второй раз — повтор не проходит', MINE);
await run('5. Чужой пост, нашей картинки нет — должен отказать', FOREIGN);

console.log(`\n${'═'.repeat(66)}\nЧТО ЛЕГЛО В БАЗУ`);
const [after] = await app.db.select().from(users).where(eq(users.id, user.id)).limit(1);
console.log(`баланс: ${after!.tokenBalance}`);

const claims = await app.db.select().from(socialClaims).where(eq(socialClaims.userId, user.id));
for (const c of claims) {
  console.log(`  [${c.status}] ${c.evidence} +${c.tokensAwarded} — ${c.verdictReason?.slice(0, 70)}`);
}

const ledger = await app.ledger.forUser(user.id);
console.log('журнал токенов:');
for (const l of ledger.reverse()) console.log(`  ${l.delta > 0 ? '+' : ''}${l.delta} → ${l.balanceAfter}  (${l.reason})`);
const sum = await app.ledger.sumForUser(user.id);
console.log(`сверка: сумма журнала ${sum} vs баланс ${after!.tokenBalance} → ${sum === after!.tokenBalance ? '✓ сходится' : '✗ РАСХОЖДЕНИЕ'}`);

await closeBrowser();
process.exit(0);
