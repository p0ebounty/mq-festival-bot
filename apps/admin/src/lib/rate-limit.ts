import 'server-only';

/**
 * Простой in-memory лимитер для формы входа: 5 попыток / 15 минут на IP.
 * Процесс один, поэтому память достаточна; при масштабировании — в Redis.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function checkLoginRate(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const rec = attempts.get(ip);

  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }
  rec.count += 1;
  if (rec.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function resetLoginRate(ip: string): void {
  attempts.delete(ip);
}
