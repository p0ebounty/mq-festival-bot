import { NextResponse } from 'next/server';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { promptVersions, auditLog, adminUsers } from '@mq/db/schema';
import { DEFAULT_SYSTEM_PROMPT } from '@mq/core';
import { db, settingsService } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/auth';

/** Текущий промпт и история версий. */
export async function GET() {
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ ok: false, error: 'Не авторизован' }, { status: 401 });
  }
  const current = await settingsService.get('agent.systemPrompt');
  const versions = await db.select({
    id: promptVersions.id,
    note: promptVersions.note,
    createdAt: promptVersions.createdAt,
    length: promptVersions.value,
    adminLogin: adminUsers.login,
  })
    .from(promptVersions)
    .leftJoin(adminUsers, eq(adminUsers.id, promptVersions.adminUserId))
    .orderBy(desc(promptVersions.createdAt))
    .limit(30);

  return NextResponse.json({
    ok: true,
    // Пусто в настройке = работает промпт по умолчанию из кода.
    current: current || DEFAULT_SYSTEM_PROMPT,
    isDefault: !current,
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
    versions: versions.map((v) => ({
      id: v.id, note: v.note, createdAt: v.createdAt,
      adminLogin: v.adminLogin, length: v.length.length,
    })),
  });
}

const schema = z.object({
  value: z.string().max(40_000),
  note: z.string().max(200).optional(),
});

/**
 * Сохранение промпта.
 *
 * Перед записью нового СТАРЫЙ уходит в историю. Иначе откатываться было бы
 * некуда: неудачная правка промпта ломает не одну страницу, а все ответы
 * бота сразу, и заметно это не всегда мгновенно.
 */
export async function POST(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Не авторизован' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Некорректный запрос' }, { status: 400 });
  }
  const { value, note } = parsed.data;

  const previous = await settingsService.get('agent.systemPrompt');
  if (previous && previous !== value) {
    await db.insert(promptVersions).values({
      value: previous, note: note ?? null, adminUserId: admin.id,
    });
  }

  await settingsService.set('agent.systemPrompt', value, admin.id);
  await db.insert(auditLog).values({
    adminUserId: admin.id,
    action: 'settings.update',
    target: 'agent.systemPrompt',
    details: { length: value.length },
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true });
}
