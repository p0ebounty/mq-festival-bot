import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { conversations, messages, toolCalls, users } from '../schema';

export function usersRepo(db: Db) {
  return {
    /** Находит участника по Telegram id или заводит нового со стартовым балансом. */
    async ensure(tg: {
      tgId: bigint; username?: string | null; firstName?: string | null;
      lastName?: string | null; languageCode?: string | null;
    }, startBalance: number) {
      const [existing] = await db.select().from(users).where(eq(users.tgId, tg.tgId)).limit(1);
      if (existing) {
        await db.update(users)
          .set({ lastSeenAt: new Date(), username: tg.username ?? null, firstName: tg.firstName ?? null })
          .where(eq(users.id, existing.id));
        return existing;
      }
      const [created] = await db.insert(users).values({
        tgId: tg.tgId,
        username: tg.username ?? null,
        firstName: tg.firstName ?? null,
        lastName: tg.lastName ?? null,
        languageCode: tg.languageCode ?? null,
        tokenBalance: startBalance,
        lastSeenAt: new Date(),
      }).returning();
      return created!;
    },
  };
}

export function conversationsRepo(db: Db) {
  return {
    /**
     * Берёт активный диалог или начинает новый.
     * Диалог считается «остывшим» после idleMinutes без сообщений — тогда
     * начинаем свежий, чтобы вчерашний контекст не всплывал сегодня.
     */
    async current(userId: string, tgChatId: bigint, idleMinutes: number) {
      const since = new Date(Date.now() - idleMinutes * 60_000);
      const [active] = await db.select().from(conversations)
        .where(and(
          eq(conversations.userId, userId),
          eq(conversations.tgChatId, tgChatId),
          gt(conversations.lastMessageAt, since),
        ))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(1);
      if (active) return active;

      const [created] = await db.insert(conversations)
        .values({ userId, tgChatId }).returning();
      return created!;
    },

    async touch(conversationId: string) {
      await db.update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, conversationId));
    },

    /**
     * URL последнего фото, присланного участником в этом диалоге.
     * Берём из contentJson уже сохранённых сообщений — отдельная колонка
     * не нужна, данные и так пишутся.
     */
    async lastImageUrl(conversationId: string): Promise<string | null> {
      const rows = await db.select({ content: messages.contentJson }).from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.role, 'user')))
        .orderBy(desc(messages.createdAt))
        .limit(20);
      for (const r of rows) {
        const urls = (r.content as { imageUrls?: unknown } | null)?.imageUrls;
        if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0];
      }
      return null;
    },

    /** Последние N сообщений в хронологическом порядке. */
    async history(conversationId: string, limit: number) {
      const rows = await db.select().from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.createdAt))
        .limit(limit);
      return rows.reverse();
    },

    async addMessage(input: {
      conversationId: string;
      role: 'user' | 'assistant' | 'system';
      text?: string | null;
      contentJson?: unknown;
      tgMessageId?: bigint | null;
      inputTokens?: number;
      outputTokens?: number;
    }) {
      const [row] = await db.insert(messages).values({
        conversationId: input.conversationId,
        role: input.role,
        text: input.text ?? null,
        ...(input.contentJson !== undefined ? { contentJson: input.contentJson } : {}),
        ...(input.tgMessageId !== undefined ? { tgMessageId: input.tgMessageId } : {}),
        ...(input.inputTokens !== undefined ? { inputTokens: input.inputTokens } : {}),
        ...(input.outputTokens !== undefined ? { outputTokens: input.outputTokens } : {}),
      }).returning();
      return row!;
    },

    /** Запись вызова инструмента — то, что потом видно в админке. */
    async addToolCall(input: {
      messageId: string; toolName: string; toolUseId: string;
      input: unknown; output?: unknown; ok?: boolean;
      errorMessage?: string | null; durationMs?: number;
    }) {
      const [row] = await db.insert(toolCalls).values({
        messageId: input.messageId,
        toolName: input.toolName,
        toolUseId: input.toolUseId,
        input: input.input,
        ...(input.output !== undefined ? { output: input.output } : {}),
        ...(input.ok !== undefined ? { ok: input.ok } : {}),
        ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      }).returning();
      return row!;
    },
  };
}

export function keyboardRepo(db: Db) {
  return {
    async isShown(userId: string): Promise<boolean> {
      const [row] = await db.select({ v: users.keyboardShown })
        .from(users).where(eq(users.id, userId)).limit(1);
      return row?.v ?? false;
    },
    async setShown(userId: string, shown: boolean) {
      await db.update(users).set({ keyboardShown: shown }).where(eq(users.id, userId));
    },
  };
}

export function worldsRepo(db: Db) {
  return {
    async setCurrent(userId: string, mediaId: string) {
      await db.update(users).set({ currentWorldMediaId: mediaId }).where(eq(users.id, userId));
    },
    async getCurrent(userId: string): Promise<string | null> {
      const [row] = await db.select({ id: users.currentWorldMediaId })
        .from(users).where(eq(users.id, userId)).limit(1);
      return row?.id ?? null;
    },
  };
}

export function tokensRepo(db: Db) {
  return {
    /**
     * Атомарное списание: балансу нельзя уйти в минус даже при гонке двух
     * сообщений подряд. Возвращает новый баланс либо null, если не хватило.
     */
    async charge(userId: string, amount: number): Promise<number | null> {
      const rows = await db.update(users)
        .set({ tokenBalance: sql`${users.tokenBalance} - ${amount}` })
        .where(and(eq(users.id, userId), sql`${users.tokenBalance} >= ${amount}`))
        .returning({ balance: users.tokenBalance });
      return rows[0]?.balance ?? null;
    },

    async grant(userId: string, amount: number): Promise<number> {
      const rows = await db.update(users)
        .set({ tokenBalance: sql`${users.tokenBalance} + ${amount}` })
        .where(eq(users.id, userId))
        .returning({ balance: users.tokenBalance });
      return rows[0]?.balance ?? 0;
    },
  };
}
