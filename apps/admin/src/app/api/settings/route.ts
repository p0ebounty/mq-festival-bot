import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditLog } from '@mq/db/schema';
import { settingKeys, validatorFor, isSecretKey, type SettingKey } from '@mq/config';
import { db, settingsService } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/auth';

export async function GET() {
  if (!(await getCurrentAdmin())) {
    return NextResponse.json({ ok: false, error: 'Не авторизован' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, settings: await settingsService.getAllForAdmin() });
}

const patchSchema = z.object({
  key: z.enum(settingKeys as [SettingKey, ...SettingKey[]]),
  value: z.string(),
});

export async function PATCH(req: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Не авторизован' }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Некорректный запрос' }, { status: 400 });
  }
  const { key, value } = parsed.data;

  // Значение проверяется тем же валидатором, что и при сидинге.
  const valueCheck = validatorFor(key).safeParse(value);
  if (!valueCheck.success) {
    return NextResponse.json(
      { ok: false, error: valueCheck.error.issues[0]?.message ?? 'Недопустимое значение' },
      { status: 422 },
    );
  }

  await settingsService.set(key, value, admin.id);

  // В журнал пишем факт изменения, но НИКОГДА не само значение секрета.
  await db.insert(auditLog).values({
    adminUserId: admin.id,
    action: 'settings.update',
    target: key,
    details: isSecretKey(key) ? { changed: true } : { value },
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return NextResponse.json({ ok: true });
}
