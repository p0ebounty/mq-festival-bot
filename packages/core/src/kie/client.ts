import { KieError, kieErrorFor, KIE_CODES } from './errors';
import { RateLimiter } from './rate-limit';
import type { KieEnvelope, TaskRecord, TaskState, UploadResult } from './types';

export interface KieClientOptions {
  /** Функция, а не строка: ключ меняется из админки без рестарта (ADR 0005). */
  getApiKey: () => Promise<string> | string;
  baseUrl?: string;
  /**
   * File Upload API живёт на ОТДЕЛЬНОМ хосте. В OpenAPI у kie.ai в блоке
   * `servers` указан api.kie.ai — это неверно, оттуда приходит 404.
   * Настоящий хост виден только в curl-примерах quickstart.
   */
  uploadBaseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  rateLimiter?: RateLimiter;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class KieClient {
  private readonly baseUrl: string;
  private readonly uploadBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly limiter: RateLimiter;
  private readonly onRetry: NonNullable<KieClientOptions['onRetry']>;

  constructor(private readonly opts: KieClientOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.kie.ai').replace(/\/+$/, '');
    this.uploadBaseUrl = (opts.uploadBaseUrl ?? 'https://kieai.redpandaai.co').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? sleepDefault;
    this.limiter = opts.rateLimiter ?? new RateLimiter();
    this.onRetry = opts.onRetry ?? (() => {});
  }

  // ─────────────────── публичные операции ───────────────────

  /** Остаток кредитов. Самый дешёвый способ проверить ключ. */
  async getCredits(): Promise<number> {
    const data = await this.request<number | { credit?: number }>('GET', '/api/v1/chat/credit');
    return typeof data === 'number' ? data : (data?.credit ?? 0);
  }

  /**
   * Ставит задачу генерации. Возвращает taskId — НЕ результат.
   * Всё у kie.ai асинхронно: 200 означает лишь «задача создана».
   */
  async createTask(payload: Record<string, unknown>): Promise<string> {
    await this.limiter.acquire(this.sleep);
    const data = await this.request<{ taskId?: string }>('POST', '/api/v1/jobs/createTask', payload);
    const taskId = data?.taskId;
    if (!taskId) {
      throw new KieError('kie.ai не вернул taskId', KIE_CODES.SERVER, true,
        'Не удалось поставить задачу. Пробую ещё раз.');
    }
    return taskId;
  }

  /** Текущее состояние задачи. Резервный путь, если не пришёл callback. */
  async getTask(taskId: string): Promise<TaskRecord> {
    const d = await this.request<Record<string, unknown>>(
      'GET', `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
    return parseTaskRecord(d);
  }

  /** Загружает изображение в хранилище kie.ai и отдаёт URL для image_input. */
  async uploadBase64(params: {
    base64: string;
    fileName: string;
    uploadPath?: string;
  }): Promise<UploadResult> {
    const data = await this.request<UploadResult>('POST', '/api/file-base64-upload', {
      base64Data: params.base64,
      fileName: params.fileName,
      uploadPath: params.uploadPath ?? 'images/mqbot',
    }, { host: this.uploadBaseUrl });
    if (!data?.downloadUrl) {
      throw new KieError('загрузка не вернула downloadUrl', KIE_CODES.SERVER, true,
        'Не удалось загрузить фото. Пришли ещё раз.');
    }
    return data;
  }

  /**
   * Ждёт завершения задачи опросом. Используется как страховка и в тестах;
   * в проде основной путь — callback, а это добор потерянных.
   */
  async waitForTask(
    taskId: string,
    opts: { timeoutMs?: number; intervalMs?: number; onProgress?: (t: TaskRecord) => void } = {},
  ): Promise<TaskRecord> {
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const intervalMs = opts.intervalMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const rec = await this.getTask(taskId);
      opts.onProgress?.(rec);
      if (rec.state === 'success') return rec;
      if (rec.state === 'fail') {
        throw kieErrorFor(KIE_CODES.GENERATION_FAILED, rec.failMessage ?? rec.failCode);
      }
      if (Date.now() > deadline) {
        throw new KieError(`задача ${taskId} не завершилась за ${timeoutMs} мс`, 408, true,
          'Генерация затянулась. Пробую другой моделью.');
      }
      await this.sleep(intervalMs);
    }
  }

  // ─────────────────── транспорт ───────────────────

  private async request<T>(
    method: 'GET' | 'POST', path: string, body?: unknown, opts: { host?: string } = {},
  ): Promise<T> {
    let lastErr: KieError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Экспоненциальный откат с джиттером: без джиттера параллельные
        // задачи повторяются синхронно и снова упираются в лимит.
        const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
        const delay = Math.round(base * (0.5 + Math.random() * 0.5));
        this.onRetry({ attempt, delayMs: delay, reason: lastErr?.message ?? 'неизвестно' });
        await this.sleep(delay);
      }

      try {
        return await this.once<T>(method, path, body, opts.host ?? this.baseUrl);
      } catch (err) {
        if (!(err instanceof KieError) || !err.retryable) throw err;
        lastErr = err;
      }
    }
    throw lastErr ?? new KieError('запрос не удался', KIE_CODES.SERVER, false, 'Сервис недоступен.');
  }

  private async once<T>(method: 'GET' | 'POST', path: string, body: unknown, host: string): Promise<T> {
    const apiKey = await this.opts.getApiKey();
    if (!apiKey) {
      throw new KieError('ключ kie.ai не задан', KIE_CODES.UNAUTHORIZED, false,
        'Сервис генерации не настроен — напиши администратору.');
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${host}${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timeout = err instanceof Error && err.name === 'TimeoutError';
      throw new KieError(timeout ? 'таймаут запроса к kie.ai' : `сеть недоступна: ${String(err)}`,
        timeout ? 408 : 0, true, 'Сервис генерации не отвечает. Пробую ещё раз.');
    }

    const text = await res.text();
    let env: KieEnvelope<T> | null = null;
    try {
      env = JSON.parse(text) as KieEnvelope<T>;
    } catch {
      // Не-JSON от прокси/балансировщика: судим по HTTP-статусу.
      throw kieErrorFor(res.status, text.slice(0, 200));
    }

    // Ключевая особенность kie.ai: HTTP 200 с кодом ошибки внутри тела.
    const code = env.code ?? res.status;
    if (code !== KIE_CODES.OK) throw kieErrorFor(code, env.msg);
    return env.data as T;
  }
}

/** Парсер записи задачи. resultJson приходит СТРОКОЙ с JSON внутри. */
export function parseTaskRecord(d: Record<string, unknown>): TaskRecord {
  let resultUrls: string[] = [];
  const raw = d.resultJson;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { resultUrls?: unknown };
      if (Array.isArray(parsed.resultUrls)) {
        resultUrls = parsed.resultUrls.filter((u): u is string => typeof u === 'string');
      }
    } catch {
      // Битый resultJson не должен ронять обработку — вернём пустой список,
      // вызывающий код увидит success без URL и уйдёт в запасную модель.
    }
  }

  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

  return {
    taskId: String(d.taskId ?? ''),
    model: String(d.model ?? ''),
    state: (str(d.state) ?? 'waiting') as TaskState,
    resultUrls,
    ...(str(d.failCode) ? { failCode: str(d.failCode)! } : {}),
    ...(str(d.failMsg) ? { failMessage: str(d.failMsg)! } : {}),
    ...(num(d.costTime) !== undefined ? { costTimeMs: num(d.costTime)! } : {}),
    ...(num(d.creditsConsumed) !== undefined ? { creditsConsumed: num(d.creditsConsumed)! } : {}),
    ...(num(d.progress) !== undefined ? { progress: num(d.progress)! } : {}),
    ...(str(d.createTime) ? { createdAt: str(d.createTime)! } : {}),
    ...(str(d.completeTime) ? { completedAt: str(d.completeTime)! } : {}),
  };
}
