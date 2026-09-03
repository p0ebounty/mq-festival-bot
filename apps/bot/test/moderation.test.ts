import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { moderate } from '../src/moderation/index.js';
import { parseVerdict } from '../src/moderation/classifier.js';
import { checkStoplist } from '../src/moderation/stoplist.js';
import type { AppContext } from '../src/context.js';

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

describe('срок ожидания проверки', () => {
  // Живой отказ 03.09 на деве: участник прислал фото и получил «проверка
  // сейчас недоступна». Две причины сошлись — kie.ai отдавал быстрый
  // HTTP 500 на зрении, а срок ожидания был общий, 12 с, хотя проверка с
  // картинкой отвечает 8–46 с. Обе превращали наш сбой в отказ участнику.
  const ANSWER = '{"allowed": true, "category": null, "reason": "обычное фото"}';
  const OK = { text: ANSWER, toolCalls: [], stopReason: 'end', usage: {} };

  function appWith(provider: unknown) {
    return {
      moderationProvider: () => Promise.resolve(provider),
      db: { insert: () => ({ values: () => Promise.resolve() }) },
    } as unknown as AppContext;
  }

  /** Прогоняет проверку, докручивая фейковые таймеры до её конца. */
  async function run(provider: unknown, input: Parameters<typeof moderate>[1]) {
    const p = moderate(appWith(provider), input);
    // С запасом: сюда входят и паузы между попытками, и сам срок ожидания.
    await vi.advanceTimersByTimeAsync(400_000);
    return p;
  }

  const PHOTO = {
    stage: 'photo' as const, text: 'что на фото', imageUrls: ['https://example.test/a.jpg'],
  };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('фото: проверка на 30 с успевает ответить', async () => {
    // Прежние 12 с обрывали её здесь, и fail-closed давал отказ.
    const provider = {
      id: 'fake',
      complete: () => new Promise((resolve) => { setTimeout(() => resolve(OK), 30_000); }),
    };
    expect((await run(provider, PHOTO)).allowed).toBe(true);
  });

  it('таймаут не повторяется: ожидание участника не удваивается', async () => {
    let n = 0;
    const provider = {
      id: 'fake',
      complete: () => { n++; return new Promise((resolve) => { setTimeout(() => resolve(OK), 90_000); }); },
    };
    const v = await run(provider, PHOTO);
    expect(v.allowed).toBe(false);
    expect(v.source).toBe('unavailable');
    expect(n).toBe(1);
  });

  it('быструю ошибку пробуем ещё раз — это могла быть сетевая икота', async () => {
    let n = 0;
    const provider = {
      id: 'fake',
      complete: () => {
        n++;
        return n === 1 ? Promise.reject(new Error('провайдер: HTTP 500')) : Promise.resolve(OK);
      },
    };
    expect((await run(provider, { stage: 'prompt', text: 'кот на скейте' })).allowed).toBe(true);
    expect(n).toBe(2);
  });

  it('сбой проверки попадает в журнал, а не тонет молча', async () => {
    const warn = vi.fn();
    const provider = { id: 'fake', complete: () => Promise.reject(new Error('провайдер: HTTP 500')) };
    const v = await run(provider, { ...PHOTO, log: { warn } });
    expect(v.allowed).toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0]?.[1]).toBe('проверка контента не ответила');
    expect(String(warn.mock.calls[0]?.[0]?.err)).toContain('HTTP 500');
  });

  describe('источник решения', () => {
    // Раньше источник выяснялся сравнением русских фраз («проверка сейчас
    // недоступна»): от правки текста молча сломались бы и журнал, и ответ
    // участнику.
    it('решение классификатора помечено как classifier', async () => {
      const provider = {
        id: 'fake',
        complete: () => Promise.resolve({
          text: '{"allowed": false, "category": "sexual", "reason": "нельзя"}',
          toolCalls: [], stopReason: 'end', usage: {},
        }),
      };
      expect((await run(provider, { stage: 'prompt', text: 'что-то' })).source).toBe('classifier');
    });

    it('недоступность помечена как unavailable, а не как запрет', async () => {
      const provider = { id: 'fake', complete: () => Promise.reject(new Error('HTTP 500')) };
      const d = await run(provider, { stage: 'photo', text: 'А что на этой фотке' });
      expect(d.source).toBe('unavailable');
      expect(d.category).toBeNull();
    });

    it('аварийный список помечен как stoplist', async () => {
      const provider = { id: 'fake', complete: () => Promise.reject(new Error('HTTP 500')) };
      const d = await run(provider, { stage: 'prompt', text: 'нарисуй свастику' });
      expect(d.source).toBe('stoplist');
      expect(d.category).toBe('hate');
    });
  });
});
