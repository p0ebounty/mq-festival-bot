import 'server-only';
import { env } from './env';

export type CreditResult =
  | { ok: true; credits: number }
  | { ok: false; error: string; status?: number };

/**
 * Проверка ключа kie.ai через самый дешёвый эндпоинт — остаток кредитов.
 * Используется кнопкой «Проверить ключ» в настройках: подтверждает, что ключ
 * рабочий, ДО того как его увидят пользователи.
 */
export async function checkKieKey(apiKey: string): Promise<CreditResult> {
  if (!apiKey.trim()) return { ok: false, error: 'Ключ пустой' };

  let res: Response;
  try {
    res = await fetch(`${env.KIE_API_BASE}/api/v1/chat/credit`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'таймаут' : 'сеть недоступна';
    return { ok: false, error: `Не удалось связаться с kie.ai (${reason})` };
  }

  if (res.status === 401) return { ok: false, error: 'Ключ отклонён: нет доступа (401)', status: 401 };
  if (res.status === 429) return { ok: false, error: 'Лимит запросов к kie.ai (429)', status: 429 };
  if (!res.ok) return { ok: false, error: `kie.ai ответил ${res.status}`, status: res.status };

  const body = (await res.json().catch(() => null)) as
    | { code?: number; msg?: string; data?: number | { credit?: number } }
    | null;

  if (!body || body.code !== 200) {
    // kie.ai нередко отвечает HTTP 200 с кодом ошибки внутри тела.
    const detail = body?.msg ?? 'неожиданный ответ';
    return { ok: false, error: `kie.ai отклонил ключ: ${detail}` };
  }

  // Формат data менялся между версиями — принимаем и число, и объект.
  const credits = typeof body.data === 'number' ? body.data : (body.data?.credit ?? 0);
  return { ok: true, credits };
}
