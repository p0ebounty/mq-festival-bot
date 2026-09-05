import { describe, it, expect } from 'vitest';
import { generationPlaced, progressReply, PROGRESS_TEXT } from '../src/agent/progress-text.js';

/**
 * Карточка «Рисую…» и текст «Добавил» рядом — это противоречие, которое
 * заказчик 05.09 прочитал как поломку. Когда генерация поставлена, текст
 * пишет код и говорит про процесс, а не про результат.
 */
describe('текст ответа при поставленной генерации', () => {
  it('карточка ушла — отчёт модели о результате заменяется на «рисую»', () => {
    const r = progressReply('Добавил НЛО в небо над марсианской станцией.', true);
    expect(r.overridden).toBe(true);
    expect(r.text).toBe(PROGRESS_TEXT);
    expect(r.text).not.toMatch(/добавил|готово|сделал/i);
    expect(r.text).toMatch(/карточке выше/);
  });

  it('генерация считается поставленной только по принятому edit_image/generate_image', () => {
    const accepted = { ok: true, data: { status: 'accepted' } };
    expect(generationPlaced([{ name: 'edit_image', result: accepted }])).toBe(true);
    expect(generationPlaced([{ name: 'generate_image', result: accepted }])).toBe(true);
    // Выдача задания тоже шлёт картинку, но рисовать на ней нечего —
    // «напиши своими словами, что изменить» подменять нельзя (dev, 05.09).
    expect(generationPlaced([{ name: 'get_task', result: { ok: true, data: { task_title: 'x' } } }])).toBe(false);
    // Отказ по лимиту «одна картинка за раз» — генерации нет.
    expect(generationPlaced([{ name: 'edit_image', result: { ok: false } }])).toBe(false);
    expect(generationPlaced([])).toBe(false);
  });

  it('карточки не было — текст модели остаётся как есть', () => {
    const r = progressReply('Сначала пришли своё фото.', false);
    expect(r.overridden).toBe(false);
    expect(r.text).toBe('Сначала пришли своё фото.');
  });
});
