import {
  pgTable, pgEnum, text, integer, bigint, boolean, timestamp, jsonb,
  uuid, index, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';

// ─────────────────────────── enums ───────────────────────────

export const generationStatus = pgEnum('generation_status', [
  'pending',    // задача создана у нас, ещё не отправлена
  'submitted',  // отправлена в kie.ai, есть taskId
  'generating', // kie.ai сообщил о прогрессе
  'success',
  'failed',
  'refunded',   // упала, токены возвращены
]);

export const generationKind = pgEnum('generation_kind', [
  'image',        // с нуля по тексту
  'profession',   // сценарий 1 ТЗ: фото → профессия
  'world',        // сценарий 2 ТЗ: базовый мир → новый мир
]);

/**
 * Тип записи в пуле готовых картинок.
 *
 * Мир и задание — одна и та же сущность (картинка плюс сопроводительный
 * текст) и живут в одной таблице: структура совпадает, разница в одном
 * поле. Но пулы не смешиваются при выдаче — иначе просьба «дай мир»
 * однажды пришлёт Колизей (ADR 0013).
 */
export const poolKind = pgEnum('pool_kind', [
  'world',  // свободная игра: меняй как хочешь
  'task',   // конкретная цель: во что превратить
]);

export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system']);

export const claimStatus = pgEnum('claim_status', [
  'pending',   // ждёт автопроверки
  'approved',
  'rejected',
  // ⚠️ 'manual' — мёртвое значение. Ручной модерации в проекте нет: бот
  // автономен, каждая ветка каскада решает сама (ADR 0007). Значение
  // оставлено в enum, потому что удалять его из Postgres дорого, а вреда нет.
  'manual',
]);

// ─────────────────────────── участники ───────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tgId: bigint('tg_id', { mode: 'bigint' }).notNull(),
  username: text('username'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  languageCode: varchar('language_code', { length: 8 }),
  // Баланс токенов — целое, никаких дробей. Списание/начисление только
  // через репозиторий, атомарно, чтобы не разъехалось при гонках.
  tokenBalance: integer('token_balance').notNull().default(0),
  /**
   * Текущий «мир» участника для сценария 2 ТЗ. Меняется при выдаче базового
   * мира и после каждой удачной трансформации — так участник может менять
   * мир цепочкой: шторм → роботы → акварель, каждый раз от предыдущего.
   */
  currentWorldMediaId: uuid('current_world_media_id'),
  /** Когда выдан мир — чтобы он встал в реестр картинок на своё место. */
  currentWorldAt: timestamp('current_world_at', { withTimezone: true }),
  /**
   * Задание, которое участнику выдали последним.
   *
   * Это НЕ состояние «задание идёт / завершено» — такого у заданий нет
   * (ADR 0013). Это указатель на картинку: без него выданная картинка не
   * попадёт в реестр диалога, и править её будет нечем. Ровно та же роль,
   * что у current_world_media_id, и хранится по тем же причинам.
   */
  currentTaskId: uuid('current_task_id'),
  currentTaskAt: timestamp('current_task_at', { withTimezone: true }),
  /**
   * Сообщение, под которым СЕЙЧАС висят кнопки-подсказки.
   *
   * Не флаг «висят / не висят», как было у нижней панели, а конкретный id:
   * inline-кнопки принадлежат сообщению, и чтобы их снять, надо знать
   * какому. Гасим при следующем же действии участника — подсказка к
   * предыдущей реплике после его ответа только сбивает с толку.
   *
   * В БД, а не в памяти процесса: иначе каждый выкат оставлял бы по одному
   * сообщению с вечными кнопками у каждого активного участника.
   */
  suggestMessageId: bigint('suggest_message_id', { mode: 'bigint' }),
  isBanned: boolean('is_banned').notNull().default(false),
  bannedReason: text('banned_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('users_tg_id_uniq').on(t.tgId),
  index('users_last_seen_idx').on(t.lastSeenAt),
]);

// ─────────────────────────── диалог ───────────────────────────

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tgChatId: bigint('tg_chat_id', { mode: 'bigint' }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('conversations_user_idx').on(t.userId, t.lastMessageAt)]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: messageRole('role').notNull(),
  // Текст как его видит человек. Полные Anthropic content-blocks — в contentJson.
  text: text('text'),
  contentJson: jsonb('content_json'),
  tgMessageId: bigint('tg_message_id', { mode: 'bigint' }),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)]);

// Ключевая таблица для отладки агента: что он вызвал и что получил.
// Именно она рисуется в админке под сообщением.
export const toolCalls = pgTable('tool_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id').notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  toolUseId: text('tool_use_id').notNull(),
  input: jsonb('input').notNull(),
  output: jsonb('output'),
  ok: boolean('ok'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('tool_calls_message_idx').on(t.messageId),
  index('tool_calls_name_idx').on(t.toolName, t.createdAt),
]);

// ─────────────────────────── медиа и генерации ───────────────────────────

export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  path: text('path').notNull(),          // относительно MEDIA_ROOT
  mimeType: text('mime_type').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  // Перцептивный хеш — для дедупликации скринов репостов.
  phash: varchar('phash', { length: 32 }),
  source: text('source').notNull(),      // 'telegram' | 'kie' | 'seed'
  /**
   * Кэш заливки в хранилище kie.ai: модель читает картинку по URL, а лежит
   * она у нас. Без кэша шесть картинок в контексте означали бы шесть
   * заливок на каждое сообщение участника (ADR 0010).
   */
  remoteUrl: text('remote_url'),
  remoteUrlExpiresAt: timestamp('remote_url_expires_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('media_sha_idx').on(t.sha256),
  index('media_phash_idx').on(t.phash),
  index('media_expires_idx').on(t.expiresAt),
]);

export const generations = pgTable('generations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toolCallId: uuid('tool_call_id').references(() => toolCalls.id, { onDelete: 'set null' }),
  /**
   * Диалог, в котором родилась генерация. `tool_call_id` для этого не годится:
   * строка вызова пишется уже ПОСЛЕ цикла агента, а связь нужна во время.
   */
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  kind: generationKind('kind').notNull(),
  status: generationStatus('status').notNull().default('pending'),

  // ── Пара, ради которой всё затевалось. В админке они показываются рядом,
  // чтобы видеть, не «увёл» ли агент авторскую мысль. См. rules/20-bot-agent.md.
  userPrompt: text('user_prompt').notNull(),   // что написал человек, дословно
  finalPrompt: text('final_prompt'),           // что ушло в модель

  model: text('model').notNull(),
  params: jsonb('params'),                     // aspect_ratio, resolution и т.п.
  inputMediaIds: jsonb('input_media_ids').$type<string[]>(),
  /**
   * Какая именно картинка ушла в модель. Раньше не писалась нигде, и когда
   * бот отредактировал не тот снимок, источник пришлось выяснять запросом
   * в kie.ai. В админке это должно быть видно сразу.
   */
  sourceUrl: text('source_url'),
  /**
   * По какому заданию сделана работа. Проставляется, когда правится
   * картинка задания или её потомок, — чтобы в админке работы можно было
   * отобрать по заданию и сравнить между собой.
   *
   * Отдельного состояния «задание идёт» у участника нет: связь выводится
   * из того, какую картинку правили (ADR 0013).
   */
  taskId: uuid('task_id').references(() => baseWorlds.id, { onDelete: 'set null' }),
  /**
   * Из какого стартового мира выросла работа. Ставится так же, как `task_id`:
   * от выданной картинки мира и от любой правки в её цепочке.
   *
   * Отдельной колонкой, а не через `task_id`: пулы не смешиваются нигде —
   * ни при выдаче, ни в админке (ADR 0013). Одна колонка на оба пула
   * означала бы, что запрос «работы по заданию» однажды принесёт мир.
   */
  worldId: uuid('world_id').references(() => baseWorlds.id, { onDelete: 'set null' }),
  outputMediaId: uuid('output_media_id').references(() => media.id, { onDelete: 'set null' }),

  // Куда доставить готовую картинку. Храним прямо здесь: путь
  // generation → tool_call → message → conversation слишком длинный и
  // рвётся, если запись сообщения не успела закоммититься.
  tgChatId: bigint('tg_chat_id', { mode: 'bigint' }),

  /**
   * Подпись к готовой картинке — её пишет САМ агент при постановке задачи.
   * Фиксированное «Готово!» на все случаи выглядит казённо, а участнику
   * приятнее прочитать что-то про его собственную идею.
   */
  caption: text('caption'),

  /**
   * Сообщение-карточка «Рисую…», отправленное сразу при постановке задачи.
   * По готовности мы подменяем в нём картинку через editMessageMedia —
   * участник видит превращение на месте, а не два разных сообщения.
   */
  placeholderMessageId: bigint('placeholder_message_id', { mode: 'bigint' }),

  kieTaskId: text('kie_task_id'),
  failCode: text('fail_code'),
  failMessage: text('fail_message'),
  tokensCharged: integer('tokens_charged').notNull().default(0),
  creditsConsumed: integer('credits_consumed'),
  durationMs: integer('duration_ms'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('generations_kie_task_uniq').on(t.kieTaskId),
  index('generations_user_idx').on(t.userId, t.createdAt),
  index('generations_status_idx').on(t.status, t.createdAt),
]);

// QR ведёт сюда: /g/<shortId>
export const shortLinks = pgTable('short_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  shortId: varchar('short_id', { length: 16 }).notNull(),
  generationId: uuid('generation_id').notNull()
    .references(() => generations.id, { onDelete: 'cascade' }),
  visits: integer('visits').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('short_links_short_id_uniq').on(t.shortId)]);

// ─────────────────────────── контент фестиваля ───────────────────────────

export const professions = pgTable('professions', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 64 }).notNull(),
  title: text('title').notNull(),            // «космонавт»
  description: text('description'),
  // Кусок промпта, описывающий образ. Подмешивается к запросу пользователя,
  // не заменяя его. См. rules/20-bot-agent.md.
  promptFragment: text('prompt_fragment').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('professions_slug_uniq').on(t.slug)]);

export const baseWorlds = pgTable('base_worlds', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),            // «средневековый замок»
  mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  sourcePrompt: text('source_prompt'),
  kind: poolKind('kind').notNull().default('world'),
  /**
   * Текст задания — что участнику нужно получить из этой картинки.
   * Заполнен только у записей с kind='task'; у миров его нет, там
   * участник волен делать что угодно.
   */
  taskText: text('task_text'),
  isActive: boolean('is_active').notNull().default(true),
  timesIssued: integer('times_issued').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Журнал отказов модерации (ADR 0014).
 *
 * Без него границу не настроить: калибровка «что режется зря» делается по
 * фактическим отказам, а не по ощущениям. Здесь же видно, когда участник
 * упёрся в запрет и почему — иначе на вопрос «почему мне нельзя» ответить
 * нечем.
 */
export const moderationLog = pgTable('moderation_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Где сработало: на присланном фото или на запросе к генератору. */
  stage: text('stage').notNull(),
  /** Кто решил: classifier | stoplist | unavailable. */
  source: text('source').notNull(),
  category: text('category'),
  reason: text('reason'),
  /** Обрезанный запрос — по нему и понятно, зря отказали или по делу. */
  snippet: text('snippet'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('moderation_log_created_idx').on(t.createdAt)]);

export const socialClaims = pgTable('social_claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  generationId: uuid('generation_id').references(() => generations.id, { onDelete: 'set null' }),
  // Скриншот — ЗАПАСНОЙ путь (ADR 0007): обычно приходит ссылка, а не картинка.
  screenshotMediaId: uuid('screenshot_media_id')
    .references(() => media.id, { onDelete: 'set null' }),
  /** Нормализованный адрес публикации. */
  postUrl: text('post_url'),
  /**
   * Хеш нормализованного адреса — ключ дедупликации.
   * Уникальный: один пост приносит бонус ровно один раз, кто бы его ни подал.
   */
  urlKey: varchar('url_key', { length: 32 }),
  /** На чём основан вердикт: phash | vision+page | vision+screenshot | none. */
  evidence: text('evidence'),
  /** Что именно сошлось: домен, публичность, картинка, хештеги. */
  checks: jsonb('checks'),
  status: claimStatus('status').notNull().default('pending'),
  tokensAwarded: integer('tokens_awarded').notNull().default(0),
  verdictReason: text('verdict_reason'),      // объяснение автопроверки
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('social_claims_status_idx').on(t.status, t.createdAt),
  index('social_claims_user_idx').on(t.userId),
  uniqueIndex('social_claims_url_uniq').on(t.urlKey),
]);

// ─────────────────────────── настройки и админ ───────────────────────────

// Значения, меняемые из админки без рестарта. Секретные — зашифрованы
// AES-256-GCM (см. ADR 0005). Наружу секрет отдаётся только маской.
export const settings = pgTable('settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: text('value'),
  isSecret: boolean('is_secret').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

// Схема многопользовательская сразу, чтобы добавить второго админа
// без переделки логики. Пока заводится один — 'admin'.
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  login: varchar('login', { length: 64 }).notNull(),
  passwordHash: text('password_hash').notNull(),   // argon2id
  displayName: text('display_name'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('admin_users_login_uniq').on(t.login)]);

export const adminSessions = pgTable('admin_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminUserId: uuid('admin_user_id').notNull()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('admin_sessions_token_uniq').on(t.tokenHash),
  index('admin_sessions_expires_idx').on(t.expiresAt),
]);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminUserId: uuid('admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  action: text('action').notNull(),           // 'settings.update', 'user.grant_tokens'
  target: text('target'),
  details: jsonb('details'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_log_created_idx').on(t.createdAt)]);

// Движение токенов — отдельным журналом, чтобы баланс всегда можно было
// пересчитать и объяснить пользователю.
export const tokenLedger = pgTable('token_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),          // + начисление, − списание
  balanceAfter: integer('balance_after').notNull(),
  reason: text('reason').notNull(),           // 'signup' | 'generation' | 'refund' | 'social_bonus' | 'admin'
  generationId: uuid('generation_id').references(() => generations.id, { onDelete: 'set null' }),
  socialClaimId: uuid('social_claim_id').references(() => socialClaims.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('token_ledger_user_idx').on(t.userId, t.createdAt)]);
