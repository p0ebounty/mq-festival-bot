import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { conversations, messages, toolCalls, tokenLedger, users } from '../schema';

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
      // Стартовый баланс — тоже движение: иначе журнал не сойдётся с балансом
      // с самой первой строки, и сверка станет бесполезной.
      if (startBalance !== 0) {
        await db.insert(tokenLedger).values({
          userId: created!.id, delta: startBalance,
          balanceAfter: startBalance, reason: 'signup',
        });
      }
      return created!;
    },

    /**
     * Запомнить сообщение, под которым висят кнопки-подсказки.
     * `null` — кнопок нет.
     */
    async rememberSuggestion(userId: string, tgMessageId: bigint | null) {
      await db.update(users).set({ suggestMessageId: tgMessageId }).where(eq(users.id, userId));
    },

    /**
     * Забрать и сразу забыть сообщение с подсказками.
     *
     * В транзакции с `FOR UPDATE`, а не одним UPDATE…RETURNING: RETURNING
     * отдаёт значение ПОСЛЕ записи, то есть всегда null, и нажатие на живую
     * кнопку считалось бы устаревшим. Поймано сквозным тестом нажатия.
     *
     * Блокировка строки нужна по-настоящему: два сообщения подряд от одного
     * участника обрабатываются параллельно, и без неё оба увидели бы один
     * id — бот дважды полез бы править одно сообщение, а второе нажатие
     * прошло бы как свежее.
     */
    async takeSuggestion(tgId: bigint): Promise<bigint | null> {
      return db.transaction(async (tx) => {
        const [row] = await tx.select({ id: users.suggestMessageId })
          .from(users).where(eq(users.tgId, tgId)).limit(1).for('update');
        if (!row?.id) return null;
        await tx.update(users).set({ suggestMessageId: null }).where(eq(users.tgId, tgId));
        return row.id;
      });
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

    /**
     * Все фото, присланные участником в этом диалоге, по порядку.
     * Половина реестра картинок (вторая — результаты генераций), ADR 0010.
     */
    async userImages(conversationId: string): Promise<Array<{ url: string; at: Date }>> {
      const rows = await db.select({ content: messages.contentJson, at: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.role, 'user')))
        .orderBy(messages.createdAt);
      const out: Array<{ url: string; at: Date }> = [];
      for (const r of rows) {
        const urls = (r.content as { imageUrls?: unknown } | null)?.imageUrls;
        if (!Array.isArray(urls)) continue;
        for (const u of urls) if (typeof u === 'string') out.push({ url: u, at: r.at });
      }
      return out;
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

export function worldsRepo(db: Db) {
  return {
    async setCurrent(userId: string, mediaId: string) {
      await db.update(users)
        .set({ currentWorldMediaId: mediaId, currentWorldAt: new Date() })
        .where(eq(users.id, userId));
    },
    /** Мир и когда он выдан — время нужно, чтобы поставить его в реестр картинок. */
    async getCurrent(userId: string): Promise<{ mediaId: string; at: Date | null } | null> {
      const [row] = await db.select({ id: users.currentWorldMediaId, at: users.currentWorldAt })
        .from(users).where(eq(users.id, userId)).limit(1);
      return row?.id ? { mediaId: row.id, at: row.at } : null;
    },
  };
}

/** Зачем двинулся баланс. Пишется в журнал вместе с движением. */
export type LedgerReason = 'signup' | 'generation' | 'refund' | 'social_bonus' | 'admin';

interface LedgerLink {
  reason: LedgerReason;
  generationId?: string | undefined;
  socialClaimId?: string | undefined;
}

export function tokensRepo(db: Db) {
  /**
   * Журнал пишется ЗДЕСЬ, а не у вызывающих.
   *
   * Таблица `token_ledger` существовала с фазы 2 и всё это время оставалась
   * пустой: баланс жил одним числом в `users`. Числа мало — по нему нельзя
   * ответить «почему у меня столько», а именно это спрашивают на стенде.
   * Если бы запись журнала оставалась на совести вызывающего, её однажды
   * забыли бы — как забыли на четыре фазы.
   */
  async function note(userId: string, delta: number, balanceAfter: number, link: LedgerLink) {
    await db.insert(tokenLedger).values({
      userId, delta, balanceAfter, reason: link.reason,
      ...(link.generationId ? { generationId: link.generationId } : {}),
      ...(link.socialClaimId ? { socialClaimId: link.socialClaimId } : {}),
    });
  }

  return {
    /**
     * Атомарное списание: балансу нельзя уйти в минус даже при гонке двух
     * сообщений подряд. Возвращает новый баланс либо null, если не хватило.
     */
    async charge(userId: string, amount: number, link: LedgerLink): Promise<number | null> {
      const rows = await db.update(users)
        .set({ tokenBalance: sql`${users.tokenBalance} - ${amount}` })
        .where(and(eq(users.id, userId), sql`${users.tokenBalance} >= ${amount}`))
        .returning({ balance: users.tokenBalance });
      const balance = rows[0]?.balance;
      if (balance === undefined) return null;
      await note(userId, -amount, balance, link);
      return balance;
    },

    async grant(userId: string, amount: number, link: LedgerReason | LedgerLink): Promise<number> {
      const rows = await db.update(users)
        .set({ tokenBalance: sql`${users.tokenBalance} + ${amount}` })
        .where(eq(users.id, userId))
        .returning({ balance: users.tokenBalance });
      const balance = rows[0]?.balance ?? 0;
      await note(userId, amount, balance, typeof link === 'string' ? { reason: link } : link);
      return balance;
    },
  };
}
