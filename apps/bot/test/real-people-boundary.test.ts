import { describe, it, expect } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT } from '@mq/core';
import { MODERATION_SYSTEM } from '../src/moderation/classifier.js';

/**
 * Граница «реальные люди» записана в ДВУХ местах: в характере бота
 * (packages/core, prompt.ts) и у проверяющего перед генерацией
 * (apps/bot, classifier.ts). Оба текста пишут люди, в разное время и в
 * разных пакетах, и 04.09 они разошлись: агент отказывал в Тесле сам, а
 * классификатор по границе «до XX века» резал Эйнштейна и Гагарина —
 * умерших в XX веке, а не до него.
 *
 * Это тест на КОНСТРУКЦИЮ, а не на модель: живая модель может решить
 * что угодно, и её решения гоняет scripts/moderation-calibrate.mts. Здесь
 * же проверяется, что двум моделям рассказали одну и ту же историю —
 * одна календарная граница, одни имена-примеры, одно исключение для
 * политиков. Разъехавшиеся слои дают участнику отказ на разрешённом
 * запросе, и ни один из слоёв сам по себе не выглядит сломанным.
 */
describe('граница «реальные люди» в двух слоях', () => {
  const layers = {
    'характер бота': DEFAULT_SYSTEM_PROMPT,
    'проверяющий': MODERATION_SYSTEM,
  };

  /** Переносы строк с отступом в промпте — это один пробел в классификаторе. */
  const flat = (s: string) => s.replace(/\s+/g, ' ');

  it('оба слоя проводят одну календарную границу', () => {
    for (const [name, text] of Object.entries(layers)) {
      expect(text, name).toContain('умер в XX веке или раньше');
      // Прежняя формулировка отсекала Эйнштейна и Гагарина.
      expect(text, name).not.toContain('деятели до XX века');
    }
  });

  it('оба слоя называют одни и те же примеры разрешённых', () => {
    // Две оси: до XX века — любой, включая правителей; в XX веке — известен не властью.
    const rulers = 'Пётр I, Наполеон, Кутузов, Леонардо, Пушкин';
    const makers = 'Тесла, Эйнштейн, Гагарин, Королёв';
    for (const [name, text] of Object.entries(layers)) {
      expect(flat(text), name).toContain(rulers);
      expect(flat(text), name).toContain(makers);
    }
  });

  it('оба слоя одинаково вычитают из истории политиков', () => {
    const politics = 'Сталин, Ленин, Гитлер, Черчилль, Николай II';
    for (const [name, text] of Object.entries(layers)) {
      expect(flat(text), name).toContain(politics);
    }
  });

  it('оба слоя пропускают выдуманных персонажей и имя как стиль', () => {
    // Запрет про живых людей, а не про фантазию — это записано у бота;
    // проверяющему это сказано прямо, иначе имя актёра или художника в
    // фразе участника резало бы персонажа и стиль как «реального человека».
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Выдуманные персонажи');
    expect(MODERATION_SYSTEM).toContain('Джек Воробей, Человек-паук — МОЖНО');
    for (const [name, text] of Object.entries(layers)) {
      expect(flat(text), name).toContain('в стиле Миядзаки');
      expect(text, name).toContain('Человек-паук');
    }
  });

  it('недавно умершие — XXI век — под запретом в обоих слоях, одними примерами', () => {
    const recent = 'Стив Джобс, Майкл Джексон, Стивен Хокинг';
    for (const [name, text] of Object.entries(layers)) {
      expect(flat(text), name).toContain(recent);
      expect(text, name).toContain('XXI веке');
    }
  });

  it('участник на своём снимке разрешён в обоих слоях', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('сам участник с его собственного снимка');
    expect(MODERATION_SYSTEM).toContain('Сам участник на своём снимке — МОЖНО');
  });
});
