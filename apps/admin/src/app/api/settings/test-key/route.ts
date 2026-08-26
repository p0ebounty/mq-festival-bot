import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentAdmin } from '@/lib/auth';
import { settingsService } from '@/lib/db';
import { checkKieKey } from '@/lib/kie';

const bodySchema = z.object({ key: z.string().optional() });

export async function POST(req: Request) {
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ ok: false, error: 'Не авторизован' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  // Пустое поле = проверяем уже сохранённый ключ.
  const key = parsed.success && parsed.data.key ? parsed.data.key : await settingsService.get('kie.apiKey');

  const result = await checkKieKey(key);
  return NextResponse.json(
    result.ok
      ? { ok: true, credits: result.credits }
      : { ok: false, error: result.error },
    { status: result.ok ? 200 : 200 },  // ошибку ключа показываем в UI, а не как HTTP-сбой
  );
}
