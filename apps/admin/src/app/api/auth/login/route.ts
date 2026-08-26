import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { adminUsers } from '@mq/db/schema';
import { db } from '@/lib/db';
import { createSession, verifyPassword } from '@/lib/auth';
import { checkLoginRate, resetLoginRate } from '@/lib/rate-limit';

const bodySchema = z.object({ login: z.string().min(1), password: z.string().min(1) });

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const rate = checkLoginRate(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: `Слишком много попыток. Повторите через ${Math.ceil(rate.retryAfterSec / 60)} мин.` },
      { status: 429 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Некорректный запрос' }, { status: 400 });
  }

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.login, parsed.data.login))
    .limit(1);

  // Одинаковый ответ на «нет пользователя» и «неверный пароль» —
  // чтобы нельзя было перебором узнать существующие логины.
  const okPassword = user ? await verifyPassword(user.passwordHash, parsed.data.password) : false;
  if (!user || !user.isActive || !okPassword) {
    return NextResponse.json({ ok: false, error: 'Неверный логин или пароль' }, { status: 401 });
  }

  resetLoginRate(ip);
  await createSession(user.id, { ip, userAgent: req.headers.get('user-agent') ?? undefined });
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));

  return NextResponse.json({ ok: true });
}
