import { describe, it, expect } from 'vitest';
import { buildEditPrompt, buildFreePrompt, DEFAULT_ASPECT } from '../src/images/prompts';

/**
 * Раньше правок было две — «профессия» и «мир» — со своими сборщиками.
 * Теперь сборщик один (ADR 0010), и оба его требования обязаны работать
 * в КАЖДОЙ правке: и узнаваемость человека, и «меняй только названное».
 */
describe('правка картинки', () => {
  it('передаёт просьбу участника дословно', () => {
    const p = buildEditPrompt({ change: 'change the weather to a violent storm' });
    expect(p).toContain('Apply exactly this change: change the weather to a violent storm');
  });

  it('защищает лицо в любой правке, а не только в сценарии с профессией', () => {
    // Живая дыра прежней схемы: «перекрась куртку» шло мимо защиты лица,
    // и модель заодно «улучшала» человеку внешность.
    const p = buildEditPrompt({ change: 'repaint the jacket red' });
    expect(p).toContain('recognisably');
    expect(p).toContain('Do not beautify');
  });

  it('требование идентичности стоит в первой половине промпта', () => {
    // Замеры: спрятанное в конец требование модели теряют.
    const p = buildEditPrompt({ change: 'dress the person as a cosmonaut' });
    expect(p.indexOf('strictly identical')).toBeGreaterThan(-1);
    expect(p.indexOf('strictly identical')).toBeLessThan(p.length * 0.6);
  });

  it('требует сохранить остальное — иначе это новая картинка, а не правка', () => {
    const p = buildEditPrompt({ change: 'add robots' });
    expect(p).toContain('composition and framing');
    expect(p).toContain('artistic style');
    expect(p).toContain('Do not redraw the scene from scratch');
  });

  it('запрещает текст и водяные знаки', () => {
    expect(buildEditPrompt({ change: 'add rain' })).toContain('No text, watermarks');
  });

  it('обрезает лишние пробелы вокруг просьбы', () => {
    expect(buildEditPrompt({ change: '   add rain   ' }))
      .toContain('Apply exactly this change: add rain');
  });

  it('не оставляет пустот от собранных блоков', () => {
    expect(buildEditPrompt({ change: 'add rain' })).not.toMatch(/\s{3,}/);
  });
});

describe('свободная генерация', () => {
  it('не навязывает лишних ограничений, кроме качества', () => {
    const p = buildFreePrompt('a ginger cat on grandmothers sofa');
    expect(p).toContain('a ginger cat on grandmothers sofa');
    expect(p).not.toContain('Do not redraw the scene from scratch');
    expect(p).not.toContain('strictly identical');
  });
});

describe('умолчания по кадру', () => {
  it('портрет для профессии, широкий для мира', () => {
    expect(DEFAULT_ASPECT.profession).toBe('3:4');
    expect(DEFAULT_ASPECT.world).toBe('16:9');
  });
});
