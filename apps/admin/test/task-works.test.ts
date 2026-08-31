import { describe, it, expect } from 'vitest';

/**
 * Схлопывание работ до последней попытки участника.
 *
 * Логика вынесена сюда как чистая функция, потому что проверять её на
 * живой базе дорого, а ошибиться в ней легко: показать все правки подряд
 * — значит утопить жюри в чужих черновиках, показать не ту попытку —
 * значит судить по промежуточному варианту.
 */
export function latestPerParticipant<T extends { userId: string; taskId: string | null }>(
  rowsNewestFirst: T[],
): Array<T & { attempts: number }> {
  const latest = new Map<string, T & { attempts: number }>();
  for (const r of rowsNewestFirst) {
    const key = `${r.userId}:${r.taskId}`;
    const seen = latest.get(key);
    if (seen) seen.attempts++;
    else latest.set(key, { ...r, attempts: 1 });
  }
  return [...latest.values()];
}

const row = (userId: string, taskId: string, id: string) => ({ userId, taskId, id });

describe('работы по заданиям в админке', () => {
  it('от одного участника по одному заданию остаётся одна карточка', () => {
    const out = latestPerParticipant([
      row('u1', 't1', 'третья'), row('u1', 't1', 'вторая'), row('u1', 't1', 'первая'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.attempts).toBe(3);
  });

  it('остаётся именно последняя попытка', () => {
    // Список приходит свежими вперёд, значит первая встреченная — финальная.
    const out = latestPerParticipant([row('u1', 't1', 'финал'), row('u1', 't1', 'черновик')]);
    expect(out[0]!.id).toBe('финал');
  });

  it('разные участники и разные задания не смешиваются', () => {
    const out = latestPerParticipant([
      row('u1', 't1', 'a'), row('u2', 't1', 'b'), row('u1', 't2', 'c'),
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.attempts === 1)).toBe(true);
  });

  it('одна попытка не подписывается счётчиком', () => {
    expect(latestPerParticipant([row('u1', 't1', 'a')])[0]!.attempts).toBe(1);
  });
});
