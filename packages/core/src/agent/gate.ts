/**
 * Заслон от перегрузки + последовательная очередь на участника.
 *
 * Идея: сообщения одного человека НЕ отбрасываются, а выполняются по
 * очереди — он дописал мысль двумя сообщениями, и бот ответит на оба,
 * просто не одновременно. Отбрасываем только когда очередь уже глубокая:
 * это уже не «дописал мысль», а закидывание задачами.
 *
 * Три рубежа:
 *  1. Очередь на участника — один вызов модели за раз, остальные ждут.
 *  2. Скользящее окно на участника — сколько сообщений в час он может слать.
 *  3. Общий потолок — сколько вызовов модели идёт одновременно во всём боте.
 *     Защищает от толпы на стенде, когда каждый по отдельности в лимите.
 *
 * Память процесса, не БД: бот однопроцессный, лимиты нужны мгновенные.
 * При переезде на несколько процессов это уедет в Redis.
 */
export type Placement =
  | { status: 'started' }            // выполняется прямо сейчас
  | { status: 'queued'; ahead: number } // встал в очередь, впереди N
  | { status: 'rejected'; reason: 'queue_full' | 'rate' | 'overloaded'; retryAfterSec: number };

export interface UserGateOptions {
  /** Сколько сообщений участника может ждать своей очереди. */
  maxQueueDepth?: number;
  /** Сообщений от одного участника за окно. */
  messagesPerWindow?: number;
  windowMs?: number;
  /** Сколько вызовов модели одновременно во всём боте. */
  globalConcurrency?: number;
  now?: () => number;
}

export class UserGate {
  /** Цепочка промисов на участника — гарантирует строгий порядок. */
  private readonly chains = new Map<string, Promise<void>>();
  private readonly depth = new Map<string, number>();
  private readonly hits = new Map<string, number[]>();
  private globalActive = 0;

  private readonly maxQueueDepth: number;
  private readonly messagesPerWindow: number;
  private readonly windowMs: number;
  private readonly globalConcurrency: number;
  private readonly now: () => number;

  constructor(opts: UserGateOptions = {}) {
    this.maxQueueDepth = opts.maxQueueDepth ?? 2;
    this.messagesPerWindow = opts.messagesPerWindow ?? 30;
    this.windowMs = opts.windowMs ?? 60 * 60 * 1000;
    this.globalConcurrency = opts.globalConcurrency ?? 12;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Ставит задачу в очередь участника. Возвращает место сразу, а сама
   * задача выполнится, когда дойдёт черёд.
   */
  submit(
    userId: string,
    task: () => Promise<void>,
    /** Лимит можно переопределить на вызов: он живёт в настройках админки. */
    overrides: { messagesPerWindow?: number } = {},
  ): Placement {
    const t = this.now();
    const perWindow = overrides.messagesPerWindow ?? this.messagesPerWindow;

    const recent = (this.hits.get(userId) ?? []).filter((ts) => t - ts < this.windowMs);
    if (recent.length >= perWindow) {
      const oldest = recent[0]!;
      return {
        status: 'rejected', reason: 'rate',
        retryAfterSec: Math.ceil((this.windowMs - (t - oldest)) / 1000),
      };
    }

    const running = this.depth.get(userId) ?? 0;
    if (running > this.maxQueueDepth) {
      return { status: 'rejected', reason: 'queue_full', retryAfterSec: 10 };
    }

    // Общий потолок проверяем только для тех, кто начинает прямо сейчас:
    // ожидающие в очереди никого не нагружают.
    if (running === 0 && this.globalActive >= this.globalConcurrency) {
      return { status: 'rejected', reason: 'overloaded', retryAfterSec: 15 };
    }

    recent.push(t);
    this.hits.set(userId, recent);
    this.depth.set(userId, running + 1);

    const prev = this.chains.get(userId) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        this.globalActive += 1;
        try {
          await task();
        } finally {
          this.globalActive = Math.max(0, this.globalActive - 1);
        }
      })
      // Ошибка одной задачи не должна рвать цепочку следующих.
      .catch(() => {})
      .finally(() => {
        const left = (this.depth.get(userId) ?? 1) - 1;
        if (left <= 0) {
          this.depth.delete(userId);
          this.chains.delete(userId);
        } else {
          this.depth.set(userId, left);
        }
      });

    this.chains.set(userId, next);
    return running === 0 ? { status: 'started' } : { status: 'queued', ahead: running };
  }

  stats(): { queuedUsers: number; globalActive: number; trackedUsers: number } {
    return {
      queuedUsers: this.depth.size,
      globalActive: this.globalActive,
      trackedUsers: this.hits.size,
    };
  }

  /** Периодическая уборка, чтобы карта не росла всю смену фестиваля. */
  sweep(): void {
    const t = this.now();
    for (const [userId, list] of this.hits) {
      const recent = list.filter((ts) => t - ts < this.windowMs);
      if (recent.length === 0) this.hits.delete(userId);
      else this.hits.set(userId, recent);
    }
  }
}
