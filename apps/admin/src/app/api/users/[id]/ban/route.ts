import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { users, auditLog } from '@mq/db/schema';
import { db } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/auth';

const schema = z.object({ banned: z.boolean(), reason: z.string().max(300).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Не авторизован' }, { status: 401 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Некорректный запрос' }, { status: 400 });
  }
  const { banned, reason } = parsed.data;

  const rows = await db.update(users)
    .set({ isBanned: banned, bannedReason: banned ? (reason ?? null) : null })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'Участник не найден' }, { status: 404 });
  }

  await db.insert(auditLog).values({
    adminUserId: admin.id,
    action: banned ? 'user.ban' : 'user.unban',
    target: id,
    details: reason ? { reason } : {},
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true });
}
