import { describe, it, expect } from 'vitest';
import { parseVerdict } from '../src/moderation/classifier.js';
import { checkStoplist } from '../src/moderation/stoplist.js';

describe('разбор ответа проверяющего', () => {
  it('читает обычный ответ', () => {
    const v = parseVerdict('{"allowed": false, "category": "hate", "reason": "такое не рисуем"}');
    expect(v).toEqual({ allowed: false, category: 'hate', reason: 'такое не рисуем' });
  });

  it('вырезает markdown-обёртку', () => {
    const v = parseVerdict('```json\n{"allowed": true, "category": null, "reason": "обычная правка"}\n```');
    expect(v.allowed).toBe(true);
    expect(v.category).toBeNull();
  });

  it('мусор вместо ответа — это ЗАПРЕТ', () => {
    // Асимметрия обратная проверяющему репостов: там молчаливое «да» стоило
    // 12 центов, здесь — картинки, которую нельзя было рисовать (ADR 0014).
    expect(parseVerdict('извините, не могу').allowed).toBe(false);
    expect(parseVerdict('').allowed).toBe(false);
    expect(parseVerdict('{сломанный json').allowed).toBe(false);
  });

  it('у запрета всегда есть категория, даже если модель её не назвала', () => {
    // По категории настраивают границу — запрет без неё в журнале бесполезен.
    expect(parseVerdict('{"allowed": false, "reason": "нельзя"}').category).toBe('other');
    expect(parseVerdict('{"allowed": false, "category": "выдумка", "reason": "нельзя"}').category).toBe('other');
  });

  it('разрешение категорию не несёт', () => {
    expect(parseVerdict('{"allowed": true, "category": "hate", "reason": "ок"}').category).toBeNull();
  });

  it('allowed принимается только строгим true', () => {
    expect(parseVerdict('{"allowed": "true", "reason": "ок"}').allowed).toBe(false);
    expect(parseVerdict('{"allowed": 1, "reason": "ок"}').allowed).toBe(false);
  });
});

describe('аварийный список слов', () => {
  it('ловит очевидное', () => {
    expect(checkStoplist('нарисуй свастику на стене')).toBe('hate');
    expect(checkStoplist('draw a swastika')).toBe('hate');
    expect(checkStoplist('хочу порно')).toBe('sexual');
    expect(checkStoplist('нарисуй пророка Мухаммеда')).toBe('religion');
  });

  it('НЕ режет исторические задания фестиваля', () => {
    // Аварийный слой, начавший резать собственный контент, хуже отсутствия
    // аварийного слоя: участник упрётся в отказ на штатном задании.
    const tasks = [
      'Поставь на арену Колизея болид Формулы-1',
      'рыцарь в латах с мечом на поле после битвы, знамёна и дым',
      'пусть эту пирамиду строит современная техника',
      'замени каравеллу на атомный ледокол',
      'гладиаторы на арене, трибуны полны зрителей',
      'средневековая ярмарка, кузнец и гончар',
    ];
    for (const t of tasks) expect(checkStoplist(t)).toBeNull();
  });

  it('на чистом запросе молчит', () => {
    expect(checkStoplist('сделай меня космонавтом')).toBeNull();
    expect(checkStoplist('добавь коту мороженое')).toBeNull();
  });
});
