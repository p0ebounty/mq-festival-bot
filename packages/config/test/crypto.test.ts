import { describe, it, expect } from 'vitest';
import {
  encryptSecret, decryptSecret, isEncrypted, maskSecret, CryptoKeyError, safeEqualHex, sha256Hex,
} from '../src/crypto.js';

const KEY = 'a'.repeat(64);
const KEY2 = 'b'.repeat(64);

describe('шифрование настроек', () => {
  it('round-trip возвращает исходное значение', () => {
    const secret = 'sk-live-1234567890abcdef';
    expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toBe(secret);
  });

  it('шифротекст не содержит открытого значения', () => {
    const enc = encryptSecret('sk-super-secret', KEY);
    expect(enc).not.toContain('sk-super-secret');
    expect(isEncrypted(enc)).toBe(true);
  });

  it('каждый вызов даёт разный шифротекст (случайный IV)', () => {
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY));
  });

  it('чужой ключ не расшифровывает', () => {
    expect(() => decryptSecret(encryptSecret('x', KEY), KEY2)).toThrow();
  });

  it('подделка шифротекста ловится GCM-тегом', () => {
    const enc = encryptSecret('important', KEY);
    const raw = Buffer.from(enc.slice('enc.v1:'.length), 'base64');
    raw[raw.length - 1] ^= 0xff; // портим последний байт
    expect(() => decryptSecret('enc.v1:' + raw.toString('base64'), KEY)).toThrow();
  });

  it('ключ неверной длины отвергается', () => {
    expect(() => encryptSecret('x', 'short')).toThrow(CryptoKeyError);
    expect(() => encryptSecret('x', 'z'.repeat(64))).toThrow(CryptoKeyError); // не hex
  });

  it('unicode переживает round-trip', () => {
    const s = 'ключ-Ω-🎨';
    expect(decryptSecret(encryptSecret(s, KEY), KEY)).toBe(s);
  });
});

describe('маскирование', () => {
  it('показывает только края длинного секрета', () => {
    expect(maskSecret('sk-1234567890abcdef')).toBe('sk-••••••cdef');
  });
  it('короткое значение маскирует целиком', () => {
    expect(maskSecret('abc')).not.toContain('abc');
  });
});

describe('вспомогательное', () => {
  it('safeEqualHex сравнивает корректно', () => {
    const h = sha256Hex('token');
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, sha256Hex('other'))).toBe(false);
    expect(safeEqualHex(h, 'ab')).toBe(false);
  });
});
