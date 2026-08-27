import { describe, it, expect } from 'vitest';
import {
  decodeSuggestion, fitCallbackText, suggestionKeyboard, SUGGEST_PATTERN,
} from '../src/bot/suggest-button.js';

/**
 * Кнопки-подсказки переехали с нижней панели на inline (27.08): панель
 * принадлежит чату, а не сообщению, и снять её можно было только новым
 * сообщением — поэтому она болталась всю генерацию, а то и навсегда.
 */
describe('кнопки-подсказки', () => {
  it('подпись и полезная нагрузка — одна и та же строка', () => {
    // Иначе на кнопке написано одно, а от лица участника уйдёт другое.
    const kb = suggestionKeyboard(['Хочу космонавтом'])!;
    const btn = kb.inline_keyboard[0]![0]! as { text: string; callback_data: string };
    expect(btn.callback_data.endsWith(btn.text)).toBe(true);
    expect(decodeSuggestion(btn.callback_data)).toBe(btn.text);
  });

  it('каждая кнопка в своём ряду — так они читаются на телефоне', () => {
    const kb = suggestionKeyboard(['Раз', 'Два', 'Три'])!;
    expect(kb.inline_keyboard).toHaveLength(3);
    for (const row of kb.inline_keyboard) expect(row).toHaveLength(1);
  });

  it('укладывается в 64 БАЙТА, а не символа', () => {
    // Кириллица — два байта на букву, эмодзи до четырёх. Лимит Telegram
    // байтовый, и 30 «безопасных» символов легко в него не влезают.
    for (const text of [
      'а'.repeat(30),
      'Хочу космонавтом на Марсе прямо',
      '🚀'.repeat(30),
      'Mixed текст 🚀 и ещё немного букв',
    ]) {
      const kb = suggestionKeyboard([text])!;
      const btn = kb.inline_keyboard[0]![0]! as { callback_data: string };
      expect(Buffer.byteLength(btn.callback_data, 'utf8'), text).toBeLessThanOrEqual(64);
    }
  });

  it('режет по символам, а не посреди буквы', () => {
    const cut = fitCallbackText('🚀'.repeat(30));
    expect(cut).toBe('🚀'.repeat(Math.floor(61 / 4)));
    expect(cut.includes('�')).toBe(false);
  });

  it('пустой список кнопок не рисует', () => {
    expect(suggestionKeyboard([])).toBeUndefined();
    expect(suggestionKeyboard(['', '   '])).toBeUndefined();
  });

  it('чужие нажатия не разбирает', () => {
    expect(decodeSuggestion('share:abcd1234')).toBeNull();
    expect(decodeSuggestion(undefined)).toBeNull();
    expect(decodeSuggestion('sg:')).toBeNull();
    expect(decodeSuggestion('sg:   ')).toBeNull();
  });

  it('шаблон ловит свои и не ловит кнопку «поделиться»', () => {
    expect(SUGGEST_PATTERN.test('sg:Хочу космонавтом')).toBe(true);
    expect(SUGGEST_PATTERN.test('share:1234')).toBe(false);
  });
});
