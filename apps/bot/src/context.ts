import {
  createDb, generationsRepo, mediaRepo, conversationsRepo, usersRepo, tokensRepo,
  worldsRepo, type Db,
} from '@mq/db';
import { SettingsService } from '@mq/config';
import {
  KieClient, LocalStorage, OpenAiChatProvider, ResponsesApiProvider,
  ToolRegistry, type ChatProvider,
} from '@mq/core';
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
  /**
   * Отправляет карточку «Рисую…» и возвращает id сообщения.
   * По готовности картинка в этом же сообщении подменяется результатом.
   */
  sendPlaceholderCard?: (chatId: bigint, caption: string) => Promise<bigint | null>;
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

  /**
   * Адаптер выбирается по имени модели: у kie.ai три разных формата
   * (ADR 0008). Gemini — OpenAI-совместимый chat/completions, модели
   * gpt-5-* — Responses API с потоком SSE на общем пути /codex.
   */
  const chatProvider = async (): Promise<ChatProvider> => {
    const model = await settings.get('kie.chatModel');
    const getApiKey = () => settings.get('kie.apiKey');

    if (model.startsWith('gpt-5')) {
      return new ResponsesApiProvider({
        getApiKey, model, url: `${env.KIE_API_BASE}/codex/v1/responses`, effort: 'low',
      });
    }
    return new OpenAiChatProvider({
      getApiKey, model, buildUrl: (m) => `${env.KIE_API_BASE}/${m}/v1/chat/completions`,
    });
  };

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
