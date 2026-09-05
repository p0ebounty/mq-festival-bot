import { describe, it, expect } from 'vitest';
import { generationPlaced, shapeReply, taskIssued, PROGRESS_TEXT } from '../src/agent/progress-text.js';

/**
 * Что уходит участнику после хода агента, решает код по результатам
 * инструментов. Два живых случая 05.09: карточка «Рисую…» и рядом «Добавил»
 * (противоречие заказчик прочитал как поломку); выдано задание и следом
 * «Пусть сам опишет, что изменить — в этом и интерес» (мысль вслух поверх
 * понятной картинки).
 */
const accepted = { ok: true, data: { status: 'accepted' } };

describe('текст ответа после хода агента', () => {
  it('генерация считается поставленной только по принятому edit_image/generate_image', () => {
    expect(generationPlaced([{ name: 'edit_image', result: accepted }])).toBe(true);
    expect(generationPlaced([{ name: 'generate_image', result: accepted }])).toBe(true);
    expect(generationPlaced([{ name: 'get_task', result: { ok: true, data: { task: 'x' } } }])).toBe(false);
    // Отказ по лимиту «одна картинка за раз» — генерации нет.
    expect(generationPlaced([{ name: 'edit_image', result: { ok: false } }])).toBe(false);
    expect(generationPlaced([])).toBe(false);
  });

  it('задание считается выданным только по удачному get_task', () => {
    expect(taskIssued([{ name: 'get_task', result: { ok: true } }])).toBe(true);
    // Пул пуст — задания нет, слова модели нужны («заданий нет, пришли фото»).
    expect(taskIssued([{ name: 'get_task', result: { ok: false } }])).toBe(false);
    expect(taskIssued([{ name: 'edit_image', result: accepted }])).toBe(false);
  });

  it('выдано задание — участнику не уходит ничего', () => {
    const r = shapeReply('Пусть сам опишет, что на картинке надо изменить — в этом и интерес.',
      [{ name: 'get_task', result: { ok: true } }]);
    expect(r).toEqual({ text: '', override: 'task_issued' });
  });

  it('поставлена генерация — участнику не уходит ничего, карточка говорит сама', () => {
    const r = shapeReply('Добавил НЛО в небо над марсианской станцией.', [{ name: 'edit_image', result: accepted }]);
    expect(r).toEqual({ text: PROGRESS_TEXT, override: 'progress' });
    expect(r.text).toBe('');
  });

  it('ничего не поставлено и не выдано — слова модели как есть', () => {
    expect(shapeReply('Сначала пришли своё фото.', [])).toEqual({ text: 'Сначала пришли своё фото.' });
    expect(shapeReply('Доделаю эту, потом твою.', [{ name: 'edit_image', result: { ok: false } }]))
      .toEqual({ text: 'Доделаю эту, потом твою.' });
  });
});
