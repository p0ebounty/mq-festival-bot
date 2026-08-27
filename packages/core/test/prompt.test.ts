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
  it('без мира — прямой запрет на transform_world', () => {
    const p = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
      tokenBalance: 5, costPerImage: 1, hasWorld: false, hasImage: true,
    });
    expect(p).toContain('Мира из игры у участника НЕТ');
    expect(p).toContain('не вызывай ни при каких формулировках');
  });

  it('с миром — разрешение', () => {
    const p = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
      tokenBalance: 5, costPerImage: 1, hasWorld: true, hasImage: true,
    });
    expect(p).toContain('ЕСТЬ мир из игры');
  });

  it('без картинки — просить прислать, а не гадать', () => {
    const p = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
      tokenBalance: 5, costPerImage: 1, hasWorld: false, hasImage: false,
    });
    expect(p).toContain('попроси прислать фото');
  });
})
