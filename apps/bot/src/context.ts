import {
  createDb, generationsRepo, mediaRepo, conversationsRepo, usersRepo, tokensRepo,
  worldsRepo, type Db,
} from '@mq/db';
import { SettingsService } from '@mq/config';
import { KieClient, LocalStorage, OpenAiChatProvider, ToolRegistry, type ChatProvider } from '@mq/core';
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
  conversations: ReturnType<typeof conversationsRepo>;
  users: ReturnType<typeof usersRepo>;
  tokens: ReturnType<typeof tokensRepo>;
  worlds: ReturnType<typeof worldsRepo>;
  registry: ToolRegistry;
  /**
   * Досылка готовой генерации участнику. Ставится после создания бота —
   * иначе получился бы цикл: боту нужен контекст, контексту нужен бот.
   */
  deliverGeneration?: (generationId: string) => Promise<void>;
  /** Отправка сохранённой картинки участнику (базовый мир). */
  sendMedia?: (chatId: bigint, mediaId: string, caption: string) => Promise<boolean>;
  /** Заливка нашей картинки в хранилище kie.ai — модели нужен URL. */
  uploadStoredMedia?: (mediaId: string) => Promise<string | null>;
  /** Провайдер собирается на каждый запрос: модель меняется в админке. */
  chatProvider: () => Promise<ChatProvider>;
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

  const chatProvider = async (): Promise<ChatProvider> =>
    new OpenAiChatProvider({
      getApiKey: () => settings.get('kie.apiKey'),
      model: await settings.get('kie.chatModel'),
      buildUrl: (m) => `${env.KIE_API_BASE}/${m}/v1/chat/completions`,
    });

  return {
    db, settings, storage, kie,
    generations: generationsRepo(db),
    media: mediaRepo(db),
    conversations: conversationsRepo(db),
    users: usersRepo(db),
    tokens: tokensRepo(db),
    worlds: worldsRepo(db),
    registry: new ToolRegistry(),
    chatProvider,
  };
}
