import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createMigrationClient } from './index.js';

const appEnv = process.env.APP_ENV ?? 'dev';
loadEnv({ path: new URL(`../../../.env.${appEnv}`, import.meta.url).pathname });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = createMigrationClient(url);
try {
  console.log(`[migrate] stand=${appEnv}`);
  await migrate(drizzle(sql), {
    migrationsFolder: new URL('../migrations', import.meta.url).pathname,
  });
  console.log('[migrate] done');
} catch (err) {
  console.error('[migrate] failed:', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
