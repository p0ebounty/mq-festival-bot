import { randomInt } from 'node:crypto';

/**
 * Алфавит короткой ссылки.
 *
 * Из него выброшены пары, которые человек путает, когда набирает адрес
 * руками с чужого экрана: 0/o, 1/l/i. Так же поступает Crockford Base32.
 * Только нижний регистр — на телефоне это на одно переключение меньше,
 * а адрес после QR всё равно чаще читают, чем печатают.
 */
export const SHORT_ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/** Длина по умолчанию: 31^8 ≈ 8.5·10¹¹, около 40 бит. */
export const SHORT_ID_LENGTH = 8;

/**
 * Короткий идентификатор публичной страницы результата.
 *
 * ⚠️ Он же — и ключ доступа. Страница `/g/<shortId>` открывается без
 * авторизации (иначе QR бессмыслен), поэтому подобрать чужую ссылку
 * перебором быть не должно. Отсюда и длина, и `randomInt` из crypto,
 * а не `Math.random`.
 */
export function makeShortId(length = SHORT_ID_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SHORT_ID_ALPHABET[randomInt(SHORT_ID_ALPHABET.length)];
  }
  return out;
}

/** Проверка перед походом в БД — чтобы мусор не доходил до запроса. */
export function isShortId(value: string): boolean {
  if (value.length < 4 || value.length > 16) return false;
  for (const ch of value) if (!SHORT_ID_ALPHABET.includes(ch)) return false;
  return true;
}

/** Полный публичный адрес страницы результата. */
export function shareUrl(publicUrl: string, shortId: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/g/${shortId}`;
}
