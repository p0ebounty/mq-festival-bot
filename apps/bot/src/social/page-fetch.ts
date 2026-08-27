import { chromium, type Browser } from 'playwright-core';
import { env } from '../env.js';

export interface FetchedPage {
  /** Отрисовалась ли страница без стены логина. */
  public: boolean;
  /** Весь видимый текст — в нём ищем хештеги. */
  text: string;
  /** og:image и картинки со страницы, абсолютными адресами. */
  imageUrls: string[];
  /** Скриншот для vision-модели, если понадобится слабый путь. */
  screenshot?: Buffer;
  /** Что помешало, если не вышло. */
  error?: string;
}

/**
 * Признаки того, что нам показали не пост, а предложение войти.
 * Проверяются по видимому тексту — разметка у площадок меняется чаще.
 */
const LOGIN_WALL = [
  'log in', 'login', 'sign up', 'войти', 'вход', 'регистрация',
  'зарегистрироваться', 'continue as guest',
];

/**
 * Скрипты ниже исполняются В БРАУЗЕРЕ, а не в Node, поэтому они строки:
 * иначе tsc требует библиотеку DOM во всём приложении, и `document`
 * становится доступен там, где его быть не должно.
 */
const PAGE_TEXT = `document.body ? document.body.innerText : ''`;

const PAGE_IMAGES = `(() => {
  const out = [];
  for (const p of ['og:image', 'og:image:secure_url', 'twitter:image']) {
    const el = document.querySelector('meta[property="' + p + '"], meta[name="' + p + '"]');
    const c = el && el.getAttribute('content');
    if (c) out.push(c);
  }
  for (const img of Array.from(document.images).slice(0, 40)) {
    if (img.naturalWidth >= 200 && img.naturalHeight >= 200) out.push(img.src);
  }
  return out;
})()`;

/**
 * Один браузер на процесс, а не по инстансу на запрос.
 *
 * Запуск Chromium — это ~300 МБ и полсекунды. На фестивале проверки идут
 * единично, но подряд, и поднимать браузер каждый раз означало бы держать
 * участника в ожидании на ровном месте (ADR 0007).
 */
let shared: Browser | null = null;

async function browser(): Promise<Browser> {
  if (shared?.isConnected()) return shared;
  shared = await chromium.launch({
    executablePath: env.CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  return shared;
}

/** Закрыть браузер при остановке процесса. */
export async function closeBrowser(): Promise<void> {
  await shared?.close().catch(() => {});
  shared = null;
}

/**
 * Шаг 2 каскада: открыть публикацию так, как её увидит случайный прохожий.
 *
 * ⚠️ Ключевой момент — **без cookies и без логина**. Сам факт, что страница
 * отрисовалась в чистом контексте, и есть доказательство публичности:
 * черновик или запись «для друзей» так не откроется.
 */
export async function fetchPublicPage(url: string, timeoutMs = 20_000): Promise<FetchedPage> {
  let ctx;
  try {
    const b = await browser();
    ctx = await b.newContext({
      // Мобильный UA: у соцсетей мобильная вёрстка проще и реже прячет пост
      // за модальным окном входа.
      userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
      viewport: { width: 420, height: 900 },
      locale: 'ru-RU',
      // Контекст свежий и пустой: ни cookies, ни localStorage. Это и есть
      // проверка — публичный пост откроется, «для друзей» нет.
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Дать площадке дорисовать пост, но не ждать вечно: у соцсетей всегда
    // что-то догружается, и networkidle там не наступает никогда.
    await page.waitForTimeout(1500);

    const text = (await page.evaluate<string>(PAGE_TEXT)).slice(0, 20_000);
    const imageUrls = await page.evaluate<string[]>(PAGE_IMAGES);

    const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => undefined);

    // Стена логина: короткий текст И слова про вход. Одного признака мало —
    // слово «войти» встречается и в шапке нормально открытого поста.
    const low = text.toLowerCase();
    const wall = text.length < 400 && LOGIN_WALL.some((w) => low.includes(w));

    return {
      public: !wall && text.length > 0,
      text,
      imageUrls: [...new Set(imageUrls)].filter((u) => /^https?:/.test(u)),
      ...(screenshot ? { screenshot } : {}),
      ...(wall ? { error: 'страница просит войти' } : {}),
    };
  } catch (err) {
    return { public: false, text: '', imageUrls: [], error: String(err).slice(0, 160) };
  } finally {
    await ctx?.close().catch(() => {});
  }
}

/**
 * Запасной путь: og-разметка глазами краулера ссылок.
 *
 * Площадки **намеренно** отдают `og:*` ботам превью, чтобы ссылка красиво
 * разворачивалась в мессенджерах. Это штатный путь, а не обход: когда
 * браузерный заход упёрся в стену, превью всё равно расскажет, что за пост.
 */
export async function fetchOpenGraph(url: string, timeoutMs = 10_000): Promise<FetchedPage> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'ru,en;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { public: false, text: '', imageUrls: [], error: `HTTP ${res.status}` };

    // ⚠️ НЕ res.text(): он всегда считает тело UTF-8. VK отдаёт стену в
    // windows-1251, и русский текст превращался в «���������» — а по нему
    // мы ищем хештеги. Кодировку берём из заголовка или из мета-тега.
    const bytes = Buffer.from(await res.arrayBuffer());
    const html = decodeHtml(bytes, res.headers.get('content-type')).slice(0, 400_000);
    const imageUrls: string[] = [];
    for (const p of ['og:image', 'og:image:secure_url', 'twitter:image']) {
      const m = new RegExp(
        `<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, 'i',
      ).exec(html);
      if (m?.[1]) imageUrls.push(decodeEntities(m[1]));
    }
    const desc = /<meta[^>]+(?:property|name)=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(html);
    const title = /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html);

    const text = [title?.[1], desc?.[1]]
      .filter((v): v is string => typeof v === 'string')
      .map(decodeEntities)
      .join('\n');
    return {
      public: imageUrls.length > 0,
      text,
      imageUrls: [...new Set(imageUrls)].filter((u) => /^https?:/.test(u)),
      ...(imageUrls.length ? {} : { error: 'og-разметки нет' }),
    };
  } catch (err) {
    return { public: false, text: '', imageUrls: [], error: String(err).slice(0, 160) };
  }
}

/** Скачивание картинки со страницы для сверки хеша. */
export async function downloadImage(url: string, maxBytes = 12 * 1024 * 1024): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  } catch {
    return null;
  }
}

/**
 * Разбор тела с учётом кодировки страницы.
 *
 * Порядок: заголовок Content-Type → мета-тег в первых килобайтах → utf-8.
 * Мета читаем по latin1: он всегда ASCII, а до объявления кодировки
 * декодировать «правильно» ещё нечем.
 */
function decodeHtml(bytes: Buffer, contentType: string | null): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  const head = bytes.subarray(0, 4096).toString('latin1');
  const fromMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]
    ?? /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];

  const label = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

/**
 * HTML-сущности в тексте og-разметки. Числовые встречаются постоянно:
 * эмодзи в постах VK приезжают как `&#129293;`, и без разбора они остаются
 * мусором в тексте, по которому мы ищем хештеги.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)));
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}
