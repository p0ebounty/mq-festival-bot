import { describe, it, expect } from 'vitest';
import { buildProfessionPrompt, buildWorldPrompt, buildFreePrompt, DEFAULT_ASPECT } from '../src/images/prompts';

describe('сценарий 1: фото → профессия', () => {
  const fragment = 'Dress them in a white spacesuit inside a space station with Earth in the window.';

  it('требование сохранить лицо идёт в начале', () => {
    const p = buildProfessionPrompt({ professionFragment: fragment, idea: '' });
    expect(p.indexOf('strictly identical')).toBeLessThan(p.length / 2);
    expect(p).toContain('recognisably the same person');
  });

  it('запрещает «улучшать» внешность', () => {
    const p = buildProfessionPrompt({ professionFragment: fragment, idea: '' });
    expect(p).toContain('Do not beautify');
  });

  it('пожелание участника попадает в промпт дословно', () => {
    const p = buildProfessionPrompt({
      professionFragment: fragment,
      idea: 'with my hometown Kazan in the background',
    });
    expect(p).toContain('with my hometown Kazan in the background');
  });

  it('пожелание участника имеет приоритет над заготовкой каталога', () => {
    // Живая бага: участник просил родной город, а заготовка ставила Землю
    // в иллюминаторе — и просьба пропадала.
    const p = buildProfessionPrompt({
      professionFragment: fragment,
      idea: 'with my hometown in the background',
    });
    expect(p).toContain('takes priority');
    expect(p.indexOf('takes priority')).toBeGreaterThan(p.indexOf(fragment));
  });

  it('без пожеланий не добавляет пустой блок приоритета', () => {
    const p = buildProfessionPrompt({ professionFragment: fragment, idea: '' });
    expect(p).not.toContain('takes priority');
    expect(p).not.toMatch(/\s{3,}/);
  });

  it('запрещает текст и водяные знаки', () => {
    expect(buildProfessionPrompt({ professionFragment: fragment, idea: '' }))
      .toContain('No text, watermarks');
  });
});

describe('сценарий 2: мир → новый мир', () => {
  it('передаёт изменение дословно', () => {
    const p = buildWorldPrompt({ change: 'change the weather to a violent storm' });
    expect(p).toContain('change the weather to a violent storm');
  });

  it('требует сохранить всё остальное — иначе это новая картинка, а не правка', () => {
    const p = buildWorldPrompt({ change: 'add robots' });
    expect(p).toContain('Keep everything else identical');
    expect(p).toContain('artistic style');
    expect(p).toContain('Do not redraw the scene from scratch');
  });

  it('обрезает лишние пробелы вокруг просьбы', () => {
    expect(buildWorldPrompt({ change: '   add rain   ' })).toContain('Apply exactly this change: add rain');
  });
});

describe('свободная генерация', () => {
  it('не навязывает лишних ограничений, кроме качества', () => {
    const p = buildFreePrompt('a ginger cat on grandmothers sofa');
    expect(p).toContain('a ginger cat on grandmothers sofa');
    expect(p).not.toContain('Keep everything else identical');
    expect(p).not.toContain('strictly identical');
  });
});

describe('умолчания по кадру', () => {
  it('портрет для профессии, широкий для мира', () => {
    expect(DEFAULT_ASPECT.profession).toBe('3:4');
    expect(DEFAULT_ASPECT.world).toBe('16:9');
  });
});
