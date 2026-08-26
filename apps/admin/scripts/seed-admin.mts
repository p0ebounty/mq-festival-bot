/**
 * Первичный сидинг стенда: аккаунт администратора + значения настроек
 * по умолчанию. Идемпотентен — повторный запуск ничего не ломает.
 *
 *   APP_ENV=dev tsx scripts/seed-admin.ts [--login admin] [--password <pass>]
 *
 * Пароль не передан → генерируется и печатается ОДИН раз.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import argon2 from 'argon2';

const appEnv = process.env.APP_ENV ?? 'dev';
loadEnv({ path: path.resolve(process.cwd(), '../../', `.env.${appEnv}`) });

const { createDb } = await import('@mq/db');
const { adminUsers, settings } = await import('@mq/db/schema');
const { SETTINGS_SCHEMA, isSecretKey } = await import('@mq/config');

const args = process.argv.slice(2);
const argOf = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const login = argOf('login') ?? 'admin';
const generated = !argOf('password');
// base64url без спецсимволов — чтобы пароль не ломался при копировании.
const password = argOf('password') ?? randomBytes(15).toString('base64url');

const db = createDb(process.env.DATABASE_URL!, { max: 1 });

// ── админ ──
const [existing] = await db.select().from(adminUsers).where(eq(adminUsers.login, login)).limit(1);
if (existing) {
  console.log(`[seed] администратор '${login}' уже существует — пропускаем`);
} else {
  await db.insert(adminUsers).values({
    login,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    displayName: 'Администратор',
  });
  console.log(`[seed] создан администратор '${login}'`);
  if (generated) {
    console.log('');
    console.log('  ╭────────────────────────────────────────────╮');
    console.log(`  │  логин:  ${login.padEnd(32)}│`);
    console.log(`  │  пароль: ${password.padEnd(32)}│`);
    console.log('  ╰────────────────────────────────────────────╯');
    console.log('  Пароль показан один раз — сохраните его.');
    console.log('');
  }
}

// ── настройки по умолчанию ──
let created = 0;
for (const [key, def] of Object.entries(SETTINGS_SCHEMA)) {
  const value = String((def as { default: unknown }).default ?? '');
  // Секреты не сидируем: ключ kie.ai вводится администратором в админке.
  if (isSecretKey(key) || !value) continue;
  const res = await db
    .insert(settings)
    .values({ key, value, isSecret: false })
    .onConflictDoNothing({ target: settings.key });
  if (res.count) created += 1;
}
console.log(`[seed] настроек добавлено: ${created} (существующие не тронуты)`);
process.exit(0);
