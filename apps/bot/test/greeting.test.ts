import { describe, it, expect } from 'vitest';
import { greetingText, plural, START_CHIPS } from '../src/bot/greeting.js';

describe('приветствие на /start', () => {
  it('здоровается — именно с этого начиналась жалоба с прода', () => {
    const t = greetingText('Артём', { balance: 10, costPerImage: 1 });
    expect(t.startsWith('Привет, Артём!')).toBe(true);
  });

  it('без имени всё равно здоровается', () => {
    expect(greetingText(null, { balance: 10, costPerImage: 1 })).toMatch(/^Привет! /);
  });

  it('называет все три возможности, включая готовый мир', () => {
    const t = greetingText('Аня', { balance: 10, costPerImage: 1 });
    expect(t).toContain('профессии будущего');
    expect(t).toContain('готовый мир');
    expect(t).toContain('с нуля');
  });

  it('считает баланс в картинках, а не в токенах', () => {
    expect(greetingText('Аня', { balance: 10, costPerImage: 1 })).toContain('хватит на 10 картинок');
    expect(greetingText('Аня', { balance: 6, costPerImage: 3 })).toContain('хватит на 2 картинки');
    expect(greetingText('Аня', { balance: 3, costPerImage: 3 })).toContain('хватит на 1 картинку');
  });

  it('при пустом балансе зовёт за бонусом, а не бросает в тупике', () => {
    const t = greetingText('Аня', { balance: 0, costPerImage: 1 });
    expect(t).toContain('репост');
    expect(t).not.toContain('хватит на');
  });

  it('без данных о балансе строку о токенах опускает целиком', () => {
    const t = greetingText('Аня', null);
    expect(t).not.toMatch(/токен/i);
    expect(t).toContain('Пиши обычным текстом');
  });

  it('кнопок ровно две и обе ведут к действию', () => {
    expect(START_CHIPS).toHaveLength(2);
    for (const c of START_CHIPS) expect(c.length).toBeLessThanOrEqual(30);
  });
});

describe('склонение после числа', () => {
  it.each([
    [1, 'картинку'], [2, 'картинки'], [4, 'картинки'], [5, 'картинок'],
    [11, 'картинок'], [12, 'картинок'], [14, 'картинок'], [21, 'картинку'],
    [22, 'картинки'], [25, 'картинок'], [111, 'картинок'], [101, 'картинку'],
    [0, 'картинок'],
  ])('%i → %s', (n, want) => {
    expect(plural(n, 'картинку', 'картинки', 'картинок')).toBe(want);
  });
});
