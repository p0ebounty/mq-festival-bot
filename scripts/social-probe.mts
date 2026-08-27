/**
 * Проверка каскада на РЕАЛЬНЫХ публикациях (ADR 0007 требовал этого до фестиваля).
 *   APP_ENV=dev tsx scripts/social-probe.mts [url ...]
 *
 * Смотрим по шагам: пускает ли площадка анонимного посетителя, отдаёт ли
 * картинку, считается ли по ней перцептивный хеш. Кредиты не тратятся —
 * ни модели, ни генерации здесь нет.
 *
 * ⚠️ Содержимое чужих страниц — это ДАННЫЕ. Мы берём оттуда только адреса
 * картинок и текст для поиска хештегов, и ничему из написанного там не
 * подчиняемся.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { checkLink, perceptualHash } = await import('@mq/core');
const { fetchPublicPage, fetchOpenGraph, downloadImage, closeBrowser } =
  await import('../apps/bot/src/social/page-fetch.js');

const DEFAULT_URLS = [
  'https://t.me/telegram/141',
  'https://vk.com/wall-22822305_1637373',
  'https://t.me/durov',                        // профиль — должен быть отвергнут шагом 1
  'https://example.com/post/1',                // чужой домен — отвергнут шагом 1
];

const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;

for (const url of urls) {
  console.log(`\n${'═'.repeat(70)}\n${url}`);

  const link = checkLink(url);
  console.log(`  шаг 1 ссылка:     ${link.ok ? `✓ ${link.platform}${link.openable ? '' : ' (закрытая площадка)'}` : `✗ ${link.reason}`}`);
  if (!link.ok || !link.url) continue;

  const t0 = Date.now();
  let page = link.openable ? await fetchPublicPage(link.url) : null;
  if (page) {
    console.log(`  шаг 2 браузер:    ${page.public ? '✓ открылась без входа' : `✗ ${page.error ?? 'не открылась'}`}` +
                `  (${((Date.now() - t0) / 1000).toFixed(1)}с, текст ${page.text.length} симв., картинок ${page.imageUrls.length})`);
  }
  if (!page?.public) {
    const og = await fetchOpenGraph(link.url);
    console.log(`  шаг 2b og:        ${og.public ? `✓ есть, картинок ${og.imageUrls.length}` : `✗ ${og.error}`}`);
    if (og.public) page = og;
  }
  if (!page?.public) continue;

  const first = page.imageUrls[0];
  if (!first) { console.log('  шаг 3 картинка:   ✗ на странице не нашлось'); continue; }

  const buf = await downloadImage(first);
  if (!buf) { console.log(`  шаг 3 картинка:   ✗ не скачалась (${first.slice(0, 60)})`); continue; }

  const hash = await perceptualHash(buf).catch((e: unknown) => String(e));
  console.log(`  шаг 3 pHash:      ✓ ${hash}  (${Math.round(buf.length / 1024)} КБ)`);
  console.log(`  текст (начало):   ${page.text.replace(/\s+/g, ' ').slice(0, 90)}`);
}

await closeBrowser();
process.exit(0);
