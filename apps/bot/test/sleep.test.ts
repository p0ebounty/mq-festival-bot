import { describe, it, expect } from 'vitest';
import type { Update } from 'grammy/types';
import {
  asleepAction, pickAsleepText, ASLEEP_TEXT, ASLEEP_SHORT, ASLEEP_TAP, REPEAT_WINDOW_MS,
} from '../src/bot/sleep.js';

/**
 * Спящий бот (фестиваль закончился): всё глушится заготовкой, кроме кнопки
 * «Скачать и поделиться» — свою работу участник вправе забрать и потом.
 */
const from = { id: 1, is_bot: false, first_name: 'Артём' };
const chat = { id: 1, type: 'private' as const, first_name: 'Артём' };
const msg = (extra: Record<string, unknown>) =>
  ({ update_id: 1, message: { message_id: 1, date: 0, chat, from, ...extra } }) as unknown as Update;
const tap = (data: string) =>
  ({ update_id: 1, callback_query: { id: 'x', from, chat_instance: '1', data } }) as unknown as Update;

describe('asleepAction', () => {
  it('текст, фото, стикер и команда получают заготовку', () => {
    expect(asleepAction(msg({ text: 'хочу космонавтом' }))).toBe('reply');
    expect(asleepAction(msg({ text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }))).toBe('reply');
    expect(asleepAction(msg({ photo: [{ file_id: 'a', file_unique_id: 'b', width: 1, height: 1 }] }))).toBe('reply');
    expect(asleepAction(msg({ sticker: {} }))).toBe('reply');
  });

  it('кнопка «поделиться» проходит: картинку забрать можно и после фестиваля', () => {
    expect(asleepAction(tap('share:abc123'))).toBe('pass');
  });

  it('кнопки-подсказки получают всплывашку, а не сообщение', () => {
    expect(asleepAction(tap('sg:Дай задание'))).toBe('toast');
    expect(asleepAction(tap(''))).toBe('toast');
  });

  it('прочие апдейты глушатся молча', () => {
    expect(asleepAction({ update_id: 1, edited_message: {} } as unknown as Update)).toBe('ignore');
    expect(asleepAction({ update_id: 1, my_chat_member: {} } as unknown as Update)).toBe('ignore');
  });
});

describe('тексты', () => {
  it('первый ответ полный, повтор в окне — короткий, после окна снова полный', () => {
    expect(pickAsleepText(undefined, 1000)).toBe(ASLEEP_TEXT);
    expect(pickAsleepText(1000, 1000 + 60_000)).toBe(ASLEEP_SHORT);
    expect(pickAsleepText(1000, 1000 + REPEAT_WINDOW_MS)).toBe(ASLEEP_TEXT);
  });

  it('заготовка говорит, что фестиваль закончился и что картинки остались', () => {
    for (const t of [ASLEEP_TEXT, ASLEEP_SHORT]) {
      expect(t).toMatch(/фестиваль закончился/i);
      expect(t).toMatch(/картинк/i);
    }
    expect(ASLEEP_TEXT).toMatch(/поделиться/);
  });

  it('всплывашка укладывается в лимит Telegram', () => {
    expect(ASLEEP_TAP.length).toBeLessThanOrEqual(200);
  });
});
