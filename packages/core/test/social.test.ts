import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  checkLink, normalizeUrl, urlKey, hasAnyHashtag,
  perceptualHash, hammingDistance, looksSame, PHASH_MATCH_THRESHOLD,
} from '../src/social/index';

describe('разбор ссылки на публикацию', () => {
  it('принимает пост в Telegram', () => {
    const r = checkLink('https://t.me/examplechannel/42');
    expect(r.ok).toBe(true);
    expect(r.platform).toBe('t.me');
    expect(r.openable).toBe(true);
  });

  it('принимает пост стены VK в обоих видах', () => {
    expect(checkLink('https://vk.com/wall-12345_678').ok).toBe(true);
    expect(checkLink('https://vk.com/id1?w=wall-12345_678').ok).toBe(true);
  });

  it('отвергает ссылку на профиль, а не на публикацию', () => {
    // Частая подмена: человек кидает свою страницу вместо конкретного поста.
    const r = checkLink('https://t.me/examplechannel');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/публикаци/i);
  });

  it('отвергает чужие площадки и мусор', () => {
    expect(checkLink('https://example.com/post/1').ok).toBe(false);
    expect(checkLink('просто текст').ok).toBe(false);
    expect(checkLink('javascript:alert(1)').ok).toBe(false);
  });

  it('Instagram принимается, но помечен как закрытый', () => {
    // Пост туда выложить можно, а проверить строго — нет: стена логина.
    const r = checkLink('https://instagram.com/p/Cabc123/');
    expect(r.ok).toBe(true);
    expect(r.openable).toBe(false);
  });
});

describe('нормализация ссылки', () => {
  it('схлопывает варианты одного и того же поста', () => {
    // Без этого один пост принесёт бонус трижды.
    const variants = [
      'https://t.me/examplechannel/42',
      'http://www.t.me/examplechannel/42/',
      'https://t.me/examplechannel/42?utm_source=tg#preview',
    ];
    const keys = new Set(variants.map((v) => urlKey(normalizeUrl(v))));
    expect(keys.size).toBe(1);
  });

  it('разные посты остаются разными', () => {
    expect(urlKey(normalizeUrl('https://t.me/examplechannel/42')))
      .not.toBe(urlKey(normalizeUrl('https://t.me/examplechannel/43')));
  });

  it('порядок параметров не меняет ключ', () => {
    expect(normalizeUrl('https://vk.com/wall-1_2?b=2&a=1'))
      .toBe(normalizeUrl('https://vk.com/wall-1_2?a=1&b=2'));
  });
});

describe('хештеги на странице', () => {
  const tags = '#ЦентрЛидер #MagnaQore #профессиибудущего';

  it('достаточно одного совпадения', () => {
    expect(hasAnyHashtag('Смотрите что вышло! #MagnaQore', tags)).toBe(true);
  });

  it('регистр не важен', () => {
    expect(hasAnyHashtag('#magnaqore', tags)).toBe(true);
  });

  it('без единого хештега — нет', () => {
    expect(hasAnyHashtag('просто пост без тегов', tags)).toBe(false);
  });

  it('если хештеги не заданы, не придираемся', () => {
    expect(hasAnyHashtag('что угодно', '')).toBe(true);
  });
});

/**
 * pHash — единственное СИЛЬНОЕ доказательство в каскаде. Если он не
 * переживает пережатие соцсетью, весь строгий путь превращается в
 * формальность, и бонусы начинают выдаваться на слово.
 */
describe('перцептивный хеш', () => {
  /** Разноцветный градиент с фигурами — что-то, у чего есть структура. */
  async function picture(seed: number, size = 600): Promise<Buffer> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="100%" height="100%" fill="hsl(${seed * 37 % 360},70%,55%)"/>
      <circle cx="${size * 0.35}" cy="${size * 0.4}" r="${size * 0.2}" fill="hsl(${(seed * 91) % 360},80%,30%)"/>
      <rect x="${size * 0.55}" y="${size * 0.55}" width="${size * 0.3}" height="${size * 0.3}"
            fill="hsl(${(seed * 53) % 360},60%,80%)"/>
    </svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
  }

  it('хеш стабилен и имеет нужную длину', async () => {
    const img = await picture(1);
    const a = await perceptualHash(img);
    expect(a).toHaveLength(16);          // 64 бита в hex
    expect(a).toBe(await perceptualHash(img));
  });

  it('ПЕРЕЖИВАЕТ пережатие и уменьшение — как в соцсети', async () => {
    const original = await picture(7, 900);
    const reposted = await sharp(original)
      .resize(480)
      .jpeg({ quality: 45 })            // соцсети жмут примерно так
      .toBuffer();

    const a = await perceptualHash(original);
    const b = await perceptualHash(reposted);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(PHASH_MATCH_THRESHOLD);
    expect(looksSame(a, b)).toBe(true);
  });

  it('переживает смену формата на png', async () => {
    const original = await picture(3, 700);
    const png = await sharp(original).png().toBuffer();
    expect(looksSame(await perceptualHash(original), await perceptualHash(png))).toBe(true);
  });

  it('РАЗЛИЧАЕТ чужую картинку', async () => {
    // Иначе бонус получит любой, кто выложил вообще что-нибудь.
    const a = await perceptualHash(await picture(1));
    const b = await perceptualHash(await picture(2));
    expect(looksSame(a, b)).toBe(false);
  });

  it('расстояние между несравнимыми хешами — null, а не ноль', () => {
    // Ноль означал бы «совпало», и мусор проходил бы как доказательство.
    expect(hammingDistance('abc', 'abcd')).toBeNull();
    expect(hammingDistance('zzzz', 'zzzz')).toBeNull();
    expect(hammingDistance('', '')).toBeNull();
    expect(looksSame('abc', 'abcd')).toBe(false);
  });
});
