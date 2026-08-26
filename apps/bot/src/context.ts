import { createDb, generationsRepo, mediaRepo, type Db } from '@mq/db';
import { SettingsService } from '@mq/config';
import { KieClient, LocalStorage } from '@mq/core';
import { env } from './env.js';

/**
 * Общий контекст приложения. Собирается один раз при старте и передаётся
 * в маршруты и воркеры — чтобы не тянуть синглтоны из модулей и чтобы
 * в тестах можно было подсунуть подделки.
 */
export interface AppContext {
  db: Db;
  settings: SettingsService;
  storage: LocalStorage;
  kie: KieClient;
  generations: ReturnType<typeof generationsRepo>;
  media: ReturnType<typeof mediaRepo>;
}

export function createContext(): AppContext {
  const db = createDb(env.DATABASE_URL, { max: 10 });
  const settings = new SettingsService(db, env.SECRETS_ENC_KEY, process.env);
  const storage = new LocalStorage(env.MEDIA_ROOT);

  const kie = new KieClient({
    // Ключ читается на каждый запрос: смена в админке применяется
    // без рестарта процесса (ADR 0005).
    getApiKey: () => settings.get('kie.apiKey'),
    baseUrl: env.KIE_API_BASE,
  });

  return { db, settings, storage, kie, generations: generationsRepo(db), media: mediaRepo(db) };
}
