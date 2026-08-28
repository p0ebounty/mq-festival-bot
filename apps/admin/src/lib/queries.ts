import 'server-only';
import { and, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  users, conversations, messages, toolCalls, generations, media,
  socialClaims, tokenLedger, auditLog, adminUsers, shortLinks,
} from '@mq/db/schema';
import { db } from './db';

/**
 * Потолок выборки для таблиц.
 *
 * Пагинация, поиск и сортировка живут в таблице на клиенте
 * (`@tanstack/react-table`) — так они мгновенные и одинаковые везде.
 * Отдавать всё подряд нельзя, поэтому берём последние ROW_LIMIT записей.
 * Для фестиваля этого с запасом; если данных станет больше, вернём
 * серверную постраничную выборку.
 */
export const ROW_LIMIT = 500;

/**
 * Начало сегодняшнего дня.
 *
 * ⚠️ Возвращаем СТРОКУ ISO, а не `Date`: в сыром шаблоне `sql` драйвер не
 * знает тип выражения и на объекте Date падает с «The "string" argument
 * must be of type string». Явное приведение к timestamptz снимает вопрос.
 */
function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ───────────────────────────── дашборд ─────────────────────────────

export interface DashboardStats {
  generationsToday: number;
  generationsTotal: number;
  failedToday: number;
  usersTotal: number;
  activeToday: number;
  creditsToday: number;
  avgDurationSec: number | null;
  bonusesToday: number;
  inFlight: number;
}

export async function dashboardStats(): Promise<DashboardStats> {
  const today = startOfToday();

  const [gen] = await db.select({
    total: count(),
    today: sql<number>`count(*) filter (where ${generations.createdAt} >= ${today}::timestamptz)::int`,
    failedToday: sql<number>`count(*) filter (where ${generations.createdAt} >= ${today}::timestamptz
      and ${generations.status} in ('failed', 'refunded'))::int`,
    creditsToday: sql<number>`coalesce(sum(${generations.creditsConsumed})
      filter (where ${generations.createdAt} >= ${today}::timestamptz), 0)::int`,
    // Среднюю длительность берём только по удачным: провалы падают быстро
    // и занижали бы цифру, создавая ложное «всё летает».
    avgMs: sql<number | null>`avg(${generations.durationMs})
      filter (where ${generations.status} = 'success' and ${generations.createdAt} >= ${today}::timestamptz)`,
    inFlight: sql<number>`count(*) filter (where ${generations.status}
      in ('pending', 'submitted', 'generating'))::int`,
  }).from(generations);

  const [usr] = await db.select({
    total: count(),
    activeToday: sql<number>`count(*) filter (where ${users.lastSeenAt} >= ${today}::timestamptz)::int`,
  }).from(users);

  const [bonus] = await db.select({
    today: sql<number>`count(*) filter (where ${socialClaims.createdAt} >= ${today}::timestamptz
      and ${socialClaims.status} = 'approved')::int`,
  }).from(socialClaims);

  return {
    generationsTotal: gen?.total ?? 0,
    generationsToday: gen?.today ?? 0,
    failedToday: gen?.failedToday ?? 0,
    creditsToday: gen?.creditsToday ?? 0,
    avgDurationSec: gen?.avgMs != null ? Math.round(Number(gen.avgMs) / 100) / 10 : null,
    inFlight: gen?.inFlight ?? 0,
    usersTotal: usr?.total ?? 0,
    activeToday: usr?.activeToday ?? 0,
    bonusesToday: bonus?.today ?? 0,
  };
}

/** Генерации за последние 14 дней — для графика на дашборде. */
export async function generationsByDay(days = 14) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db.select({
    day: sql<string>`to_char(date_trunc('day', ${generations.createdAt}), 'DD.MM')`,
    total: sql<number>`count(*)::int`,
    failed: sql<number>`count(*) filter (where ${generations.status} in ('failed','refunded'))::int`,
  })
    .from(generations)
    .where(gte(generations.createdAt, since))
    .groupBy(sql`date_trunc('day', ${generations.createdAt})`)
    .orderBy(sql`date_trunc('day', ${generations.createdAt})`);
}

// ───────────────────────────── участники ─────────────────────────────

export async function listUsers(opts: { q?: string } = {}) {
  const q = opts.q?.trim();
  // Поиск по имени, логину и telegram id — на стенде спрашивают по-разному.
  const where = q
    ? or(
        ilike(users.firstName, `%${q}%`),
        ilike(users.username, `%${q}%`),
        sql`${users.tgId}::text like ${`%${q}%`}`,
      )
    : undefined;

  const rows = await db.select({
    id: users.id,
    tgId: users.tgId,
    username: users.username,
    firstName: users.firstName,
    tokenBalance: users.tokenBalance,
    isBanned: users.isBanned,
    lastSeenAt: users.lastSeenAt,
    createdAt: users.createdAt,
    generations: sql<number>`(select count(*)::int from generations g
      where g.user_id = users.id)`,
  })
    .from(users)
    .where(where)
    .orderBy(desc(sql`coalesce(${users.lastSeenAt}, ${users.createdAt})`))
    .limit(ROW_LIMIT);

  const [total] = await db.select({ n: count() }).from(users).where(where);
  return { rows, total: total?.n ?? 0 };
}

/**
 * ⚠️ Коррелированные подзапросы пишутся ГОЛЫМ SQL, без ${table} и ${column}.
 *
 * Drizzle в списке выборки рендерит колонку БЕЗ имени таблицы: конструкция
 *   sql`(select count(*) from ${messages} where ${messages.conversationId} = ${conversations.id})`
 * превращается в
 *   (select count(*) from "messages" where "conversation_id" = "id")
 * — оба имени резолвятся в колонки самого messages, сравнивается
 * messages.conversation_id с messages.id. Это валидный SQL (обе колонки
 * uuid), ошибки нет, ответ всегда 0.
 *
 * Так на проде админка показывала «0 сообщ.» у диалога из 38 сообщений и
 * «0» генераций у всех участников. Молчаливый ноль хуже падения: его
 * принимают за правду.
 *
 * Поэтому корреляция пишется явно и полностью: подзапросной таблице даётся
 * алиас, внешняя называется своим именем.
 */
export async function userCard(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) return null;

  const [ledger, gens, claims, convs, ledgerSum] = await Promise.all([
    db.select().from(tokenLedger).where(eq(tokenLedger.userId, id))
      .orderBy(desc(tokenLedger.createdAt)).limit(40),
    db.select({
      id: generations.id,
      kind: generations.kind,
      status: generations.status,
      userPrompt: generations.userPrompt,
      createdAt: generations.createdAt,
      mediaId: generations.outputMediaId,
    }).from(generations).where(eq(generations.userId, id))
      .orderBy(desc(generations.createdAt)).limit(24),
    db.select().from(socialClaims).where(eq(socialClaims.userId, id))
      .orderBy(desc(socialClaims.createdAt)).limit(20),
    db.select({
      id: conversations.id,
      startedAt: conversations.startedAt,
      lastMessageAt: conversations.lastMessageAt,
      messages: sql<number>`(select count(*)::int from messages m
        where m.conversation_id = conversations.id)`,
    }).from(conversations).where(eq(conversations.userId, id))
      .orderBy(desc(conversations.lastMessageAt)).limit(20),
    db.select({ total: sql<number>`coalesce(sum(${tokenLedger.delta}), 0)::int` })
      .from(tokenLedger).where(eq(tokenLedger.userId, id)),
  ]);

  return {
    user,
    ledger,
    generations: gens,
    claims,
    conversations: convs,
    // Сверка: сумма журнала обязана совпасть с балансом. Расхождение —
    // признак того, что где-то баланс подвинули мимо репозитория.
    ledgerTotal: ledgerSum[0]?.total ?? 0,
  };
}

// ───────────────────────────── диалоги ─────────────────────────────

export async function listConversations(opts: { userId?: string } = {}) {
  const where = opts.userId ? eq(conversations.userId, opts.userId) : undefined;

  const rows = await db.select({
    id: conversations.id,
    userId: users.id,
    firstName: users.firstName,
    username: users.username,
    tgId: users.tgId,
    startedAt: conversations.startedAt,
    lastMessageAt: conversations.lastMessageAt,
    messages: sql<number>`(select count(*)::int from messages m
      where m.conversation_id = conversations.id)`,
    tools: sql<number>`(select count(*)::int from tool_calls tc
      join messages m on m.id = tc.message_id
      where m.conversation_id = conversations.id)`,
  })
    .from(conversations)
    .innerJoin(users, eq(users.id, conversations.userId))
    .where(where)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(ROW_LIMIT);

  const [total] = await db.select({ n: count() }).from(conversations).where(where);
  return { rows, total: total?.n ?? 0 };
}

/**
 * Переписка целиком с вызовами инструментов под каждым ответом.
 *
 * Это главный инструмент отладки агента (правило 30-admin-ui): без
 * аргументов и результата вызова невозможно понять, почему бот сделал
 * не то — а именно этот вопрос возникает чаще всего.
 */
export async function conversationThread(id: string) {
  const [conv] = await db.select({
    id: conversations.id,
    startedAt: conversations.startedAt,
    lastMessageAt: conversations.lastMessageAt,
    userId: users.id,
    firstName: users.firstName,
    username: users.username,
    tgId: users.tgId,
  })
    .from(conversations)
    .innerJoin(users, eq(users.id, conversations.userId))
    .where(eq(conversations.id, id))
    .limit(1);
  if (!conv) return null;

  const msgs = await db.select().from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);

  const calls = msgs.length
    ? await db.select().from(toolCalls)
        .where(inArray(toolCalls.messageId, msgs.map((m) => m.id)))
        .orderBy(toolCalls.createdAt)
    : [];

  const byMessage = new Map<string, typeof calls>();
  for (const c of calls) {
    const list = byMessage.get(c.messageId) ?? [];
    list.push(c);
    byMessage.set(c.messageId, list);
  }

  return {
    conversation: conv,
    messages: msgs.map((m) => ({ ...m, calls: byMessage.get(m.id) ?? [] })),
  };
}

// ───────────────────────────── генерации ─────────────────────────────

export async function listGenerations(opts: { status?: string; userId?: string } = {}) {
  const conds = [
    opts.status && opts.status !== 'all'
      ? sql`${generations.status} = ${opts.status}` : undefined,
    opts.userId ? eq(generations.userId, opts.userId) : undefined,
  ].filter(Boolean);
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db.select({
    id: generations.id,
    kind: generations.kind,
    status: generations.status,
    model: generations.model,
    userPrompt: generations.userPrompt,
    finalPrompt: generations.finalPrompt,
    caption: generations.caption,
    sourceUrl: generations.sourceUrl,
    tokensCharged: generations.tokensCharged,
    creditsConsumed: generations.creditsConsumed,
    durationMs: generations.durationMs,
    failMessage: generations.failMessage,
    createdAt: generations.createdAt,
    mediaId: media.id,
    shortId: shortLinks.shortId,
    userId: users.id,
    firstName: users.firstName,
    username: users.username,
  })
    .from(generations)
    .innerJoin(users, eq(users.id, generations.userId))
    .leftJoin(media, eq(media.id, generations.outputMediaId))
    .leftJoin(shortLinks, eq(shortLinks.generationId, generations.id))
    .where(where)
    .orderBy(desc(generations.createdAt))
    .limit(ROW_LIMIT);

  const [total] = await db.select({ n: count() }).from(generations).where(where);
  return { rows, total: total?.n ?? 0 };
}

// ─────────────────────── начисления за репосты ───────────────────────

/**
 * Журнал проверок публикаций.
 *
 * ⚠️ Только просмотр. Ручной модерации в проекте нет — бот автономен
 * (ADR 0007). Здесь смотрят постфактум: что прислали, какой вердикт, на
 * чём он основан. Если каскад начнёт ошибаться, чинят настройку
 * `economy.weakProofLimit`, а не отдельные заявки руками.
 */
export async function listClaims(opts: { status?: string } = {}) {
  const where = opts.status && opts.status !== 'all'
    ? sql`${socialClaims.status} = ${opts.status}` : undefined;

  const rows = await db.select({
    id: socialClaims.id,
    status: socialClaims.status,
    evidence: socialClaims.evidence,
    checks: socialClaims.checks,
    postUrl: socialClaims.postUrl,
    tokensAwarded: socialClaims.tokensAwarded,
    verdictReason: socialClaims.verdictReason,
    createdAt: socialClaims.createdAt,
    userId: users.id,
    firstName: users.firstName,
    username: users.username,
    generationId: socialClaims.generationId,
  })
    .from(socialClaims)
    .innerJoin(users, eq(users.id, socialClaims.userId))
    .where(where)
    .orderBy(desc(socialClaims.createdAt))
    .limit(ROW_LIMIT);

  const [total] = await db.select({ n: count() }).from(socialClaims).where(where);
  return { rows, total: total?.n ?? 0 };
}

/** Одна генерация целиком — для страницы разбора. */
export async function generationById(id: string) {
  const [row] = await db.select({
    id: generations.id,
    kind: generations.kind,
    status: generations.status,
    model: generations.model,
    params: generations.params,
    userPrompt: generations.userPrompt,
    finalPrompt: generations.finalPrompt,
    caption: generations.caption,
    sourceUrl: generations.sourceUrl,
    tokensCharged: generations.tokensCharged,
    creditsConsumed: generations.creditsConsumed,
    durationMs: generations.durationMs,
    failCode: generations.failCode,
    failMessage: generations.failMessage,
    createdAt: generations.createdAt,
    completedAt: generations.completedAt,
    mediaId: media.id,
    shortId: shortLinks.shortId,
    conversationId: generations.conversationId,
    userId: users.id,
    firstName: users.firstName,
    username: users.username,
    tgId: users.tgId,
  })
    .from(generations)
    .innerJoin(users, eq(users.id, generations.userId))
    .leftJoin(media, eq(media.id, generations.outputMediaId))
    .leftJoin(shortLinks, eq(shortLinks.generationId, generations.id))
    .where(eq(generations.id, id))
    .limit(1);
  return row;
}

// ───────────────────────────── аудит ─────────────────────────────

export async function listAudit() {
  const rows = await db.select({
    id: auditLog.id,
    action: auditLog.action,
    target: auditLog.target,
    details: auditLog.details,
    ip: auditLog.ip,
    createdAt: auditLog.createdAt,
    adminLogin: adminUsers.login,
  })
    .from(auditLog)
    .leftJoin(adminUsers, eq(adminUsers.id, auditLog.adminUserId))
    .orderBy(desc(auditLog.createdAt))
    .limit(ROW_LIMIT);

  const [total] = await db.select({ n: count() }).from(auditLog);
  return { rows, total: total?.n ?? 0 };
}
