import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SYSTEM_PROMPT, buildSystemPrompt } from '../src/agent/prompt';

describe('системный промпт', () => {
  it('не содержит обратных кавычек — они рвут шаблонную строку', () => {
    // Наступали дважды: имя инструмента в бэктиках ломало сборку файла.
    // Тест дешевле, чем ещё раз ловить это на typecheck.
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('`');
  });

  it('достаточно содержательный, а не заглушка', () => {
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(2000);
  });

  it('в исходнике шаблонная строка закрыта', () => {
    const src = readFileSync(new URL('../src/agent/prompt.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('DEFAULT_SYSTEM_PROMPT'));
    const open = body.indexOf('`');
    const close = body.indexOf('`', open + 1);
    expect(close - open).toBeGreaterThan(2000);
  });

  it('несёт ключевые правила продукта', () => {
    for (const rule of [
      'обогащаешь',          // не переписывать мысль участника
      'Вопрос — это не команда',
      'private_note_do_not_send',
      'Эмодзи',
      'suggest_replies',
    ]) {
      expect(DEFAULT_SYSTEM_PROMPT, `нет правила: ${rule}`).toContain(rule);
    }
  });

  it('подставляет состояние участника', () => {
    const p = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
      firstName: 'Артём', tokenBalance: 5, costPerImage: 1,
    });
    expect(p).toContain('Артём');
    expect(p).toContain('5 токен');
  });

  it('предупреждает, когда токенов не хватает', () => {
    const p = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
      firstName: null, tokenBalance: 0, costPerImage: 1,
    });
    expect(p).toContain('НЕ ХВАТАЕТ');
  });
});

describe('состояние картинок в промпте', () => {
  it('без картинок — просить прислать, а не гадать', () => {
    const p = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
      tokenBalance: 5, costPerImage: 1, imageCount: 0,
    });
    expect(p).toContain('попроси прислать фото');
  });

  it('с картинками — сколько их и откуда брать номер', () => {
    const p = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
      tokenBalance: 5, costPerImage: 1, imageCount: 4,
    });
    expect(p).toContain('Картинок в этом разговоре: 4');
    expect(p).toContain('номер');
  });
});

/**
 * Выбор картинки — то, на чём бот ошибался живьём: правил не тот снимок.
 * Промпт обязан объяснять правило, а не надеяться на догадливость модели.
 */
describe('правило выбора картинки', () => {
  const p = DEFAULT_SYSTEM_PROMPT;

  it('учит брать подходящую по смыслу, а не последнюю по счёту', () => {
    expect(p).toContain('не «последнюю по счёту»');
  });

  it('даёт разобранный пример с котом и собакой', () => {
    expect(p).toContain('добавь коту мороженое');
  });

  it('велит спросить, если непонятно, а не угадывать', () => {
    expect(p).toMatch(/не уверен[^.]*спроси/i);
  });

  it('запрещает показывать внутренние номера участнику', () => {
    expect(p).toMatch(/Номера[\s\S]{0,80}не показывай/i);
  });

  it('не упоминает удалённые инструменты', () => {
    for (const gone of ['restyle_photo', 'transform_world', 'list_professions', 'edit_photo']) {
      expect(p, gone).not.toContain(gone);
    }
  });
})
