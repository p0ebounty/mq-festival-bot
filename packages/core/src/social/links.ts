import { createHash } from 'node:crypto';

export interface LinkCheck {
  ok: boolean;
  /** Нормализованный адрес — он же ключ дедупликации. */
  url?: string;
  /** Площадка: t.me, vk, ok, x… либо просто домен, если сеть незнакомая. */
  platform?: string;
  /**
   * Это **известная** соцсеть, а ссылка похожа на публикацию.
   *
   * Различие не косметическое: сильное доказательство (совпал хеш картинки)
   * начисляет бонус без ограничений, и на произвольном сайте это был бы
   * печатный станок — выложил свою же картинку у себя на страничке и
   * получил больше токенов, чем потратил. С незнакомого домена бонус тоже
   * даётся, но идёт в счёт лимита слабых подтверждений.
   */
  known?: boolean;
  /** Открывается ли площадка без логина (влияет на путь каскада). */
  openable?: boolean;
  /** Причина отказа, понятная человеку. */
  reason?: string;
}

/**
 * Известные площадки.
 *
 * ⚠️ Это НЕ список разрешённых: ссылку принимаем с любого сайта, проверка
 * дальше одинаковая для всех. Список решает единственное — можно ли выдать
 * **сильное** доказательство (совпал перцептивный хеш) без ограничений.
 * На произвольном домене такое доказательство подделывается за минуту:
 * положил свою же картинку на свою страничку — и получил больше токенов,
 * чем потратил.
 *
 * `openable` — проверено живьём (ADR 0007): открывается ли публикация
 * анонимно. Instagram и Facebook помечены закрытыми: выложить туда участник
 * может, а проверить мы сможем только слабым путём.
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
  {
    platform: 'dzen',
    hosts: ['dzen.ru', 'zen.yandex.ru'],
    openable: true,
    isPost: (u) => /^\/(a|video\/watch|shorts)\//.test(u.pathname) || /^\/[^/]+\/[^/]+/.test(u.pathname),
  },
  {
    platform: 'youtube',
    hosts: ['youtube.com', 'm.youtube.com', 'youtu.be'],
    openable: true,
    isPost: (u) => u.hostname.endsWith('youtu.be')
      ? u.pathname.length > 1
      : /^\/(shorts|watch|post)/.test(u.pathname) || u.searchParams.has('v'),
  },
  {
    platform: 'rutube',
    hosts: ['rutube.ru'],
    openable: true,
    isPost: (u) => /^\/(video|shorts)\/[\w-]+/.test(u.pathname),
  },
  {
    platform: 'tiktok',
    hosts: ['tiktok.com', 'vm.tiktok.com'],
    openable: true,
    isPost: (u) => /\/video\/\d+/.test(u.pathname) || u.hostname.startsWith('vm.'),
  },
  {
    platform: 'threads',
    hosts: ['threads.net', 'threads.com'],
    openable: true,
    isPost: (u) => /^\/@[^/]+\/post\//.test(u.pathname),
  },
  {
    platform: 'pinterest',
    hosts: ['pinterest.com', 'ru.pinterest.com', 'pin.it'],
    openable: true,
    isPost: (u) => /^\/pin\//.test(u.pathname) || u.hostname === 'pin.it',
  },
  {
    platform: 'facebook',
    hosts: ['facebook.com', 'm.facebook.com', 'fb.com'],
    // Стена логина почти всегда; оставляем ради слабого пути.
    openable: false,
    isPost: (u) => /\/(posts|photo|permalink|share)/.test(u.pathname) || u.searchParams.has('story_fbid'),
  },
];

/**
 * Адреса, по которым ходить нельзя ни при каких условиях.
 *
 * Первые два пункта — про деньги: страница результата `/g/<id>` показывает
 * нашу же картинку кому угодно, а ссылка kie.ai ведёт прямо на файл. Прими
 * мы их за публикацию — и бонус выдаётся сам себе.
 *
 * Остальное — про безопасность. Ссылку открывает headless-браузер НА НАШЕМ
 * сервере: пока список площадок был закрытым, это никого не волновало, а с
 * открытым «проверю что угодно» адрес вида `http://127.0.0.1:4002` или
 * `http://169.254.169.254` превращает проверку публикации в чтение нашей
 * же внутренней сети. Отсекаем до всякой сети (см. также resolveIsPublic).
 */
const OUR_HOSTS = [
  'bot.example.com', 'bot-dev.example.com',
  'kie.ai', 'api.kie.ai', 'tempfile.redpandaai.co', 'file.redpandaai.co',
];

/** Голый IP в ссылке на пост не встречается никогда — а в атаке встречается. */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Параметры, которые площадки цепляют к ссылке и которые ничего не значат. */
const JUNK_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'igshid', 'si', 'from', '_openstat', 'ref', 'ref_src', 'ref_url',
];

/**
 * Шаг 1 каскада: разбор ссылки без единого сетевого запроса.
 *
 * Принимаем ссылку **с любого сайта** — проверка дальше одинаковая для
 * всех, и отказывать человеку за то, что его соцсети нет в нашем списке,
 * значит наказывать его за нашу неполноту. По ADR 0007 ложное «нет» стоит
 * дороже ложного «да».
 *
 * Здесь остаются только те отказы, которые не может исправить никакая
 * дальнейшая проверка: это вообще не ссылка, это наша же страница, это
 * адрес внутри нашего сервера.
 *
 * Известность площадки не отказ, а **право на сильное доказательство**:
 * см. `known` в LinkCheck.
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

  if (OUR_HOSTS.includes(host)) {
    return {
      ok: false,
      reason: 'это ссылка на мою же страницу, а нужна публикация в соцсети — там, где её увидят люди',
    };
  }

  // Голый IP, «localhost», однословный хост: у настоящего поста такого не
  // бывает, а у попытки заглянуть внутрь нашего сервера — бывает.
  if (IPV4.test(host) || host === 'localhost' || !host.includes('.')
      || host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('[')) {
    return { ok: false, reason: 'по этому адресу публикации быть не может' };
  }

  const found = PLATFORMS.find((p) => p.hosts.includes(host));
  if (found) {
    return {
      ok: true,
      url: normalizeUrl(u),
      platform: found.platform,
      // Профиль вместо поста больше не отказ: картинка может лежать и на
      // профиле, а решает всё равно сверка хеша. Но «сильным» такое
      // доказательство не считаем.
      known: found.isPost(u),
      openable: found.openable,
    };
  }

  // Незнакомый сайт. Открываем и смотрим — вдруг там и правда пост.
  return { ok: true, url: normalizeUrl(u), platform: host, known: false, openable: true };
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
