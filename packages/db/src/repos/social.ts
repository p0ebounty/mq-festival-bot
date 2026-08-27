import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { socialClaims, tokenLedger, users } from '../schema';

export type ClaimEvidence = 'phash' | 'vision+page' | 'vision+screenshot' | 'none';

export interface RecordClaimInput {
  userId: string;
  generationId?: string | undefined;
  postUrl?: string | undefined;
  urlKey?: string | undefined;
  status: 'approved' | 'rejected';
  evidence: ClaimEvidence;
  checks: Record<string, unknown>;
  tokensAwarded: number;
  verdictReason: string;
}

/**
 * Заявки на бонус за репост (ADR 0007).
 *
 * Ручной модерации здесь нет и не будет: бот автономен, каждая ветка каскада
 * решает сама. Таблица — **журнал постфактум**, а не очередь на согласование.
 */
export function socialRepo(db: Db) {
  return {
    /** Подавали ли уже эту ссылку — кем угодно. Один пост = один бонус. */
    async claimByUrlKey(urlKey: string) {
      const [row] = await db.select().from(socialClaims)
        .where(eq(socialClaims.urlKey, urlKey)).limit(1);
      return row;
    },

    /** Получал ли участник бонус за эту генерацию. */
    async approvedForGeneration(userId: string, generationId: string) {
      const [row] = await db.select().from(socialClaims)
        .where(and(
          eq(socialClaims.userId, userId),
          eq(socialClaims.generationId, generationId),
          eq(socialClaims.status, 'approved'),
        )).limit(1);
      return row;
    },

    /**
     * Сколько раз участнику начисляли по СЛАБОМУ доказательству.
     *
     * Слабое — это когда решение приняла только vision-модель: страница не
     * открылась или прислали один скриншот. Такие начисления ограничены
     * `economy.weakProofLimit`, иначе самое слабое звено каскада становится
     * дырой: нарисовал скриншот — получил токены.
     */
    async weakApprovalCount(userId: string): Promise<number> {
      const [row] = await db.select({ n: sql<number>`count(*)::int` })
        .from(socialClaims)
        .where(and(
          eq(socialClaims.userId, userId),
          eq(socialClaims.status, 'approved'),
          sql`${socialClaims.evidence} in ('vision+page', 'vision+screenshot')`,
        ));
      return row?.n ?? 0;
    },

    /**
     * Запись вердикта. Отказы пишутся тоже — по ним видно, обо что
     * спотыкаются участники, и это единственный способ понять, не слишком ли
     * строг каскад.
     */
    async record(input: RecordClaimInput) {
      const [row] = await db.insert(socialClaims).values({
        userId: input.userId,
        status: input.status,
        evidence: input.evidence,
        checks: input.checks,
        tokensAwarded: input.tokensAwarded,
        verdictReason: input.verdictReason,
        ...(input.generationId ? { generationId: input.generationId } : {}),
        ...(input.postUrl ? { postUrl: input.postUrl } : {}),
        ...(input.urlKey ? { urlKey: input.urlKey } : {}),
      }).returning();
      return row!;
    },
  };
}

/**
 * Чтение журнала движения токенов.
 *
 * Пишет в него `tokensRepo` — намеренно, чтобы запись нельзя было забыть.
 * Здесь только чтение: история для админки и сверка баланса.
 */
export function ledgerRepo(db: Db) {
  return {
    /** История начислений участника — для админки и для ответа на спор. */
    async forUser(userId: string, limit = 50) {
      return db.select().from(tokenLedger)
        .where(eq(tokenLedger.userId, userId))
        .orderBy(sql`${tokenLedger.createdAt} desc`)
        .limit(limit);
    },

    /** Баланс, пересчитанный по журналу — сверка с `users.token_balance`. */
    async sumForUser(userId: string): Promise<number> {
      const [row] = await db.select({ total: sql<number>`coalesce(sum(${tokenLedger.delta}), 0)::int` })
        .from(tokenLedger).where(eq(tokenLedger.userId, userId));
      return row?.total ?? 0;
    },

    /** Текущий баланс из профиля — вторая половина сверки. */
    async balanceOf(userId: string): Promise<number> {
      const [row] = await db.select({ b: users.tokenBalance })
        .from(users).where(eq(users.id, userId)).limit(1);
      return row?.b ?? 0;
    },
  };
}
