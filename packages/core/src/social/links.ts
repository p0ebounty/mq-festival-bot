import { createHash } from 'node:crypto';

export interface LinkCheck {
  ok: boolean;
  /** Нормализованный адрес — он же ключ дедупликации. */
  url?: string;
  /** Площадка: t.me, vk, ok, instagram, x. */
  platform?: string;
  /** Открывается ли площадка без логина (влияет на путь каскада). */
  openable?: boolean;
  /** Причина отказа, понятная человеку. */
  reason?: string;
}

/**
 * Площадки, которые мы принимаем.
 *
 * `openable` — проверено живьём (ADR 0007): открывается ли публикация
 * анонимно, то есть можно ли добыть **сильное** доказательство. Instagram
 * в списке есть, но помечен как закрытый: пост туда участник выложить может,
 * а проверить мы сможем только слабым путём.
 */
const PLATFORMS: Array<{
  platform: string;
  hosts: string[];
  openable: boolean;
  /** Похоже ли на конкретную публикацию, а не на профиль или главную. */
  isPost: (u: URL) => boolean;
}> = [
  {
    platform: 't.me',
    hosts: ['t.me', 'telegram.me'],
    openable: true,
    // t.me/channel/123 — пост; t.me/channel — канал целиком.
    isPost: (u) => /^\/[^/]+\/\d+/.test(u.pathname) || u.pathname.startsWith('/s/'),
  },
  {
    platform: 'vk',
    hosts: ['vk.com', 'm.vk.com', 'vk.ru'],
    openable: true,
    // vk.com/wall-123_456 либо ?w=wall-123_456 — пост стены.
    isPost: (u) => /wall-?\d+_\d+/.test(u.pathname + u.search) || /\/(photo|video)-?\d+_\d+/.test(u.pathname),
  },
  {
    platform: 'ok',
    hosts: ['ok.ru', 'm.ok.ru', 'odnoklassniki.ru'],
    openable: true,
    isPost: (u) => /\/(topic|statuses|profile\/\d+\/statuses)\/\d+/.test(u.pathname),
  },
  {
    platform: 'x',
    hosts: ['x.com', 'twitter.com'],
    openable: true,
    isPost: (u) => /^\/[^/]+\/status\/\d+/.test(u.pathname),
  },
  {
    platform: 'instagram',
    hosts: ['instagram.com', 'www.instagram.com'],
    // Стена логина: og-разметка пустая даже краулеру (проверено 26.08).
    openable: false,
    isPost: (u) => /^\/(p|reel|tv)\/[^/]+/.test(u.pathname),
  },
];

/** Параметры, которые площадки цепляют к ссылке и которые ничего не значат. */
const JUNK_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'igshid', 'si', 'from', '_openstat', 'ref', 'ref_src', 'ref_url',
];

/**
 * Шаг 1 каскада: разбор ссылки без единого сетевого запроса.
 *
 * Смысл — отсеять заведомо бесполезное до того, как поднимать браузер:
 * чужие домены, ссылку на профиль вместо поста, мусор. Это самая дешёвая
 * и самая точная проверка в каскаде (ADR 0007).
 */
export function checkLink(raw: string): LinkCheck {
  const trimmed = raw.trim();
  let u: URL;
  try {
    u = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: 'это не похоже на ссылку' };
  }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, reason: 'ссылка должна быть обычной http(s)' };
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const found = PLATFORMS.find((p) => p.hosts.includes(host));
  if (!found) {
    return {
      ok: false,
      reason: `площадка ${host} не поддерживается — подойдут Telegram, VK, Одноклассники, X или Instagram`,
    };
  }

  if (!found.isPost(u)) {
    return {
      ok: false,
      platform: found.platform,
      reason: 'это ссылка на страницу или профиль, а нужна ссылка на саму публикацию',
    };
  }

  return { ok: true, url: normalizeUrl(u), platform: found.platform, openable: found.openable };
}

/**
 * Приведение ссылки к каноническому виду.
 *
 * Нужно ради дедупликации: один и тот же пост участник может прислать с
 * `www.`, с `?utm_source=…` и с якорем. Без нормализации это три разные
 * строки и три бонуса за одну публикацию.
 */
export function normalizeUrl(input: URL | string): string {
  const u = typeof input === 'string' ? new URL(input) : new URL(input.href);
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  u.hash = '';
  u.username = '';
  u.password = '';
  u.port = '';
  for (const p of JUNK_PARAMS) u.searchParams.delete(p);
  // Порядок параметров у ссылки не значит ничего, а строку меняет.
  u.searchParams.sort();
  // Хвостовой слэш — тоже косметика.
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

/** Ключ дедупликации: индексировать хеш дешевле, чем длинный URL. */
export function urlKey(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

/** Есть ли в тексте страницы хоть один из наших хештегов. */
export function hasAnyHashtag(text: string, hashtags: string): boolean {
  const tags = hashtags.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter((t) => t.startsWith('#'));
  if (tags.length === 0) return true;   // хештеги не заданы — не придираемся
  const haystack = text.toLowerCase();
  return tags.some((t) => haystack.includes(t));
}
