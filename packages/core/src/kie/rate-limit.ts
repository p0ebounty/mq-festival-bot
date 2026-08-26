/**
 * Token bucket под лимит kie.ai: 20 новых задач за 10 секунд на аккаунт.
 * Превышение — это 429 и потерянный запрос (в очередь он НЕ встаёт),
 * поэтому лучше подождать у себя, чем получить отказ.
 */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly limit = 20,
    private readonly windowMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Сколько миллисекунд ждать до следующего разрешённого запроса (0 — можно сразу). */
  delayMs(): number {
    const t = this.now();
    this.timestamps = this.timestamps.filter((ts) => t - ts < this.windowMs);
    if (this.timestamps.length < this.limit) return 0;
    const oldest = this.timestamps[0]!;
    return Math.max(0, this.windowMs - (t - oldest));
  }

  /** Отмечает израсходованный слот. Вызывать непосредственно перед запросом. */
  consume(): void {
    this.timestamps.push(this.now());
  }

  async acquire(sleep: (ms: number) => Promise<void> = defaultSleep): Promise<void> {
    let wait = this.delayMs();
    while (wait > 0) {
      await sleep(wait);
      wait = this.delayMs();
    }
    this.consume();
  }

  /** Занято слотов в текущем окне — для метрик и админки. */
  used(): number {
    const t = this.now();
    this.timestamps = this.timestamps.filter((ts) => t - ts < this.windowMs);
    return this.timestamps.length;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
