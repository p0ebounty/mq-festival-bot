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
  MEDIA_ROOT: z.string().min(1),
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
