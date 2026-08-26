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

export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system']);

export const claimStatus = pgEnum('claim_status', [
  'pending',   // ждёт автопроверки
  'approved',
  'rejected',
  'manual',    // спорное → ручная модерация
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
  kind: generationKind('kind').notNull(),
  status: generationStatus('status').notNull().default('pending'),

  // ── Пара, ради которой всё затевалось. В админке они показываются рядом,
  // чтобы видеть, не «увёл» ли агент авторскую мысль. См. rules/20-bot-agent.md.
  userPrompt: text('user_prompt').notNull(),   // что написал человек, дословно
  finalPrompt: text('final_prompt'),           // что ушло в модель

  model: text('model').notNull(),
  params: jsonb('params'),                     // aspect_ratio, resolution и т.п.
  inputMediaIds: jsonb('input_media_ids').$type<string[]>(),
  outputMediaId: uuid('output_media_id').references(() => media.id, { onDelete: 'set null' }),

  // Куда доставить готовую картинку. Храним прямо здесь: путь
  // generation → tool_call → message → conversation слишком длинный и
  // рвётся, если запись сообщения не успела закоммититься.
  tgChatId: bigint('tg_chat_id', { mode: 'bigint' }),

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
  isActive: boolean('is_active').notNull().default(true),
  timesIssued: integer('times_issued').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const socialClaims = pgTable('social_claims', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  generationId: uuid('generation_id').references(() => generations.id, { onDelete: 'set null' }),
  screenshotMediaId: uuid('screenshot_media_id').notNull()
    .references(() => media.id, { onDelete: 'cascade' }),
  status: claimStatus('status').notNull().default('pending'),
  tokensAwarded: integer('tokens_awarded').notNull().default(0),
  verdictReason: text('verdict_reason'),      // объяснение авто- или ручной проверки
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('social_claims_status_idx').on(t.status, t.createdAt),
  index('social_claims_user_idx').on(t.userId),
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
