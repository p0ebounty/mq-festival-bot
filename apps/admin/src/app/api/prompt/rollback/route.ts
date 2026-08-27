import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { promptVersions, auditLog } from '@mq/db/schema';
import { db, settingsService } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/auth';

const schema = z.object({ versionId: z.string().uuid() });

/** Откат к сохранённой версии. Текущая при этом тоже уходит в историю. */
export async function POST(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Не авторизован' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Некорректный запрос' }, { status: 400 });
  }

  const [version] = await db.select().from(promptVersions)
    .where(eq(promptVersions.id, parsed.data.versionId)).limit(1);
  if (!version) {
    return NextResponse.json({ ok: false, error: 'Версия не найдена' }, { status: 404 });
  }

  const current = await settingsService.get('agent.systemPrompt');
  if (current && current !== version.value) {
    await db.insert(promptVersions).values({
      value: current, note: 'перед откатом', adminUserId: admin.id,
    });
  }

  await settingsService.set('agent.systemPrompt', version.value, admin.id);
  await db.insert(auditLog).values({
    adminUserId: admin.id,
    action: 'prompt.rollback',
    target: version.id,
    details: { restoredFrom: version.createdAt },
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true });
}
