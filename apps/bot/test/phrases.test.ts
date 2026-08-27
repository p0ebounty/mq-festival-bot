import { describe, it, expect } from 'vitest';
import { unsupportedReply } from '../src/bot/phrases.js';

/**
 * Голосовые убраны (ADR 0009): модели OpenAI отвечают на аудио HTTP 400.
 * Тест сторожит две вещи — что отказ есть и что бот нигде не обещает
 * разобрать голосовое. Обещание в тексте стоило участнику полминуты
 * ожидания и ответа «не получилось обдумать» (живой случай 27.08).
 */
describe('ответы на неподдерживаемые типы', () => {
  it('голосовое и кружок получают свой отказ, а не общий', () => {
    expect(unsupportedReply('voice')).not.toBe(unsupportedReply('other'));
    expect(unsupportedReply('video_note')).not.toBe(unsupportedReply('other'));
  });

  it('отказ по голосовому зовёт написать текстом', () => {
    expect(unsupportedReply('voice')).toMatch(/текстом/i);
  });

  it('ни один ответ не обещает, что бот разберёт голосовое', () => {
    const kinds = ['voice', 'video_note', 'video', 'animation', 'document',
      'sticker', 'audio', 'location', 'contact', 'poll', 'other', 'нечто'];
    for (const kind of kinds) {
      const text = unsupportedReply(kind);
      expect(text, kind).not.toMatch(/голосов\w*\s+(разберу|пойму|услышу)/i);
      expect(text, kind).not.toMatch(/пришли[^.]*голосов/i);
    }
  });

  it('неизвестный тип не роняет и не отдаёт пустоту', () => {
    expect(unsupportedReply('未知')).toBe(unsupportedReply('other'));
    expect(unsupportedReply('other').length).toBeGreaterThan(10);
  });
});
