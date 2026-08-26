import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка подписи callback от kie.ai.
 * Правило из docs/vendor/kie/common-api_webhook-verification.md:
 *   base64( HMAC-SHA256( `${taskId}.${timestampSeconds}`, webhookHmacKey ) )
 * Заголовки: X-Webhook-Timestamp, X-Webhook-Signature.
 */
export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no-signature' | 'no-timestamp' | 'stale' | 'bad-signature' | 'no-task-id' };

export function signWebhook(taskId: string, timestampSeconds: number | string, secret: string): string {
  return createHmac('sha256', secret).update(`${taskId}.${timestampSeconds}`).digest('base64');
}

export function verifyWebhook(params: {
  taskId: string | undefined;
  signature: string | undefined | null;
  timestamp: string | undefined | null;
  secret: string;
  /** Окно защиты от повтора; по умолчанию 5 минут. */
  toleranceSec?: number;
  nowSec?: number;
}): VerifyResult {
  const { taskId, signature, timestamp, secret } = params;
  if (!taskId) return { ok: false, reason: 'no-task-id' };
  if (!signature) return { ok: false, reason: 'no-signature' };
  if (!timestamp) return { ok: false, reason: 'no-timestamp' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'no-timestamp' };

  // Защита от replay: старую подпись переиграть нельзя.
  const now = params.nowSec ?? Math.floor(Date.now() / 1000);
  const tolerance = params.toleranceSec ?? 300;
  if (Math.abs(now - ts) > tolerance) return { ok: false, reason: 'stale' };

  const expected = Buffer.from(signWebhook(taskId, timestamp, secret));
  const got = Buffer.from(signature);
  // timingSafeEqual падает на разной длине — сравниваем длину заранее.
  if (expected.length !== got.length) return { ok: false, reason: 'bad-signature' };
  return timingSafeEqual(expected, got) ? { ok: true } : { ok: false, reason: 'bad-signature' };
}

/** Тело callback. У kie.ai здесь snake_case, в отличие от recordInfo. */
export interface CallbackBody {
  code?: number;
  msg?: string;
  data?: {
    task_id?: string;
    taskId?: string;
    state?: string;
    resultJson?: string;
    failCode?: string;
    failMsg?: string;
    [k: string]: unknown;
  };
}

/** Достаёт taskId, принимая оба написания. */
export function callbackTaskId(body: CallbackBody | null | undefined): string | undefined {
  return body?.data?.task_id ?? body?.data?.taskId;
}
