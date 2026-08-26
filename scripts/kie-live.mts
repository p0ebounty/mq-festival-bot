/**
 * Живая проверка kie.ai: тратит кредиты. Запускать вручную.
 *   APP_ENV=dev tsx scripts/kie-live.mts <команда>
 *
 * Команды:
 *   credits            — остаток кредитов
 *   routing-bench      — замер: какая модель лучше под сценарии ТЗ
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs/promises';
import { eq } from 'drizzle-orm';

const appEnv = process.env.APP_ENV ?? 'dev';
loadEnv({ path: path.resolve(process.cwd(), `.env.${appEnv}`) });

const { createDb } = await import('@mq/db');
const { settings } = await import('@mq/db/schema');
const { decryptSecret, isEncrypted } = await import('@mq/config');
const { KieClient, buildCreateTask, getModel } = await import('@mq/core');

const db = createDb(process.env.DATABASE_URL!, { max: 2 });

async function apiKey(): Promise<string> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'kie.apiKey')).limit(1);
  const v = row?.value ?? '';
  if (!v) throw new Error('ключ kie.ai не задан в админке');
  return isEncrypted(v) ? decryptSecret(v, process.env.SECRETS_ENC_KEY!) : v;
}

const client = new KieClient({
  getApiKey: apiKey,
  baseUrl: process.env.KIE_API_BASE,
  onRetry: (i) => console.log(`   ↻ повтор #${i.attempt} через ${i.delayMs}мс: ${i.reason}`),
});

const OUT = 'docs/experiments/assets';

async function gen(modelId: string, req: Record<string, unknown>, tag: string, reuse = false) {
  const file0 = `${OUT}/${tag.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.jpg`;
  if (reuse) {
    try {
      const st = await fs.stat(file0);
      console.log(`   ${tag.padEnd(34)} ↺ уже есть (${(st.size / 1024).toFixed(0)}КБ), не тратим кредиты`);
      return { file: file0, url: '', secs: 0, credits: 0 };
    } catch { /* нет файла — генерируем */ }
  }
  const model = getModel(modelId);
  if (!model) throw new Error(`нет модели ${modelId}`);
  const payload = buildCreateTask(model, req as never);
  const t0 = Date.now();
  process.stdout.write(`   ${tag.padEnd(34)} `);
  try {
    const taskId = await client.createTask(payload);
    const rec = await client.waitForTask(taskId, { timeoutMs: 240_000, intervalMs: 4000 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const url = rec.resultUrls[0];
    if (!url) { console.log(`✗ success без URL`); return null; }
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    await fs.mkdir(OUT, { recursive: true });
    const file = `${OUT}/${tag.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.jpg`;
    await fs.writeFile(file, buf);
    console.log(`✓ ${secs}с  ${(buf.length / 1024).toFixed(0)}КБ  ${rec.creditsConsumed ?? '?'} кред.`);
    return { file, url, secs: Number(secs), credits: rec.creditsConsumed ?? 0 };
  } catch (e) {
    console.log(`✗ ${(e as Error).message.slice(0, 90)}`);
    return null;
  }
}

const cmd = process.argv[2] ?? 'credits';

if (cmd === 'credits') {
  console.log('кредитов осталось:', await client.getCredits());
  process.exit(0);
}

if (cmd === 'routing-bench') {
  console.log(`\nСтарт. Кредитов: ${await client.getCredits()}\n`);

  // ── 1. Исходники. Портрет генерируем синтетический: настоящее фото
  //      участника для теста брать незачем — это персональные данные.
  console.log('1) Готовим исходники');
  const portrait = await gen('nano-banana-2', {
    prompt:
      'Studio portrait photograph of a young woman with curly dark hair, freckles, ' +
      'green eyes, neutral grey background, soft even lighting, sharp focus, ' +
      'looking directly at camera, photorealistic',
    aspectRatio: '1:1',
  }, 'base-portrait', true);

  const world = await gen('nano-banana-2', {
    prompt:
      'A medieval stone castle on a green hill, sunny clear day, blue sky with light clouds, ' +
      'knights with banners at the gate, watercolour painting style',
    aspectRatio: '16:9',
  }, 'base-world', true);

  if (!portrait || !world) { console.log('исходники не готовы, стоп'); process.exit(1); }

  // Заливаем к kie.ai, чтобы отдать моделям как image_input
  console.log('\n2) Загружаем исходники в kie.ai');
  const up = async (file: string, name: string) => {
    const b64 = (await fs.readFile(file)).toString('base64');
    const r = await client.uploadBase64({ base64: `data:image/jpeg;base64,${b64}`, fileName: name });
    console.log(`   ${name.padEnd(34)} ✓`);
    return r.downloadUrl;
  };
  const portraitUrl = await up(portrait.file, 'bench-portrait.jpg');
  const worldUrl = await up(world.file, 'bench-world.jpg');

  // ── 2. Сценарий 1 ТЗ: лицо → профессия. Ключевое — узнаваемость лица.
  console.log('\n3) Сценарий 1 ТЗ: фото → космонавт (проверяем сохранение лица)');
  const p1 =
    'Show this exact same person as a professional astronaut. ' +
    'Keep her facial features, hair and identity strictly unchanged. ' +
    'Dress her in a detailed white spacesuit, helmet under her arm, ' +
    'standing in a bright space station corridor. Photorealistic.';
  const s1 = {
    nano: await gen('nano-banana-2', { prompt: p1, images: [portraitUrl], aspectRatio: '1:1' }, 's1-nano-banana-2'),
    gpt: await gen('gpt-image-2-i2i', { prompt: p1, images: [portraitUrl], aspectRatio: '1:1' }, 's1-gpt-image-2'),
  };

  // ── 3. Сценарий 2 ТЗ: одна фраза меняет мир. Ключевое — поменять
  //      ровно требуемое, не разрушив сцену.
  console.log('\n4) Сценарий 2 ТЗ: замок → шторм и роботы (проверяем точность правки)');
  const p2 = 'Change the weather to a violent storm and replace the knights with robots. Keep everything else the same.';
  const s2 = {
    nano: await gen('nano-banana-2', { prompt: p2, images: [worldUrl], aspectRatio: '16:9' }, 's2-nano-banana-2'),
    gpt: await gen('gpt-image-2-i2i', { prompt: p2, images: [worldUrl], aspectRatio: '16:9' }, 's2-gpt-image-2'),
  };

  console.log(`\nОстаток кредитов: ${await client.getCredits()}`);
  console.log('\nИтог по скорости:');
  for (const [name, r] of Object.entries({ ...s1, ...s2 })) {
    if (r) console.log(`   ${name.padEnd(8)} ${String(r.secs).padStart(6)}с  ${r.credits} кредитов`);
  }
  await fs.writeFile('docs/experiments/bench-raw.json', JSON.stringify({ s1, s2 }, null, 2));
  process.exit(0);
}

if (cmd === 'e2e-generation') {
  // Полный путь фазы 4: createTask → callback от kie.ai → файл на нашем диске.
  const { users, generations, media } = await import('@mq/db/schema');
  const { generationsRepo } = await import('@mq/db');
  const { eq } = await import('drizzle-orm');
  const repo = generationsRepo(db);

  const PUBLIC_URL = process.env.PUBLIC_URL!;
  console.log(`\nПроверка сквозного пути. Callback придёт на ${PUBLIC_URL}/hooks/kie\n`);

  // тестовый участник
  const tgId = 999000001n;
  let [user] = await db.select().from(users).where(eq(users.tgId, tgId)).limit(1);
  if (!user) {
    [user] = await db.insert(users).values({
      tgId, username: 'e2e_probe', firstName: 'E2E', tokenBalance: 100,
    }).returning();
    console.log('создан тестовый участник');
  }

  const model = getModel('nano-banana-2')!;
  const req = { prompt: 'A single red maple leaf on white background, minimal, studio light', aspectRatio: '1:1' as const };

  const gen = await repo.create({
    userId: user!.id, kind: 'image', model: model.id,
    userPrompt: 'красный кленовый лист',
    finalPrompt: req.prompt, tokensCharged: 1,
  });
  console.log('1) запись generations создана:', gen.id);

  const payload = buildCreateTask(model, req, `${PUBLIC_URL}/hooks/kie`);
  const taskId = await client.createTask(payload);
  await repo.markSubmitted(gen.id, taskId, model.kieModel);
  console.log('2) задача поставлена, taskId =', taskId);

  console.log('3) ждём callback (НЕ опрашиваем — проверяем именно вебхук)...');
  const deadline = Date.now() + 210_000;
  let final: typeof gen | undefined;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const [row] = await db.select().from(generations).where(eq(generations.id, gen.id)).limit(1);
    process.stdout.write(`   статус: ${row!.status}\r`);
    if (row!.status === 'success' || row!.status === 'failed') { final = row as never; break; }
  }
  console.log('');

  if (!final) { console.log('✗ callback не пришёл за 210 с'); process.exit(1); }
  if (final.status !== 'success') {
    console.log('✗ задача завершилась ошибкой:', final.failMessage); process.exit(1);
  }

  const [m] = await db.select().from(media).where(eq(media.id, final.outputMediaId!)).limit(1);
  console.log('4) статус:', final.status, '| кредитов:', final.creditsConsumed, '| время:', final.durationMs, 'мс');
  console.log('5) media:', m!.path, `${(m!.bytes / 1024).toFixed(0)}КБ`, m!.mimeType);

  const onDisk = `${process.env.MEDIA_ROOT}/${m!.path}`;
  const st = await fs.stat(onDisk);
  console.log('6) файл на диске:', onDisk, `${(st.size / 1024).toFixed(0)}КБ`);

  const url = `${PUBLIC_URL}/media/${m!.id}`;
  const head = await fetch(url, { method: 'GET' });
  console.log('7) отдаётся по HTTPS:', url, '→', head.status, head.headers.get('content-type'));

  console.log(st.size === m!.bytes && head.ok ? '\n✅ сквозной путь работает' : '\n✗ расхождение');
  process.exit(st.size === m!.bytes && head.ok ? 0 : 1);
}

console.log('неизвестная команда:', cmd);
process.exit(2);
