import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'enc.v1:';

export class CryptoKeyError extends Error {}

function keyFromHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new CryptoKeyError('SECRETS_ENC_KEY must be exactly 64 hex chars (openssl rand -hex 32)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Шифрует значение настройки. Формат: enc.v1:<base64(iv|tag|ciphertext)>.
 * Префикс с версией — чтобы позже сменить алгоритм без миграции данных.
 */
export function encryptSecret(plain: string, keyHex: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, keyFromHex(keyHex), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(stored: string, keyHex: string): string {
  if (!stored.startsWith(PREFIX)) {
    throw new CryptoKeyError('value is not an encrypted secret');
  }
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, keyFromHex(keyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Маска для показа в UI. Полный секрет наружу не отдаётся никогда.
 * Короткие значения маскируются целиком, чтобы не слить сам секрет.
 */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return '•'.repeat(Math.max(plain.length, 4));
  return `${plain.slice(0, 3)}${'•'.repeat(6)}${plain.slice(-4)}`;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Сравнение токенов сессии без утечки времени. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
