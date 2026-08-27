/**
 * Замер главного умения бота: выбрать ПРАВИЛЬНУЮ картинку для правки.
 *   APP_ENV=dev tsx scripts/image-pick.mts [модель ...]
 *
 * Именно здесь бот ошибался живьём — накладывал правку на чужой снимок.
 * Инструменты замоканы: генерация не запускается, кредиты на картинки не
 * тратятся. Нас интересует только одно — какой image_id назовёт модель.
 *
 * Роль «фотографий участника» играют два заведомо разных кадра из пула
 * стартовых миров: замок и станция на Марсе. Спутать их невозможно, а
 * значит промах будет промахом модели, а не следствием похожих картинок.
 */
import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AgentTool, ChatProvider, AgentMessage } from '@mq/core';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });

const { createDb } = await import('@mq/db');
const { settings, baseWorlds, media } = await import('@mq/db/schema');
const { decryptSecret, isEncrypted } = await import('@mq/config');
const {
  ToolRegistry, runAgent, OpenAiChatProvider, ResponsesApiProvider,
  buildSystemPrompt, DEFAULT_SYSTEM_PROMPT, LocalStorage, KieClient,
} = await import('@mq/core');
const { imageContextMessages } = await import('../apps/bot/src/agent/images.js');

const db = createDb(process.env.DATABASE_URL!, { max: 1 });
const [row] = await db.select().from(settings).where(eq(settings.key, 'kie.apiKey')).limit(1);
const key = isEncrypted(row!.value!) ? decryptSecret(row!.value!, process.env.SECRETS_ENC_KEY!) : row!.value!;

const storage = new LocalStorage(process.env.MEDIA_ROOT!);
const kie = new KieClient({ getApiKey: () => key, baseUrl: process.env.KIE_API_BASE });

/**
 * Заливает кадр из пула в kie.ai и отдаёт URL, по которому его прочитает модель.
 *
 * ⚠️ Имя файла берём из `slug`, а НЕ из русского названия: `\W` в JS без
 * флага `u` считает кириллицу не-буквой, поэтому `title.replace(/\W+/g,'-')`
 * схлопывал оба названия в один и тот же «-». Обе картинки уезжали под
 * одинаковым именем, и тест сравнивал кадр сам с собой.
 */
async function worldUrl(title: string, slug: string): Promise<string> {
  const [w] = await db.select({ path: media.path, mime: media.mimeType })
    .from(baseWorlds).innerJoin(media, eq(media.id, baseWorlds.mediaId))
    .where(eq(baseWorlds.title, title)).limit(1);
  if (!w) throw new Error(`нет мира «${title}» — прогони scripts/seed-content.mts`);
  const buf = await storage.read(w.path);
  const up = await kie.uploadBase64({
    base64: `data:${w.mime};base64,${buf.toString('base64')}`,
    fileName: `pick-${slug}.jpg`,
  });
  console.log(`  ${slug}: ${up.downloadUrl}`);
  return up.downloadUrl;
}

console.log('заливаю кадры для теста…');
const CASTLE = await worldUrl('средневековый замок', 'castle');
const MARS = await worldUrl('станция на Марсе', 'mars');
if (CASTLE === MARS) throw new Error('обе картинки получили один URL — тест бессмыслен');

// ── заглушки инструментов ──
let picked: string | null = null;
const calls: string[] = [];

function stub(name: string, description: string, props: Record<string, unknown>, required: string[] = []): AgentTool<Record<string, unknown>> {
  return {
    name, description,
    input: z.object({}).passthrough(),
    parameters: { type: 'object', properties: props, required },
    async run(args) {
      calls.push(name);
      const id = (args as { image_id?: unknown }).image_id;
      if (typeof id === 'string') picked = id;
      return {
        ok: true,
        summary: 'Задача поставлена, картинка придёт через минуту.',
        note: 'Скажи это своими словами и не жди результат.',
      };
    },
  };
}

function registry() {
  return new ToolRegistry()
    .register(stub('edit_image',
      'Изменить одну из картинок диалога. image_id — id из списка «Картинки в этом диалоге». ' +
      'Бери ту, о которой участник говорит СЕЙЧАС, а не просто последнюю.',
      { image_id: { type: 'string' }, change: { type: 'string' }, caption: { type: 'string' } },
      ['image_id', 'change']))
    .register(stub('generate_image',
      'Нарисовать картинку с нуля по тексту. НЕ вызывай, если подходящая картинка уже есть в диалоге.',
      { prompt: { type: 'string' } }, ['prompt']))
    .register(stub('get_base_world', 'Выдать участнику стартовый мир для игры.', {}));
}

function providerFor(model: string): ChatProvider {
  const getApiKey = () => key;
  if (model.startsWith('gpt-5')) return new ResponsesApiProvider({ getApiKey, model, effort: 'low' });
  return new OpenAiChatProvider({
    getApiKey, model, buildUrl: (m) => `https://api.kie.ai/${m}/v1/chat/completions`,
  });
}

const NOW = new Date('2026-08-27T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

interface Img { id: string; origin: 'user' | 'bot'; url: string; label: string; at: Date }

interface Case {
  name: string;
  images: Img[];
  said: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** Какой id обязан выбрать. */
  expectPick?: string;
  /** Провал, если хоть что-то вызвал. */
  expectNoTools?: boolean;
  banPhrases?: RegExp;
}

const CASTLE_IMG: Img = { id: 'img1', origin: 'user', url: CASTLE, label: 'фото, которое прислал участник', at: ago(9) };
const MARS_IMG: Img = { id: 'img3', origin: 'user', url: MARS, label: 'фото, которое прислал участник', at: ago(3) };

const CASES: Case[] = [
  {
    name: 'вопрос про фото — не команда',
    images: [CASTLE_IMG],
    said: [{ role: 'user', text: 'Видишь?' }],
    expectNoTools: true,
  },
  {
    name: 'одна картинка — берёт её',
    images: [CASTLE_IMG],
    said: [
      { role: 'user', text: 'Видишь?' },
      { role: 'assistant', text: 'Вижу средневековый замок на холме.' },
      { role: 'user', text: 'сделай ночь' },
    ],
    expectPick: 'img1',
  },
  {
    name: '⭐ два разных снимка, просьба про ПЕРВЫЙ',
    // Ровно случай владельца: кот, потом собака, потом «добавь коту мороженое».
    images: [CASTLE_IMG, MARS_IMG],
    said: [
      { role: 'user', text: 'Видишь?' },
      { role: 'assistant', text: 'Вижу средневековый замок на холме.' },
      { role: 'user', text: 'А тут что у меня?' },
      { role: 'assistant', text: 'Это станция на Марсе, красный грунт и купола.' },
      { role: 'user', text: 'добавь на замок флаг' },
    ],
    expectPick: 'img1',
  },
  {
    name: '⭐ цепочка правок — берёт свежую версию, а не оригинал',
    images: [
      CASTLE_IMG,
      { id: 'img2', origin: 'bot', url: CASTLE, label: 'мы нарисовали: «Твой замок при дневном свете»', at: ago(5) },
    ],
    said: [
      { role: 'user', text: 'сделай день' },
      { role: 'assistant', text: 'Сделал дневной свет, остальное не трогал.' },
      { role: 'user', text: 'круто, а теперь добавь локомотив' },
    ],
    expectPick: 'img2',
  },
  {
    name: '⭐ прямая просьба вернуться к оригиналу',
    images: [
      CASTLE_IMG,
      { id: 'img2', origin: 'bot', url: CASTLE, label: 'мы нарисовали: «Твой замок при дневном свете»', at: ago(5) },
    ],
    said: [
      { role: 'user', text: 'сделай день' },
      { role: 'assistant', text: 'Сделал дневной свет.' },
      { role: 'user', text: 'нет, возьми исходное фото замка и сделай на нём дождь' },
    ],
    expectPick: 'img1',
  },
  {
    name: 'не проговаривает свои мысли вслух',
    images: [CASTLE_IMG],
    said: [
      { role: 'user', text: 'Видишь?' },
      { role: 'assistant', text: 'Вижу замок.' },
      { role: 'user', text: 'Не понял' },
    ],
    banPhrases: /^(Артём говорит|Участник говорит|Нужно объяснить|Нужно коротко|Сейчас надо|Пользователь )/i,
  },
];

const MODELS = process.argv.slice(2).length ? process.argv.slice(2) : ['gpt-5-5'];
const score: Record<string, number> = {};

for (const model of MODELS) {
  console.log(`\n${'═'.repeat(64)}\n### ${model}`);
  score[model] = 0;

  for (const c of CASES) {
    calls.length = 0;
    picked = null;

    const system = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
      firstName: 'Артём', tokenBalance: 10, costPerImage: 1, imageCount: c.images.length,
    });
    const imgMsgs: AgentMessage[] = imageContextMessages(c.images, NOW).map((m) => ({
      role: 'user' as const, text: m.text, ...(m.imageUrls ? { imageUrls: m.imageUrls } : {}),
    }));
    const history: AgentMessage[] = c.said.slice(0, -1).map((m) => ({ role: m.role, text: m.text }));
    const last: AgentMessage = { role: 'user', text: c.said[c.said.length - 1]!.text };

    const t0 = Date.now();
    try {
      const r = await runAgent({
        provider: providerFor(model), registry: registry(), system,
        messages: [...history, ...imgMsgs, last], maxIterations: 4,
        toolContext: {
          userId: 'u', conversationId: 'c', chatId: 1n,
          userMessage: last.text ?? '',
          images: c.images.map((i) => ({ id: i.id, url: i.url, origin: i.origin, label: i.label })),
          log: { info: () => {}, warn: () => {} },
        },
      });

      const why: string[] = [];
      if (c.expectNoTools && calls.length > 0) why.push(`вызвал ${calls.join(', ')}`);
      if (c.expectPick && picked !== c.expectPick) {
        why.push(`ожидался ${c.expectPick}, выбрал ${picked ?? 'ничего'}`);
      }
      if (c.banPhrases && c.banPhrases.test(r.text.trim())) why.push('проговорил свои мысли');

      if (why.length === 0) score[model]!++;
      console.log(`\n  ${why.length ? '✗' : '✓'} ${c.name}  (${((Date.now() - t0) / 1000).toFixed(1)}с)`);
      if (why.length) console.log(`      причина: ${why.join('; ')}`);
      console.log(`      ответ: "${r.text.replace(/\n/g, ' ').slice(0, 120)}"`);
      if (picked) console.log(`      выбрал: ${picked}`);
    } catch (e) {
      console.log(`\n  ✗ ${c.name} — ошибка: ${String(e).slice(0, 110)}`);
    }
  }
}

console.log(`\n${'═'.repeat(64)}\nИТОГ (из ${CASES.length}):`);
for (const [m, s] of Object.entries(score).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${m.padEnd(16)} ${s}/${CASES.length}`);
}
process.exit(0);
