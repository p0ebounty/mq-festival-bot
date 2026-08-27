export interface SharePageInput {
  /** Адрес самой картинки (inline). */
  imageUrl: string;
  /** Адрес для скачивания — с Content-Disposition. */
  downloadUrl: string;
  /** QR этой же страницы, готовый SVG. */
  qrSvg: string;
  /** Публичный адрес страницы — его показываем и копируем. */
  pageUrl: string;
  /** Подпись, которую написал агент. Может быть пустой. */
  caption?: string | null;
  /** Хештеги фестиваля одной строкой. */
  hashtags: string;
}

/**
 * Публичная страница результата — то, куда ведёт QR-код (ТЗ, оба сценария).
 *
 * Собирается строкой, а не в Next.js, потому что живёт на Fastify рядом с
 * ботом: домен один, а маршрут `/g/*` по правилам инфраструктуры отдаёт
 * именно бот. Никаких внешних шрифтов и скриптов — страницу открывают с
 * телефона в зале, где вайфай перегружен, и она обязана показаться сразу.
 */
export function renderSharePage(input: SharePageInput): string {
  const caption = input.caption?.trim();
  const tags = input.hashtags.trim();

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Моя картинка из будущего</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="Картинка из будущего">
<meta property="og:image" content="${attr(input.imageUrl)}">
<meta property="og:description" content="${attr(caption || 'Сделано на фестивале центра «Лидер» и MagnaQore')}">
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7fb; --card: #ffffff; --ink: #10131a; --muted: #5b6478;
    --line: #e4e7ef; --accent: #4f46e5; --accent-ink: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0d12; --card: #141821; --ink: #eef1f7; --muted: #97a0b5;
      --line: #232936; --accent: #7c78ff; --accent-ink: #0b0d12;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 20px 16px 48px;
    background: var(--bg); color: var(--ink);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 560px; margin: 0 auto; }
  .brand {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; letter-spacing: .04em; text-transform: uppercase;
    color: var(--muted); margin-bottom: 16px;
  }
  .brand b { color: var(--ink); font-weight: 600; }
  .card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 18px; overflow: hidden;
    box-shadow: 0 1px 2px rgba(16,19,26,.04), 0 8px 24px rgba(16,19,26,.06);
  }
  .shot { display: block; width: 100%; height: auto; background: var(--line); }
  .body { padding: 18px; }
  .caption { margin: 0 0 16px; font-size: 17px; }
  .btn {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; padding: 15px 18px; border: 0; border-radius: 13px;
    background: var(--accent); color: var(--accent-ink);
    font: inherit; font-weight: 600; text-decoration: none; cursor: pointer;
  }
  .btn:active { transform: translateY(1px); }
  .btn.ghost {
    background: transparent; color: var(--ink);
    border: 1px solid var(--line); margin-top: 10px;
  }
  .tags {
    margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--line);
  }
  .tags h2 { margin: 0 0 8px; font-size: 13px; letter-spacing: .04em;
             text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .tagbox {
    background: var(--bg); border: 1px solid var(--line); border-radius: 12px;
    padding: 12px 14px; font-size: 15px; word-break: break-word;
  }
  .qr {
    margin-top: 22px; display: flex; gap: 14px; align-items: center;
    color: var(--muted); font-size: 14px;
  }
  .qr svg { width: 96px; height: 96px; border-radius: 8px; flex: none; background: #fff; padding: 6px; }
  .foot { margin-top: 26px; text-align: center; color: var(--muted); font-size: 13px; }
  .foot a { color: inherit; }
  /* Своя всплывашка вместо нативного диалога — их в проекте нет. */
  .toast {
    position: fixed; left: 50%; bottom: 26px; transform: translate(-50%, 20px);
    background: var(--ink); color: var(--card); padding: 11px 18px;
    border-radius: 999px; font-size: 14px; font-weight: 500;
    opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s;
  }
  .toast.on { opacity: 1; transform: translate(-50%, 0); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><b>Лидер</b> × <b>MagnaQore</b></div>

  <div class="card">
    <img class="shot" src="${attr(input.imageUrl)}" alt="Сгенерированная картинка">
    <div class="body">
      ${caption ? `<p class="caption">${esc(caption)}</p>` : ''}
      <a class="btn" href="${attr(input.downloadUrl)}" download>Скачать картинку</a>
      <button class="btn ghost" type="button" id="copy">Скопировать хештеги</button>

      <div class="tags">
        <h2>Хештеги для репоста</h2>
        <div class="tagbox" id="tags">${esc(tags)}</div>
      </div>

      <div class="qr">
        ${input.qrSvg}
        <div>Покажи этот код другу — он откроет ту же страницу.</div>
      </div>
    </div>
  </div>

  <p class="foot">Сделано на фестивале · <a href="${attr(input.pageUrl)}">${esc(short(input.pageUrl))}</a></p>
</div>

<div class="toast" id="toast">Хештеги скопированы</div>

<script>
(function () {
  var btn = document.getElementById('copy');
  var toast = document.getElementById('toast');
  var tags = document.getElementById('tags').textContent;

  function say(text) {
    toast.textContent = text;
    toast.classList.add('on');
    setTimeout(function () { toast.classList.remove('on'); }, 1900);
  }

  btn.addEventListener('click', function () {
    // clipboard API есть не везде (http, старые webview) — тогда старый способ.
    var done = function () { say('Хештеги скопированы'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tags).then(done, fallback);
    } else { fallback(); }

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = tags;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { say('Не вышло скопировать — выдели текст вручную'); }
      document.body.removeChild(ta);
    }
  });
})();
</script>
</body>
</html>`;
}

/** Страница «такой ссылки нет» — с тем же лицом, а не голый 404 Fastify. */
export function renderNotFoundPage(): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ссылка не найдена</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7fb; --ink:#10131a; --muted:#5b6478; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0d12; --ink:#eef1f7; --muted:#97a0b5; } }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--bg); color:var(--ink); text-align:center; padding:24px;
         font:16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0; color:var(--muted); }
</style>
</head>
<body>
  <div>
    <h1>Такой ссылки нет</h1>
    <p>Проверь адрес или отсканируй QR-код ещё раз.</p>
  </div>
</body>
</html>`;
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

/** Адрес без схемы — в подвале он декоративный, длинный там ни к чему. */
function short(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
