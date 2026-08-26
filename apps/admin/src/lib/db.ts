import 'server-only';
import { createDb, type Db } from '@mq/db';
import { SettingsService } from '@mq/config';
import { env } from './env';

// В dev Next перезагружает модули на каждое изменение — держим синглтоны
// на globalThis, иначе на каждый hot-reload открывается новый пул соединений.
const g = globalThis as unknown as { __mqDb?: Db; __mqSettings?: SettingsService };

export const db: Db = g.__mqDb ?? createDb(env.DATABASE_URL, { max: 5 });
if (!g.__mqDb) g.__mqDb = db;

export const settingsService: SettingsService =
  g.__mqSettings ?? new SettingsService(db, env.SECRETS_ENC_KEY, process.env);
if (!g.__mqSettings) g.__mqSettings = settingsService;
