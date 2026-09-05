import { describe, it, expect, vi } from 'vitest';
import { progressTick, CAPTION_EVERY_MS } from '../src/workers/progress.js';
import { drawingCaption, DRAWING_CALM, DRAWING_STEPS } from '../src/bot/phrases.js';

/**
 * Живая подпись карточки «Рисую…»: участники 05.09 принимали неподвижную
 * карточку за зависание. Состояние — в базе (created_at), а не в таймерах,
 * поэтому воркер переживает рестарт.
 */
const T0 = 1_000_000;

function harness(rows: Array<{ id: string; ageSec: number; status?: string }>) {
  const byStatus = new Map(rows.map((r) => [r.id, r.status ?? 'generating']));
  const generations = {
    inFlightWithCard: vi.fn(async () => rows.map((r) => ({
      id: r.id, tgChatId: 42n, placeholderMessageId: 7n, status: r.status ?? 'generating',
      createdAt: new Date(T0 - r.ageSec * 1000),
    }))),
    byId: vi.fn(async (id: string) => ({ id, status: byStatus.get(id) ?? 'generating' })),
  };
  const api = {
    editMessageCaption: vi.fn(async () => true),
    sendChatAction: vi.fn(async () => true),
  };
  const log = { warn: vi.fn(), debug: vi.fn() };
  return { deps: { generations, api, log } as never, api, generations };
}

describe('живая подпись карточки', () => {
  it('статус «отправляет фото» — на каждом проходе, подпись — только с 15-й секунды', async () => {
    const h = harness([{ id: 'g1', ageSec: 6 }]);
    await progressTick(h.deps, new Map(), T0);
    expect(h.api.sendChatAction).toHaveBeenCalledWith(42, 'upload_photo');
    expect(h.api.editMessageCaption).not.toHaveBeenCalled();
  });

  it('подпись меняется по шагам и не дёргается внутри одного шага', async () => {
    const h = harness([{ id: 'g1', ageSec: 31 }]);
    const memo = new Map<string, number>();
    await progressTick(h.deps, memo, T0);
    await progressTick(h.deps, memo, T0 + 2000);
    expect(h.api.editMessageCaption).toHaveBeenCalledTimes(1);
    expect(h.api.editMessageCaption).toHaveBeenCalledWith(42, 7, { caption: drawingCaption(31) });
    expect(memo.get('g1')).toBe(Math.floor(31_000 / CAPTION_EVERY_MS));
  });

  it('после рестарта (пустая память) подпись ставится сразу по текущему шагу', async () => {
    const h = harness([{ id: 'g1', ageSec: 95 }]);
    await progressTick(h.deps, new Map(), T0);
    expect(h.api.editMessageCaption).toHaveBeenCalledWith(42, 7, { caption: drawingCaption(95) });
  });

  it('картинка успела подмениться между выборкой и правкой — подпись на неё не ложится', async () => {
    const h = harness([{ id: 'g1', ageSec: 40 }]);
    h.generations.byId.mockResolvedValueOnce({ id: 'g1', status: 'success' } as never);
    await progressTick(h.deps, new Map(), T0);
    expect(h.api.editMessageCaption).not.toHaveBeenCalled();
  });

  it('память чистится, когда генерация ушла из полёта', async () => {
    const memo = new Map([['gone', 3]]);
    const h = harness([]);
    await progressTick(h.deps, memo, T0);
    expect(memo.size).toBe(0);
  });
});

describe('фразы процесса', () => {
  it('идут по кругу каждые 15 секунд, без счётчика времени', () => {
    expect(drawingCaption(0)).toMatch(/…$/);
    expect(drawingCaption(30)).not.toBe(drawingCaption(15));
    expect(drawingCaption(75)).not.toMatch(/\d:\d\d/);
  });

  it('до минуты — короткие про процесс, с минуты — успокаивающие', () => {
    expect(DRAWING_STEPS).toContain(drawingCaption(45));
    expect(DRAWING_CALM).toContain(drawingCaption(60));
    expect(DRAWING_CALM).toContain(drawingCaption(240));
    // Все двенадцать успокаивающих успевают показаться за три минуты, по кругу.
    expect(drawingCaption(60)).toBe(DRAWING_CALM[0]);
    expect(drawingCaption(60 + 15 * DRAWING_CALM.length)).toBe(DRAWING_CALM[0]);
  });
});
