import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// .env.<APP_ENV> lives at the repo root; APP_ENV selects the stand.
const appEnv = process.env.APP_ENV ?? 'dev';
loadEnv({ path: new URL(`../../../.env.${appEnv}`, import.meta.url).pathname });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_ENV: z.enum(['dev', 'prod']).default('dev'),
  PUBLIC_URL: z.string().url(),
  PORT: z.coerce.number().int().positive(),
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  SECRETS_ENC_KEY: z.string().length(64, 'must be 64 hex chars (openssl rand -hex 32)'),
  KIE_API_BASE: z.string().url().default('https://api.kie.ai'),
  KIE_CLAUDE_BASE: z.string().url().default('https://api.kie.ai/claude'),
  KIE_API_KEY: z.string().optional(),
  /**
   * Прямой OpenAI для текстовых моделей — мозга агента и проверки контента.
   * 05.09 на живом фестивале kie.ai перестал отвечать на gpt-5-5 и
   * gemini-3-flash (минуты вместо секунд), а картинки при этом рисовал.
   * Модель с префиксом «openai:» (например «openai:gpt-4.1») уходит сюда,
   * а не на kie.ai. Ключ не задан — префикс не работает, остальное как было.
   */
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_API_BASE: z.string().url().default('https://api.openai.com/v1'),
  // HMAC-ключ вебхука kie.ai (генерируется на kie.ai/settings).
  // Секрет времени деплоя, а не «крутилка» — поэтому в .env, а не в админке.
  // Пустой = подпись не проверяется, callback принимается по совпадению taskId.
  KIE_WEBHOOK_HMAC_KEY: z.string().default(''),
  MEDIA_ROOT: z.string().min(1),
  // Chromium для проверки публикаций (фаза 8). На сервере уже стоит
  // системный; в проде можно подменить на браузер из образа.
  CHROMIUM_PATH: z.string().min(1).default('/usr/bin/chromium-browser'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast and loudly: a half-configured stand is worse than no stand.
  const details = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(`Invalid environment (.env.${appEnv}):\n${details}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
