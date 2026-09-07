/**
 * Переключить режим бота с сервера, без админки.
 *
 *   APP_ENV=prod pnpm tsx scripts/bot-mode.mts asleep   # фестиваль закончился
 *   APP_ENV=prod pnpm tsx scripts/bot-mode.mts awake    # разбудить
 *   APP_ENV=prod pnpm tsx scripts/bot-mode.mts          # показать текущий
 *
 * То же самое делает тумблер «Режим бота» в админке (Настройки → Провайдер).
 * Бот подхватывает за 10 с (TTL кэша настроек), рестарт не нужен.
 */
import { config } from 'dotenv';
config({ path: `.env.${process.env.APP_ENV ?? 'dev'}` });
process.env.APP_ENV ??= 'dev';

const { createDb } = await import('@mq/db');
const { SettingsService, validatorFor } = await import('@mq/config');
const db = createDb(process.env.DATABASE_URL!, { max: 1 });
const settings = new SettingsService(db, process.env.SECRETS_ENC_KEY!, process.env);

const want = process.argv[2];
if (want !== undefined) {
  const ok = validatorFor('bot.mode').safeParse(want);
  if (!ok.success) {
    console.error(`недопустимый режим «${want}»: нужен awake или asleep`);
    process.exit(2);
  }
  await settings.set('bot.mode', want);
}
console.log(`${process.env.APP_ENV}: bot.mode = ${await settings.get('bot.mode')}`);
process.exit(0);
