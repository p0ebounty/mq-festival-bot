import { eq } from 'drizzle-orm';
import type { Db } from '@mq/db';
import { settings } from '@mq/db/schema';
import { decryptSecret, encryptSecret, isEncrypted } from './crypto';
import { SETTINGS_SCHEMA, isSecretKey, settingKeys, type SettingKey } from './defaults';

/**
 * Резолвер настроек. Приоритет: БД → .env → значение по умолчанию.
 * Кэш в памяти с коротким TTL, чтобы смена ключа в админке подхватывалась
 * без рестарта, но не била в БД на каждое сообщение.
 */
export class SettingsService {
  private cache = new Map<string, { value: string; at: number }>();
  private readonly ttlMs: number;

  constructor(
    private readonly db: Db,
    private readonly encKey: string,
    private readonly envFallback: Record<string, string | undefined> = {},
    opts: { ttlMs?: number } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 10_000;
  }

  /** Сбросить кэш — вызывается сразу после записи из админки. */
  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }

  async get(key: SettingKey): Promise<string> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;

    const [row] = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);

    let value: string;
    if (row?.value) {
      value = isEncrypted(row.value) ? decryptSecret(row.value, this.encKey) : row.value;
    } else {
      value = this.fallback(key);
    }

    this.cache.set(key, { value, at: Date.now() });
    return value;
  }

  async getInt(key: SettingKey): Promise<number> {
    const n = Number(await this.get(key));
    if (!Number.isFinite(n)) throw new Error(`setting ${key} is not a number`);
    return n;
  }

  async set(key: SettingKey, value: string, updatedBy?: string): Promise<void> {
    const secret = isSecretKey(key);
    const stored = secret && value ? encryptSecret(value, this.encKey) : value;
    await this.db
      .insert(settings)
      .values({ key, value: stored, isSecret: secret, ...(updatedBy ? { updatedBy } : {}) })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: stored, isSecret: secret, updatedAt: new Date(), ...(updatedBy ? { updatedBy } : {}) },
      });
    this.invalidate(key);
  }

  /** Все настройки разом; секреты НЕ расшифровываются — только флаг наличия. */
  async getAllForAdmin(): Promise<
    Array<{ key: string; value: string | null; isSecret: boolean; hasValue: boolean }>
  > {
    const rows = await this.db.select().from(settings);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return settingKeys.map((key) => {
      const row = byKey.get(key);
      const secret = isSecretKey(key);
      const raw = row?.value ?? '';
      const effective = raw || this.fallback(key);
      return {
        key,
        value: secret ? null : effective,
        isSecret: secret,
        hasValue: secret ? Boolean(effective) : true,
      };
    });
  }

  private fallback(key: SettingKey): string {
    // .env как bootstrap: позволяет поднять стенд до первого входа в админку.
    const envMap: Partial<Record<SettingKey, string>> = { 'kie.apiKey': 'KIE_API_KEY' };
    const envName = envMap[key];
    if (envName && this.envFallback[envName]) return this.envFallback[envName];
    return String(SETTINGS_SCHEMA[key].default ?? '');
  }
}
