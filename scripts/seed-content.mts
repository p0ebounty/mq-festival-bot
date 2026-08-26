/**
 * Наполнение каталога фестиваля: профессии и пул базовых миров.
 *   APP_ENV=dev tsx scripts/seed-content.mts
 * Идемпотентно: существующее не трогает, недостающие миры догенерирует.
 * Генерация миров тратит кредиты (~8 на мир).
 */
import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { createContext } = await import('../apps/bot/src/context.js');
const { PROFESSIONS, BASE_WORLDS } = await import('@mq/db');
const { professions, baseWorlds } = await import('@mq/db/schema');
const { getModel, buildCreateTask, ingestRemote } = await import('@mq/core');

const app = createContext();

console.log('=== профессии ===');
let added = 0;
for (const p of PROFESSIONS) {
  const res = await app.db.insert(professions).values({
    slug: p.slug, title: p.title, description: p.description,
    promptFragment: p.promptFragment, sortOrder: p.sortOrder,
  }).onConflictDoNothing({ target: professions.slug });
  if (res.count) { added++; console.log(`  + ${p.title}`); }
}
console.log(`добавлено: ${added}, всего в каталоге: ${(await app.db.select().from(professions)).length}`);

console.log('\n=== базовые миры ===');
const model = getModel('nano-banana-2')!;
for (const w of BASE_WORLDS) {
  const [exists] = await app.db.select().from(baseWorlds).where(eq(baseWorlds.title, w.title)).limit(1);
  if (exists) { console.log(`  ↺ «${w.title}» уже есть`); continue; }

  process.stdout.write(`  … «${w.title}» `);
  try {
    const taskId = await app.kie.createTask(
      buildCreateTask(model, { prompt: w.prompt, aspectRatio: '16:9', quality: 'standard' }));
    const rec = await app.kie.waitForTask(taskId, { timeoutMs: 240_000, intervalMs: 5000 });
    const url = rec.resultUrls[0];
    if (!url) { console.log('✗ без ссылки'); continue; }

    const stored = await ingestRemote(url, app.storage, { subdir: 'worlds' });
    const m = await app.media.create({
      path: stored.relPath, mimeType: stored.mimeType, bytes: stored.bytes,
      sha256: stored.sha256, source: 'seed',
    });
    await app.db.insert(baseWorlds).values({
      title: w.title, mediaId: m.id, sourcePrompt: w.prompt,
    });
    console.log(`✓ ${(stored.bytes / 1024).toFixed(0)}КБ, ${rec.creditsConsumed} кредитов`);
  } catch (e) {
    console.log(`✗ ${(e as Error).message.slice(0, 70)}`);
  }
}

const worlds = await app.db.select().from(baseWorlds);
console.log(`\nмиров в пуле: ${worlds.length}`);
console.log(`кредитов осталось: ${await app.kie.getCredits()}`);
process.exit(0);
