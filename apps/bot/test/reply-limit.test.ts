import { describe, it, expect } from 'vitest';
import { capReply, MAX_REPLY_CHARS, DRAWING_TOOLS } from '../src/agent/reply-limit';

/**
 * Числа здесь — не выдумка, а замеры с прода на 28.08. Если порог соберутся
 * двигать, двигать его надо против этих же данных.
 */
const REAL_LEGIT_MAX = 417;   // самый длинный законный ответ за всё время (3 участника, 34 реплики)
const REAL_ABUSE = [2662, 2757, 3068, 7722]; // сценарий, python, сценарий, vite-проект

const fill = (n: number) => 'а'.repeat(n);

describe('ограничитель длины ответа', () => {
  it('пропускает обычные реплики бота', () => {
    for (const text of [
      'Илон Маск на Тесле уже в пути — скоро покажу.',
      'Держи мир: средневековый замок. Его можно менять одной фразой.',
      fill(REAL_LEGIT_MAX),
    ]) {
      const r = capReply(text, { drawing: false });
      expect(r.cut, `обрезал законное: ${text.length} знаков`).toBeUndefined();
      expect(r.text).toBe(text);
    }
  });

  it('режет все четыре реальных злоупотребления', () => {
    for (const chars of REAL_ABUSE) {
      const r = capReply(fill(chars), { drawing: false });
      expect(r.cut?.reason, `пропустил ${chars} знаков`).toBe('length');
      expect(r.cut?.chars).toBe(chars);
    }
  });

  it('между законным максимумом и порогом остаётся запас', () => {
    // Если запас съедят до полутора раз — порог занижен, надо пересматривать.
    expect(MAX_REPLY_CHARS / REAL_LEGIT_MAX).toBeGreaterThan(2);
    expect(MAX_REPLY_CHARS).toBeLessThan(Math.min(...REAL_ABUSE));
  });

  it('граница ровно на пороге не срабатывает, на знак дальше — срабатывает', () => {
    expect(capReply(fill(MAX_REPLY_CHARS), { drawing: false }).cut).toBeUndefined();
    expect(capReply(fill(MAX_REPLY_CHARS + 1), { drawing: false }).cut?.reason).toBe('length');
  });

  it('блок кода режется даже в коротком ответе', () => {
    const r = capReply('Вот и всё:\n```python\nprint(1)\n```', { drawing: false });
    expect(r.cut?.reason).toBe('code');
  });

  it('одиночная кавычка в подсказке — не блок кода', () => {
    // Приветствие и промпт легально используют `сделай ночь` одиночными кавычками.
    const r = capReply('Его можно менять одной фразой, например: `сделай ночь`', { drawing: false });
    expect(r.cut).toBeUndefined();
  });

  it('сохраняет оригинал целиком — иначе админка не покажет, что произошло', () => {
    const original = fill(3000);
    const r = capReply(original, { drawing: false });
    expect(r.cut?.original).toBe(original);
    expect(r.text).not.toBe(original);
  });

  it('не врёт человеку, когда картинка уже ушла', () => {
    // Живой случай 20:07: get_base_world успел отправить мир, а текст обрезан.
    // Сказать «я тут только про картинки» в этот момент — соврать.
    const drawing = capReply(fill(3000), { drawing: true }).text;
    const offTopic = capReply(fill(3000), { drawing: false }).text;
    expect(drawing).not.toBe(offTopic);
    expect(drawing).toMatch(/покажу/i);
    expect(offTopic).toMatch(/картинк/i);
  });

  it('заглушки сами проходят ограничитель — иначе будет петля', () => {
    for (const drawing of [true, false]) {
      const stub = capReply(fill(3000), { drawing }).text;
      expect(capReply(stub, { drawing }).cut).toBeUndefined();
    }
  });

  it('картинку выдают три инструмента, включая бесплатный мир', () => {
    expect(DRAWING_TOOLS.has('generate_image')).toBe(true);
    expect(DRAWING_TOOLS.has('edit_image')).toBe(true);
    expect(DRAWING_TOOLS.has('get_base_world')).toBe(true);
    expect(DRAWING_TOOLS.has('get_balance')).toBe(false);
    expect(DRAWING_TOOLS.has('suggest_replies')).toBe(false);
  });
});
