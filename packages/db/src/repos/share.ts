import { eq, sql } from 'drizzle-orm';
import type { Db } from '../index';
import { generations, media, shortLinks } from '../schema';

/**
 * Короткие ссылки на результаты — то, куда ведёт QR-код (фаза 7 ТЗ).
 *
 * Ссылка привязана к генерации, а не к файлу: страница показывает и
 * подпись, которую написал агент, и картинку, и обе живут в разных
 * таблицах.
 */
export function shareRepo(db: Db) {
  return {
    /**
     * Ссылка для генерации: существующая либо новая.
     *
     * Идентификатор придумывает вызывающий (`makeShortId` из @mq/core) —
     * репозиторий не должен знать про crypto. Коллизия по уникальному
     * индексу здесь **штатна**, поэтому вставка идёт с `onConflictDoNothing`
     * и повтором, а не с падением: 40 бит энтропии делают второй виток
     * почти невозможным, но «почти» на фестивале случается.
     */
    async ensure(generationId: string, makeId: () => string, attempts = 5) {
      const [existing] = await db.select().from(shortLinks)
        .where(eq(shortLinks.generationId, generationId)).limit(1);
      if (existing) return existing;

      for (let i = 0; i < attempts; i++) {
        const [row] = await db.insert(shortLinks)
          .values({ shortId: makeId(), generationId })
          .onConflictDoNothing({ target: shortLinks.shortId })
          .returning();
        if (row) return row;
      }
      throw new Error(`не удалось подобрать свободный shortId за ${attempts} попыток`);
    },

    /** Уже созданная ссылка генерации — без попыток создать новую. */
    async byGenerationId(generationId: string) {
      const [row] = await db.select().from(shortLinks)
        .where(eq(shortLinks.generationId, generationId)).limit(1);
      return row;
    },

    /** Всё, что нужно странице результата, одним запросом. */
    async byShortId(shortId: string) {
      const [row] = await db.select({
        shortId: shortLinks.shortId,
        generationId: generations.id,
        caption: generations.caption,
        status: generations.status,
        mediaId: media.id,
        mediaPath: media.path,
        mimeType: media.mimeType,
        bytes: media.bytes,
      })
        .from(shortLinks)
        .innerJoin(generations, eq(generations.id, shortLinks.generationId))
        .innerJoin(media, eq(media.id, generations.outputMediaId))
        .where(eq(shortLinks.shortId, shortId))
        .limit(1);
      return row;
    },

    /**
     * Счётчик открытий. Отдельным запросом и без ожидания: страница не
     * должна ждать записи статистики, а потерянный счёт никого не ранит.
     */
    async countVisit(shortId: string) {
      await db.update(shortLinks)
        .set({ visits: sql`${shortLinks.visits} + 1` })
        .where(eq(shortLinks.shortId, shortId));
    },
  };
}
