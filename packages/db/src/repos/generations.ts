import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { generations, media } from '../schema';

export type GenerationStatus =
  | 'pending' | 'submitted' | 'generating' | 'success' | 'failed' | 'refunded';

/** Статусы, из которых задача ещё может доехать до результата. */
export const IN_FLIGHT: GenerationStatus[] = ['pending', 'submitted', 'generating'];

export interface CreateGenerationInput {
  userId: string;
  kind: 'image' | 'profession' | 'world';
  userPrompt: string;
  finalPrompt?: string;
  model: string;
  params?: Record<string, unknown>;
  inputMediaIds?: string[];
  tokensCharged?: number;
  toolCallId?: string;
  conversationId?: string;
  /** Какая картинка ушла в модель — чтобы источник был виден в админке. */
  sourceUrl?: string;
  /** По какому заданию сделана работа, если правилась картинка задания. */
  taskId?: string;
  /** Из какого стартового мира выросла работа, если правился мир. */
  worldId?: string;
  tgChatId?: bigint;
  caption?: string;
}

export function generationsRepo(db: Db) {
  return {
    async create(input: CreateGenerationInput) {
      const [row] = await db.insert(generations).values({
        userId: input.userId,
        kind: input.kind,
        status: 'pending',
        userPrompt: input.userPrompt,
        model: input.model,
        tokensCharged: input.tokensCharged ?? 0,
        ...(input.finalPrompt ? { finalPrompt: input.finalPrompt } : {}),
        ...(input.params ? { params: input.params } : {}),
        ...(input.inputMediaIds ? { inputMediaIds: input.inputMediaIds } : {}),
        ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.worldId ? { worldId: input.worldId } : {}),
        ...(input.tgChatId !== undefined ? { tgChatId: input.tgChatId } : {}),
        ...(input.caption ? { caption: input.caption } : {}),
      }).returning();
      return row!;
    },

    async setPlaceholder(id: string, messageId: bigint) {
      await db.update(generations)
        .set({ placeholderMessageId: messageId })
        .where(eq(generations.id, id));
    },

    /**
     * Помечает задачу отправленной и запоминает taskId от kie.ai.
     * `tried` — каким моделям задача уже предлагалась; мержится в params
     * через jsonb `||`, а не перезаписывает их: там уже лежат aspectRatio,
     * task, chain и images, нужные для пересдачи.
     */
    async markSubmitted(id: string, kieTaskId: string, model: string, tried?: string[]) {
      await db.update(generations)
        .set({
          status: 'submitted',
          kieTaskId,
          model,
          ...(tried
            ? { params: sql`coalesce(${generations.params}, '{}'::jsonb) || ${JSON.stringify({ tried })}::jsonb` }
            : {}),
        })
        .where(eq(generations.id, id));
    },

    /**
     * Забирает упавшую задачу под пересдачу другой модели. АТОМАРНО, одним
     * UPDATE: строка возвращается в pending, kie_task_id обнуляется, в
     * params.attempts дописывается провалившаяся попытка, params.retries
     * растёт на единицу.
     *
     * Условие по СТАРОМУ taskId — защита от гонки: один и тот же fail могут
     * увидеть и callback, и воркер добора. Второй строку по старому taskId
     * уже не найдёт и ничего не сделает. Обнулённый kie_task_id заодно
     * выводит строку из staleInFlight до новой постановки.
     * Возвращает true, только если захват удался.
     */
    async claimRetry(
      id: string,
      oldTaskId: string,
      failure: { model: string; taskId: string; failCode?: string; failMessage?: string },
    ): Promise<boolean> {
      const attempt = JSON.stringify({ ...failure, at: new Date().toISOString() });
      const res = await db.update(generations)
        .set({
          status: 'pending',
          kieTaskId: null,
          params: sql`jsonb_set(
            coalesce(${generations.params}, '{}'::jsonb)
              || jsonb_build_object('retries', coalesce((${generations.params}->>'retries')::int, 0) + 1),
            '{attempts}',
            coalesce(${generations.params}->'attempts', '[]'::jsonb) || ${attempt}::jsonb,
            true
          )`,
        })
        .where(and(
          eq(generations.id, id),
          eq(generations.kieTaskId, oldTaskId),
          inArray(generations.status, IN_FLIGHT),
        ))
        .returning({ id: generations.id });
      return res.length > 0;
    },

    byId(id: string) {
      return db.query.generations?.findFirst?.({ where: eq(generations.id, id) })
        ?? db.select().from(generations).where(eq(generations.id, id)).limit(1).then((r) => r[0]);
    },

    async byTaskId(kieTaskId: string) {
      const [row] = await db.select().from(generations)
        .where(eq(generations.kieTaskId, kieTaskId)).limit(1);
      return row;
    },

    /**
     * Завершает задачу успехом. Идемпотентно: повторный callback по той же
     * задаче не перезапишет результат и не спишет ничего дважды.
     * Возвращает true, только если переход действительно произошёл.
     */
    async completeSuccess(id: string, data: {
      outputMediaId: string;
      creditsConsumed?: number;
      durationMs?: number;
    }): Promise<boolean> {
      const res = await db.update(generations)
        .set({
          status: 'success',
          outputMediaId: data.outputMediaId,
          completedAt: new Date(),
          ...(data.creditsConsumed !== undefined ? { creditsConsumed: data.creditsConsumed } : {}),
          ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
        })
        .where(and(eq(generations.id, id), inArray(generations.status, IN_FLIGHT)))
        .returning({ id: generations.id });
      return res.length > 0;
    },

    async markFailed(id: string, failCode: string | undefined, failMessage: string | undefined) {
      const res = await db.update(generations)
        .set({
          status: 'failed',
          completedAt: new Date(),
          ...(failCode ? { failCode } : {}),
          ...(failMessage ? { failMessage } : {}),
        })
        .where(and(eq(generations.id, id), inArray(generations.status, IN_FLIGHT)))
        .returning({ id: generations.id });
      return res.length > 0;
    },

    async markGenerating(id: string) {
      await db.update(generations)
        .set({ status: 'generating' })
        .where(and(eq(generations.id, id), inArray(generations.status, ['pending', 'submitted'])));
    },

    /**
     * Задачи, по которым callback так и не пришёл. Их добирает воркер опросом.
     * `olderThanSec` отсчитывается от создания — callback обычно приходит
     * за 40–80 секунд, поэтому разумный порог 90+.
     */
    async staleInFlight(olderThanSec: number, limit = 20) {
      return db.select().from(generations)
        .where(and(
          inArray(generations.status, IN_FLIGHT),
          sql`${generations.kieTaskId} is not null`,
          lt(generations.createdAt, new Date(Date.now() - olderThanSec * 1000)),
        ))
        .limit(limit);
    },

    /**
     * Всё, что мы нарисовали в этом диалоге, по порядку.
     *
     * Пришло на смену `lastResult(userId)`: та отдавала одну последнюю
     * удачную генерацию **без оглядки на время**, и backend молча подставлял
     * её вместо только что присланного фото. Теперь картинки не выбираются
     * за модель — ей отдаётся весь список, а выбор делает она (ADR 0010).
     */
    async resultsForConversation(conversationId: string) {
      const rows = await db.select({
        mediaId: generations.outputMediaId,
        caption: generations.caption,
        userPrompt: generations.userPrompt,
        // Нужен, чтобы отличить мир из игры от обычной правки фотографии.
        kind: generations.kind,
        // По какому заданию сделана работа. Наследуется по цепочке правок:
        // потомок картинки задания остаётся работой по тому же заданию.
        taskId: generations.taskId,
        // Из какого стартового мира — наследуется так же по цепочке.
        worldId: generations.worldId,
        at: generations.completedAt,
      })
        .from(generations)
        .where(and(
          eq(generations.conversationId, conversationId),
          eq(generations.status, 'success'),
          sql`${generations.outputMediaId} is not null`,
        ))
        .orderBy(generations.completedAt);
      return rows.filter((r): r is typeof r & { mediaId: string } => r.mediaId !== null);
    },

    /**
     * ВСЕ удачные генерации участника с их перцептивными хешами.
     *
     * Именно все, а не последняя: участник мог сделать пять картинок и
     * выложить вторую. Спрашивать «а какую именно ты выложил?» — плохой
     * вопрос: человек не помнит формулировок, а бот и так может узнать
     * картинку сам. Сравнение хешей стоит копейки, скачиваем мы только
     * картинку с публикации.
     *
     * По участнику, а не по диалогу: пост он мог выложить вчера, а ссылку
     * прислать сегодня, когда диалог уже остыл.
     */
    async successfulWithHashes(userId: string, limit = 60) {
      return db.select({
        id: generations.id,
        mediaId: generations.outputMediaId,
        phash: media.phash,
        at: generations.completedAt,
      })
        .from(generations)
        .innerJoin(media, eq(media.id, generations.outputMediaId))
        .where(and(
          eq(generations.userId, userId),
          eq(generations.status, 'success'),
        ))
        .orderBy(desc(generations.completedAt))
        .limit(limit);
    },

    /** Сколько задач у пользователя сейчас в работе — для лимита «одна за раз». */
    async activeCountForUser(userId: string): Promise<number> {
      const [row] = await db.select({ n: sql<number>`count(*)::int` })
        .from(generations)
        .where(and(eq(generations.userId, userId), inArray(generations.status, IN_FLIGHT)));
      return row?.n ?? 0;
    },
  };
}

export function mediaRepo(db: Db) {
  return {
    async create(input: {
      path: string; mimeType: string; bytes: number; sha256: string;
      source: string; width?: number; height?: number; expiresAt?: Date;
    }) {
      const [row] = await db.insert(media).values({
        path: input.path,
        mimeType: input.mimeType,
        bytes: input.bytes,
        sha256: input.sha256,
        source: input.source,
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      }).returning();
      return row!;
    },

    async byId(id: string) {
      const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
      return row;
    },

    /**
     * Запоминает ссылку на копию в хранилище kie.ai.
     * Реестр картинок прикладывает к запросу до шести штук — без кэша это
     * были бы шесть заливок на каждое сообщение участника (ADR 0010).
     */
    /** Перцептивный хеш — им сверяется картинка в репосте (ADR 0007). */
    async rememberPhash(id: string, phash: string) {
      await db.update(media).set({ phash }).where(eq(media.id, id));
    },

    async rememberRemoteUrl(id: string, url: string, expiresAt: Date) {
      await db.update(media)
        .set({ remoteUrl: url, remoteUrlExpiresAt: expiresAt })
        .where(eq(media.id, id));
    },
  };
}
