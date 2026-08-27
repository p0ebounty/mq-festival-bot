import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { users, tokenLedger, auditLog } from '@mq/db/schema';
import { db } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/auth';

const schema = z.object({ delta: z.number().int().refine((n) => n !== 0, 'Ноль ничего не меняет') });

/**
 * Правка баланса руками.
 *
 * Баланс и журнал двигаются ОДНОЙ транзакцией: иначе при сбое между ними
 * сверка «сумма журнала == баланс» разъедется, и объяснить участнику
 * его баланс станет нечем.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Не авторизован' }, { status: 401 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректный запрос' },
      { status: 400 },
    );
  }
  const { delta } = parsed.data;

  const balance = await db.transaction(async (tx) => {
    const rows = await tx.update(users)
      // Балансу нельзя уйти в минус даже по воле администратора.
      .set({ tokenBalance: sql`greatest(0, ${users.tokenBalance} + ${delta})` })
      .where(eq(users.id, id))
      .returning({ balance: users.tokenBalance });
    const b = rows[0]?.balance;
    if (b === undefined) return null;

    await tx.insert(tokenLedger).values({
      userId: id, delta, balanceAfter: b, reason: 'admin',
    });
    return b;
  });

  if (balance === null) {
    return NextResponse.json({ ok: false, error: 'Участник не найден' }, { status: 404 });
  }

  await db.insert(auditLog).values({
    adminUserId: admin.id,
    action: delta > 0 ? 'user.grant_tokens' : 'user.deduct_tokens',
    target: id,
    details: { delta, balanceAfter: balance },
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true, balance });
}
