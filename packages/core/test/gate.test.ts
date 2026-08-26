import { describe, it, expect } from 'vitest';
import { UserGate } from '../src/agent/gate';

const later = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

describe('очередь и заслон', () => {
  it('первое сообщение стартует сразу', () => {
    const g = new UserGate();
    expect(g.submit('u1', async () => {}).status).toBe('started');
  });

  it('второе встаёт в очередь, а не отбрасывается', async () => {
    const g = new UserGate();
    let released!: () => void;
    const blocker = new Promise<void>((r) => { released = r; });
    g.submit('u1', () => blocker);
    const second = g.submit('u1', async () => {});
    expect(second.status).toBe('queued');
    released();
    await later(5);
  });

  it('задачи одного участника выполняются ПО ПОРЯДКУ', async () => {
    const g = new UserGate();
    const order: number[] = [];
    g.submit('u1', async () => { await later(30); order.push(1); });
    g.submit('u1', async () => { await later(1); order.push(2); });
    await later(120);
    expect(order).toEqual([1, 2]);
  });

  it('разные участники не мешают друг другу', async () => {
    const g = new UserGate();
    let free: (() => void) | undefined;
    g.submit('u1', () => new Promise<void>((r) => { free = r; }));
    await later(5); // задача стартует микротаском позже submit
    expect(g.submit('u2', async () => {}).status).toBe('started');
    free?.();
    await later(5);
  });

  it('глубокая очередь отклоняется — это уже закидывание задачами', async () => {
    const g = new UserGate({ maxQueueDepth: 2 });
    let free: (() => void) | undefined;
    g.submit('u1', () => new Promise<void>((r) => { free = r; }));
    await later(5);
    g.submit('u1', async () => {});
    g.submit('u1', async () => {});
    const over = g.submit('u1', async () => {});
    expect(over.status).toBe('rejected');
    if (over.status === 'rejected') expect(over.reason).toBe('queue_full');
    free?.();
    await later(20);
  });

  it('часовой лимит срабатывает и подсказывает, когда вернуться', async () => {
    let now = 0;
    const g = new UserGate({ messagesPerWindow: 3, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 3; i++) { g.submit('u1', async () => {}); await later(1); }
    const over = g.submit('u1', async () => {});
    expect(over.status).toBe('rejected');
    if (over.status === 'rejected') {
      expect(over.reason).toBe('rate');
      expect(over.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it('лимит можно переопределить на вызов — он живёт в настройках', () => {
    let now = 0;
    const g = new UserGate({ messagesPerWindow: 100, now: () => now });
    g.submit('u1', async () => {});
    const over = g.submit('u1', async () => {}, { messagesPerWindow: 1 });
    expect(over.status).toBe('rejected');
  });

  it('окно освобождается со временем', async () => {
    let now = 0;
    const g = new UserGate({ messagesPerWindow: 1, windowMs: 1000, now: () => now });
    g.submit('u1', async () => {});
    await later(5);
    expect(g.submit('u1', async () => {}).status).toBe('rejected');
    now = 1500;
    expect(g.submit('u1', async () => {}).status).toBe('started');
  });

  it('общий потолок защищает от толпы', async () => {
    const g = new UserGate({ globalConcurrency: 2 });
    const frees: Array<() => void> = [];
    for (const u of ['a', 'b']) {
      g.submit(u, () => new Promise<void>((r) => frees.push(r)));
    }
    await later(5);
    const third = g.submit('c', async () => {});
    expect(third.status).toBe('rejected');
    if (third.status === 'rejected') expect(third.reason).toBe('overloaded');
    frees.forEach((f) => f());
    await later(10);
  });

  it('упавшая задача не рвёт цепочку следующих', async () => {
    const g = new UserGate();
    const done: string[] = [];
    g.submit('u1', async () => { throw new Error('бум'); });
    g.submit('u1', async () => { done.push('вторая выполнилась'); });
    await later(40);
    expect(done).toEqual(['вторая выполнилась']);
  });

  it('слот освобождается после работы', async () => {
    const g = new UserGate();
    g.submit('u1', async () => { await later(5); });
    await later(40);
    expect(g.stats().globalActive).toBe(0);
    expect(g.stats().queuedUsers).toBe(0);
  });

  it('уборка чистит старые счётчики', async () => {
    let now = 0;
    const g = new UserGate({ windowMs: 1000, now: () => now });
    g.submit('u1', async () => {});
    await later(10);
    now = 5000;
    g.sweep();
    expect(g.stats().trackedUsers).toBe(0);
  });
});
