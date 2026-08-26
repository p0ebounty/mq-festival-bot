import 'server-only';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';

const appEnv = process.env.APP_ENV ?? 'dev';
// .env.<stand> лежит в корне монорепо, а не рядом с приложением.
loadEnv({ path: path.resolve(process.cwd(), '../../', `.env.${appEnv}`) });

const schema = z.object({
  APP_ENV: z.enum(['dev', 'prod']).default('dev'),
  PUBLIC_URL: z.string().url(),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  SECRETS_ENC_KEY: z.string().length(64),
  ADMIN_SESSION_SECRET: z.string().min(32),
  KIE_API_BASE: z.string().url().default('https://api.kie.ai'),
  KIE_API_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment (.env.${appEnv}):\n${details}`);
}

export const env = parsed.data;
