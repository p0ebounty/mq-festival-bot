import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export * as schema from './schema';
export * from './schema';

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string, opts: { max?: number } = {}) {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return drizzle(sql, { schema });
}

/** Отдельное соединение для миграций: max=1, без пулинга. */
export function createMigrationClient(url: string) {
  return postgres(url, { max: 1 });
}

export * from './repos/generations';
