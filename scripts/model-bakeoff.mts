/**
 * Сравнение моделей на РЕАЛЬНЫХ провалах из диалога владельца (26.08, 22:34).
 *   APP_ENV=dev tsx scripts/model-bakeoff.mts
 *
 * Инструменты — заглушки: нас интересует, какой инструмент модель выберет
 * и что скажет участнику, а не картинки. Кредиты почти не тратятся.
 */
import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AgentTool, ChatProvider, AgentMessage } from '@mq/core';
loadEnv({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });

const { createDb } = await import('@mq/db');
const { settings } = await import('@mq/db/schema');
const { decryptSecret, isEncrypted } = await import('@mq/config');
const {
  ToolRegistry, runAgent, OpenAiChatProvider, ResponsesApiProvider,
  buildSystemPrompt, DEFAULT_SYSTEM_PROMPT,
} = await import('@mq/core');

const db = createDb(process.env.DATABASE_URL!, { max: 1 });
const [row] = await db.select().from(settings).where(eq(settings.key, 'kie.apiKey')).limit(1);
const key = isEncrypted(row!.value!) ? decryptSecret(row!.value!, process.env.SECRETS_ENC_KEY!) : row!.value!;

// ── заглушки инструментов: только фиксируем вызовы ──
const calls: string[] = [];
function stub(name: string, description: string, props: Record<string, unknown>, fail?: string): AgentTool<Record<string, unknown>> {
  return {
    name, description,
    input: z.object({}).passthrough(),
    parameters: { type: 'object', properties: props },
    async run(args) {
      calls.push(`${name}(${JSON.stringify(args).slice(0, 70)})`);
      if (fail) return { ok: false, summary: fail, note: 'Скажи участнику своими словами, что не вышло.' };
      return { ok: true, summary: 'Задача поставлена, картинка придёт через минуту.',
               note: 'Скажи это своими словами и не жди результат.' };
    },
  };
}

function registry() {
  return new ToolRegistry()
    .register(stub('edit_photo',
      'Изменить фотографию, которую прислал участник, по его инструкции. Вызывай, когда участник ' +
      'прислал фото и ПРОСИТ что-то с ним сделать: «отправь в космос», «сделай ночью», «перекрась». ' +
      'НЕ вызывай, если участник просто спрашивает, что на фото. ' +
      'НЕ вызывай, если фото не присылали.',
      { change: { type: 'string' }, caption: { type: 'string' } }))
    .register(stub('transform_world',
      'Изменить МИР ИЗ ИГРЫ, который выдал get_base_world. ⚠️ Это НЕ про фотографии участника: ' +
      'если он прислал свой снимок и просит его изменить — нужен edit_photo.',
      { change: { type: 'string' } }, 'Мира из игры у участника нет.'))
    .register(stub('generate_image',
      'Нарисовать картинку с нуля по тексту. НЕ вызывай, если участник прислал фото и просит его изменить.',
      { prompt: { type: 'string' } }))
    .register(stub('get_base_world', 'Выдать участнику стартовый мир для игры.', {}));
}

function providerFor(model: string): ChatProvider {
  const getApiKey = () => key;
  if (model.startsWith('gpt-5')) {
    return new ResponsesApiProvider({ getApiKey, model, effort: 'low' });
  }
  return new OpenAiChatProvider({
    getApiKey, model, buildUrl: (m) => `https://api.kie.ai/${m}/v1/chat/completions`,
  });
}

const PHOTO = 'https://tempfile.redpandaai.co/kieai/437007/images/mqbot/vision-test.jpg';
const system = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
  firstName: 'Артём', tokenBalance: 10, costPerImage: 1,
});

interface Case {
  name: string;
  messages: AgentMessage[];
  /** Провал, если инструмент вызван (вопрос — не команда). */
  expectNoTools?: boolean;
  /** Провал, если вызван НЕ этот инструмент. */
  expectTool?: string;
  /** Провал, если в ответе есть эти признаки внутренней речи. */
  banPhrases?: RegExp;
}

const CASES: Case[] = [
  {
    name: '«Видишь?» с фото — вопрос, не команда',
    messages: [{ role: 'user', text: 'Видишь?', imageUrls: [PHOTO] }],
    expectNoTools: true,
  },
  {
    name: '«А можешь в красный перекрасить?» — про фото, не про мир',
    messages: [
      { role: 'user', text: 'Видишь?', imageUrls: [PHOTO] },
      { role: 'assistant', text: 'Вижу портрет девушки с кудрявыми волосами на сером фоне.' },
      { role: 'user', text: 'А можешь в красный перекрасить?' },
    ],
    expectTool: 'edit_photo',
  },
  {
    name: '«Не понял» — не проговаривать свои мысли вслух',
    messages: [
      { role: 'user', text: 'Видишь?', imageUrls: [PHOTO] },
      { role: 'assistant', text: 'Вижу портрет девушки.' },
      { role: 'user', text: 'А можешь в красный перекрасить?' },
      { role: 'assistant', text: 'У тебя пока нет мира, чтобы его перекрашивать!' },
      { role: 'user', text: 'Не понял' },
    ],
    banPhrases: /^(Артём говорит|Участник говорит|Нужно объяснить|Нужно коротко|Сейчас надо|Пользователь )/i,
  },
];

const MODELS = ['gemini-3-flash', 'gemini-3-pro', 'gpt-5-6-terra', 'gpt-5-5'];
const score: Record<string, number> = {};

for (const model of MODELS) {
  console.log(`\n${'═'.repeat(62)}\n### ${model}`);
  score[model] = 0;
  for (const c of CASES) {
    calls.length = 0;
    const t0 = Date.now();
    try {
      const r = await runAgent({
        provider: providerFor(model), registry: registry(), system,
        messages: c.messages, maxIterations: 4,
        toolContext: {
          userId: 'u', conversationId: 'c', chatId: 1n,
          userMessage: c.messages[c.messages.length - 1]!.text ?? '',
          lastImageUrl: PHOTO,
          log: { info: () => {}, warn: () => {} },
        },
      });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      let ok = true;
      const why: string[] = [];
      if (c.expectNoTools && calls.length > 0) { ok = false; why.push(`вызвал ${calls.join(', ')}`); }
      if (c.expectTool && !calls.some((x) => x.startsWith(c.expectTool!))) {
        ok = false; why.push(`ожидался ${c.expectTool}, вызвал ${calls.join(', ') || 'ничего'}`);
      }
      if (c.banPhrases && c.banPhrases.test(r.text.trim())) { ok = false; why.push('проговорил свои мысли'); }
      if (ok) score[model]!++;
      console.log(`\n  ${ok ? '✓' : '✗'} ${c.name}  (${secs}с)`);
      if (why.length) console.log(`      причина: ${why.join('; ')}`);
      console.log(`      ответ: "${r.text.replace(/\n/g, ' ').slice(0, 130)}"`);
      if (calls.length) console.log(`      инструменты: ${calls.join(', ').slice(0, 120)}`);
    } catch (e) {
      console.log(`\n  ✗ ${c.name} — ошибка: ${String(e).slice(0, 90)}`);
    }
  }
}

console.log(`\n${'═'.repeat(62)}\nИТОГ (из ${CASES.length} проверок):`);
for (const [m, s] of Object.entries(score).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${m.padEnd(16)} ${s}/${CASES.length}`);
}
process.exit(0);
