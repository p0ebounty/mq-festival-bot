import { z } from 'zod';

/**
 * Реестр настроек, живущих в БД и меняемых из админки без рестарта.
 * Значения по умолчанию — из docs/tz/analysis.md §4 (подтвердить у заказчика).
 */
export const SETTINGS_SCHEMA = {
  // ── провайдер ──
  'kie.apiKey':       { type: 'secret', default: '',                 label: 'API-ключ kie.ai' },
  'kie.chatModel':    { type: 'string', default: 'claude-opus-5',    label: 'Модель агента' },
  'kie.imageModel':   { type: 'string', default: 'nano-banana-2',    label: 'Модель генерации картинок' },
  'kie.imageResolution': { type: 'enum', default: '1K', options: ['1K', '2K', '4K'], label: 'Разрешение' },

  // ── экономика токенов ──
  'economy.startBalance':  { type: 'int', default: 10, min: 0, max: 1000, label: 'Стартовый баланс' },
  'economy.costPerImage':  { type: 'int', default: 1,  min: 0, max: 100,  label: 'Цена генерации' },
  'economy.socialBonus':   { type: 'int', default: 3,  min: 0, max: 100,  label: 'Бонус за репост' },

  // ── лимиты ──
  'limits.perHour':        { type: 'int', default: 20, min: 1, max: 500, label: 'Генераций в час' },
  'limits.concurrent':     { type: 'int', default: 1,  min: 1, max: 10,  label: 'Одновременных генераций' },

  // ── агент ──
  'agent.systemPrompt':    { type: 'text',   default: '', label: 'Системный промпт' },
  'agent.maxToolIterations': { type: 'int',  default: 8, min: 1, max: 20, label: 'Лимит итераций tool-use' },
  'agent.historyMessages': { type: 'int',    default: 20, min: 4, max: 100, label: 'Сообщений в контексте' },

  // ── хранение ──
  'media.retentionDays':   { type: 'int', default: 30, min: 1, max: 365, label: 'Хранить медиа, дней' },
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;

export const settingKeys = Object.keys(SETTINGS_SCHEMA) as SettingKey[];

export function isSecretKey(key: string): boolean {
  const def = SETTINGS_SCHEMA[key as SettingKey];
  return !!def && def.type === 'secret';
}

/** Валидатор значения настройки — используется и в API админки, и при сидинге. */
export function validatorFor(key: SettingKey): z.ZodTypeAny {
  const def = SETTINGS_SCHEMA[key] as Record<string, unknown>;
  switch (def.type) {
    case 'int': {
      let s = z.coerce.number().int();
      if (typeof def.min === 'number') s = s.min(def.min);
      if (typeof def.max === 'number') s = s.max(def.max);
      return s;
    }
    case 'enum':
      return z.enum(def.options as [string, ...string[]]);
    case 'secret':
    case 'string':
    case 'text':
    default:
      return z.string();
  }
}
