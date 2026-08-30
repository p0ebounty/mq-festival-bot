import { describe, it, expect } from 'vitest';
import { dateTime, dateTimeFull, ADMIN_TIME_ZONE } from '../src/lib/format';

/**
 * Живой дефект 30.08: страница диалогов давала две ошибки гидратации.
 *
 * Причина — время без явного пояса. Сервер живёт в UTC и рисовал «13:15»,
 * браузер организатора в Москве — «16:15». React видел расхождение и
 * перерисовывал всю таблицу заново. Плюс в серверном рендере время было
 * на три часа раньше настоящего.
 *
 * Тест проверяет ровно причину: результат не должен зависеть от пояса,
 * в котором запущен процесс.
 */
describe('форматирование времени в админке', () => {
  const AT = '2026-08-30T13:15:00Z'; // 16:15 по Москве

  it('не зависит от пояса процесса', () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = 'UTC';
      const utc = dateTime(AT);
      process.env.TZ = 'Asia/Tokyo';
      const tokyo = dateTime(AT);
      expect(utc).toBe(tokyo);
    } finally {
      if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
    }
  });

  it('показывает время фестиваля, а не UTC', () => {
    expect(dateTime(AT)).toContain('16:15');
    expect(dateTimeFull(AT)).toContain('16:15:00');
  });

  it('пояс задан явно', () => {
    expect(ADMIN_TIME_ZONE).toBe('Europe/Moscow');
  });

  it('пустое значение не ломает таблицу', () => {
    expect(dateTime(null)).toBe('—');
    expect(dateTimeFull(undefined)).toBe('—');
  });
});
