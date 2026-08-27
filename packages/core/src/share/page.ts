export interface SharePageInput {
  /** Адрес самой картинки (inline). */
  imageUrl: string;
  /** Адрес для скачивания — с Content-Disposition. */
  downloadUrl: string;
  /** QR этой же страницы, готовый SVG. */
  qrSvg: string;
  /** Публичный адрес страницы — для og-разметки. */
  pageUrl: string;
  /** Ссылка на бота: `https://t.me/<username>`. */
  botUrl?: string | null | undefined;
  /** Подпись, которую написал агент. Может быть пустой. */
  caption?: string | null;
  /** Хештеги фестиваля одной строкой. */
  hashtags: string;
  /** Сколько токенов даём за репост. 0 — про бонус не пишем. */
  bonusTokens?: number | undefined;
}

/**
 * Публичная страница результата — то, куда ведёт QR-код (ТЗ, оба сценария).
 *
 * Собирается строкой, а не в Next.js, потому что живёт на Fastify рядом с
 * ботом: домен один, а маршрут `/g/*` по правилам инфраструктуры отдаёт
 * именно бот. Никаких внешних шрифтов и скриптов — страницу открывают с
 * телефона в зале, где вайфай перегружен, и она обязана показаться сразу.
 *
 * Палитра — та же нейтральная шкала, что у админки (shadcn neutral), но
 * записанная в hex, а не в oklch: `oklch` не понимают браузеры старше
 * Chrome 111 и Safari 15.4, а на фестивале телефоны всякие.
 */
export function renderSharePage(input: SharePageInput): string {
  const caption = input.caption?.trim();
  const tags = input.hashtags.trim();
  const bot = input.botUrl?.trim();
  const bonus = input.bonusTokens ?? 0;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Картинка из будущего</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="Картинка из будущего">
<meta property="og:image" content="${attr(input.imageUrl)}">
<meta property="og:url" content="${attr(input.pageUrl)}">
<meta property="og:description" content="${attr(caption || 'Сделано на фестивале центра «Лидер» и MagnaQore')}">
<style>
  :root {
    color-scheme: light dark;
    --bg:      #ffffff;
    --fg:      #0a0a0a;
    --muted:   #737373;
    --line:    #e5e5e5;
    --soft:    #f5f5f5;
    --primary:    #171717;
    --primary-fg: #fafafa;
    --r: 10px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:      #0a0a0a;
      --fg:      #fafafa;
      --muted:   #a3a3a3;
      --line:    #262626;
      --soft:    #171717;
      --primary:    #fafafa;
      --primary-fg: #171717;
    }
  }

  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    padding: 32px 20px 40px;
    background: var(--bg);
    color: var(--fg);
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 440px; margin: 0 auto; }

  .brand {
    font-size: 11px;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 24px;
  }
  .brand span { opacity: .45; margin: 0 .4em; }

  figure { margin: 0; }
  .shot {
    display: block; width: 100%; height: auto;
    border: 1px solid var(--line);
    border-radius: calc(var(--r) * 1.4);
    background: var(--soft);
  }

  .caption {
    margin: 20px 0 0;
    font-size: 17px;
    line-height: 1.45;
    letter-spacing: -.011em;
  }

  .actions { margin-top: 24px; display: grid; gap: 8px; }
  .btn {
    display: block; width: 100%;
    padding: 12px 16px;
    border: 1px solid transparent;
    border-radius: var(--r);
    font: inherit; font-weight: 500;
    text-align: center; text-decoration: none;
    cursor: pointer;
    transition: opacity .15s;
  }
  .btn:active { opacity: .8; }
  .btn-primary { background: var(--primary); color: var(--primary-fg); }
  .btn-ghost {
    background: transparent; color: var(--fg);
    border-color: var(--line);
  }

  .section { margin-top: 32px; }
  .label {
    margin: 0 0 8px;
    font-size: 11px; font-weight: 500;
    letter-spacing: .09em; text-transform: uppercase;
    color: var(--muted);
  }
  .tags {
    margin: 0;
    padding: 12px 14px;
    background: var(--soft);
    border: 1px solid var(--line);
    border-radius: var(--r);
    font-size: 14px;
    color: var(--fg);
    word-break: break-word;
  }

  .bonus {
    margin: 12px 0 0;
    padding: 12px 14px;
    border: 1px dashed var(--line);
    border-radius: var(--r);
    font-size: 14px;
    color: var(--muted);
  }
  .bonus b { color: var(--fg); font-weight: 500; }
  .bonus a { color: var(--fg); }

  .qr { margin-top: 32px; display: flex; align-items: center; gap: 16px; }
  .qr-code {
    flex: none; width: 84px; height: 84px;
    padding: 7px;
    background: #ffffff;
    border: 1px solid var(--line);
    border-radius: var(--r);
  }
  .qr-code svg { display: block; width: 100%; height: 100%; }
  .qr-text { font-size: 13px; color: var(--muted); }

  .foot {
    margin: 40px 0 0;
    padding-top: 20px;
    border-top: 1px solid var(--line);
    font-size: 13px;
    color: var(--muted);
    text-align: center;
  }
  .foot a { color: var(--fg); text-decoration: none; font-weight: 500; }
  .foot a:hover { text-decoration: underline; }

  /* Своя всплывашка вместо нативного диалога — их в проекте нет. */
  .toast {
    position: fixed; left: 50%; bottom: 24px;
    transform: translate(-50%, 12px);
    padding: 9px 16px;
    background: var(--primary); color: var(--primary-fg);
    border-radius: 999px;
    font-size: 13px; font-weight: 500;
    opacity: 0; pointer-events: none;
    transition: opacity .16s ease, transform .16s ease;
  }
  .toast[data-on] { opacity: 1; transform: translate(-50%, 0); }
</style>
</head>
<body>
<main class="wrap">
  <p class="brand">Лидер<span>×</span>MagnaQore</p>

  <figure>
    <img class="shot" src="${attr(input.imageUrl)}" alt="Сгенерированная картинка">
    ${caption ? `<figcaption class="caption">${esc(caption)}</figcaption>` : ''}
  </figure>

  <div class="actions">
    <a class="btn btn-primary" href="${attr(input.downloadUrl)}" download>Скачать</a>
    <button class="btn btn-ghost" type="button" id="copy">Скопировать хештеги</button>
  </div>

  <section class="section">
    <p class="label">Хештеги для репоста</p>
    <p class="tags" id="tags">${esc(tags)}</p>
    ${bonus > 0 ? `<p class="bonus">Выложи с ними — и пришли ссылку на пост
      ${bot ? `<a href="${attr(bot)}">боту</a>` : 'боту'}.
      Начислим <b>${bonus} ${tokenWord(bonus)}</b> на новые картинки.</p>` : ''}
  </section>

  <div class="qr">
    <div class="qr-code">${input.qrSvg}</div>
    <p class="qr-text">Покажи код другу — откроется эта же страница.</p>
  </div>

  <p class="foot">${bot
    ? `Сделано в <a href="${attr(bot)}">телеграм-боте фестиваля</a>`
    : 'Сделано на фестивале центра «Лидер» и MagnaQore'}</p>
</main>

<div class="toast" id="toast">Скопировано</div>

<script>
(function () {
  var btn = document.getElementById('copy');
  var toast = document.getElementById('toast');
  var tags = document.getElementById('tags').textContent;
  var timer;

  function say(text) {
    toast.textContent = text;
    toast.setAttribute('data-on', '');
    clearTimeout(timer);
    timer = setTimeout(function () { toast.removeAttribute('data-on'); }, 1800);
  }

  function fallback() {
    // clipboard API есть не везде (http, старые webview) — тогда старый способ.
    var ta = document.createElement('textarea');
    ta.value = tags;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); say('Скопировано'); }
    catch (e) { say('Не вышло — выдели текст вручную'); }
    document.body.removeChild(ta);
  }

  btn.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tags).then(function () { say('Скопировано'); }, fallback);
    } else { fallback(); }
  });
})();
</script>
</body>
</html>`;
}

/** Страница «такой ссылки нет» — с тем же лицом, а не голый 404 Fastify. */
export function renderNotFoundPage(botUrl?: string | null): string {
  const bot = botUrl?.trim();
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ссылка не найдена</title>
<style>
  :root { color-scheme: light dark; --bg:#ffffff; --fg:#0a0a0a; --muted:#737373; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0a0a0a; --fg:#fafafa; --muted:#a3a3a3; } }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--bg); color:var(--fg); text-align:center; padding:24px;
         font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         font-size:15px; line-height:1.55; }
  h1 { font-size:18px; font-weight:600; margin:0 0 6px; letter-spacing:-.011em; }
  p { margin:0; color:var(--muted); }
  a { color:var(--fg); font-weight:500; }
</style>
</head>
<body>
  <div>
    <h1>Такой ссылки нет</h1>
    <p>Проверь адрес или отсканируй QR-код ещё раз.${bot
      ? ` <a href="${attr(bot)}">Открыть бота</a>`
      : ''}</p>
  </div>
</body>
</html>`;
}

/** Склонение «токен»: «3 токен» на витрине выглядит неряшливо. */
function tokenWord(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'токенов';
  switch (n % 10) {
    case 1: return 'токен';
    case 2: case 3: case 4: return 'токена';
    default: return 'токенов';
  }
}

/** Экранирование текста внутри HTML. Подпись пишет модель — доверять нельзя. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
    : c === '"' ? '&quot;' : '&#39;'
  ));
}

/** Экранирование для значения атрибута. */
function attr(s: string): string {
  return esc(s);
}
