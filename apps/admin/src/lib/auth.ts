import 'server-only';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { eq, and, gt, lt } from 'drizzle-orm';
import argon2 from 'argon2';
import { adminSessions, adminUsers } from '@mq/db/schema';
import { sha256Hex } from '@mq/config';
import { db } from './db';

export const SESSION_COOKIE = 'mq_admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AdminIdentity = { id: string; login: string; displayName: string | null };

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/**
 * Создаёт сессию. В БД кладётся только SHA-256 от токена — утечка дампа
 * не даёт войти. Сам токен уходит в httpOnly-cookie.
 */
export async function createSession(
  adminUserId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(adminSessions).values({
    adminUserId,
    tokenHash: sha256Hex(token),
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  // Подчистить протухшие, чтобы таблица не росла бесконечно.
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function getCurrentAdmin(): Promise<AdminIdentity | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      id: adminUsers.id,
      login: adminUsers.login,
      displayName: adminUsers.displayName,
      isActive: adminUsers.isActive,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(and(eq(adminSessions.tokenHash, sha256Hex(token)), gt(adminSessions.expiresAt, new Date())))
    .limit(1);

  if (!row || !row.isActive) return null;
  return { id: row.id, login: row.login, displayName: row.displayName };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(adminSessions).where(eq(adminSessions.tokenHash, sha256Hex(token)));
  }
  store.delete(SESSION_COOKIE);
}
