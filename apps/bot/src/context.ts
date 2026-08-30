import {
  createDb, generationsRepo, mediaRepo, conversationsRepo, usersRepo, tokensRepo,
  worldsRepo, tasksRepo, shareRepo, socialRepo, ledgerRepo, type Db,
} from '@mq/db';
import { SettingsService } from '@mq/config';
import {
  KieClient, LocalStorage, OpenAiChatProvider, ResponsesApiProvider,
  ToolRegistry, type ChatProvider,
} from '@mq/core';
import { env } from './env.js';
import { MODERATION_MODEL } from './moderation/classifier.js';

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
  tasks: ReturnType<typeof tasksRepo>;
  /** Короткие ссылки на результаты — цель QR-кода. */
  share: ReturnType<typeof shareRepo>;
  /** Заявки на бонус за репост — журнал постфактум, не очередь (ADR 0007). */
  social: ReturnType<typeof socialRepo>;
  /** Чтение журнала токенов. Пишет в него tokensRepo. */
  ledger: ReturnType<typeof ledgerRepo>;
  registry: ToolRegistry;
  /**
   * Досылка готовой генерации участнику. Ставится после создания бота —
   * иначе получился бы цикл: боту нужен контекст, контексту нужен бот.
   */
  deliverGeneration?: (generationId: string) => Promise<void>;
  /**
   * Служебное сообщение владельцу — например, что кредиты kie.ai кончаются.
   * Отдельно от `sendMedia`: это не участнику, и молчаливый сбой здесь
   * допустим, а там нет.
   */
  sendAlert?: (chatId: bigint, text: string) => Promise<void>;
  /** Отправка сохранённой картинки участнику (базовый мир). */
  sendMedia?: (chatId: bigint, mediaId: string, caption: string) => Promise<boolean>;
  /** Заливка нашей картинки в хранилище kie.ai — модели нужен URL. */
  uploadStoredMedia?: (mediaId: string) => Promise<string | null>;
  /**
   * Отправляет карточку «Рисую…» и возвращает id сообщения.
   * По готовности картинка в этом же сообщении подменяется результатом.
   */
  sendPlaceholderCard?: (chatId: bigint, caption: string, generationId: string) => Promise<bigint | null>;
  /**
   * Ссылка на бота вида `https://t.me/<username>` — подвал публичной
   * страницы. Берётся у самого Telegram при старте (`bot.init()`), а не из
   * конфига: два стенда — два разных бота, и рассинхрон тут был бы тихим.
   */
  botUrl?: string;
  /** Провайдер собирается на каждый запрос: модель меняется в админке. */
  chatProvider: () => Promise<ChatProvider>;
  /**
   * Провайдер для проверки контента. Отдельный от chatProvider, потому что
   * модель здесь ЗАДАНА В КОДЕ: это контракт безопасности, а не крутилка.
   * Переключат модель из админки — поведение модерации изменится молча
   * (ADR 0014).
   */
  moderationProvider: () => Promise<ChatProvider>;
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
  const providerFor = (model: string): ChatProvider => {
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

  const chatProvider = async (): Promise<ChatProvider> =>
    providerFor(await settings.get('kie.chatModel'));

  /**
   * Модель проверки контента — в коде, не в настройках (ADR 0014). Та же
   * причина, по которой из админки убраны модель картинок и системный
   * промпт: это не регулировка, а часть контракта. Мультимодальная —
   * проверять надо и текст, и присланные фото.
   */
  const moderationProvider = async (): Promise<ChatProvider> => providerFor(MODERATION_MODEL);

  return {
    db, settings, storage, kie,
    generations: generationsRepo(db),
    media: mediaRepo(db),
    conversations: conversationsRepo(db),
    users: usersRepo(db),
    tokens: tokensRepo(db),
    worlds: worldsRepo(db),
    tasks: tasksRepo(db),
    share: shareRepo(db),
    social: socialRepo(db),
    ledger: ledgerRepo(db),
    registry: new ToolRegistry(),
    chatProvider,
    moderationProvider,
  };
}
