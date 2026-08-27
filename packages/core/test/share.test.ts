import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import {
  SHORT_ID_ALPHABET, isShortId, makeShortId, shareUrl,
  renderQrPng, renderQrSvg, renderSharePage, renderNotFoundPage,
} from '../src/share/index';

describe('короткий идентификатор', () => {
  it('состоит только из своего алфавита', () => {
    for (let i = 0; i < 200; i++) {
      for (const ch of makeShortId()) expect(SHORT_ID_ALPHABET).toContain(ch);
    }
  });

  it('не содержит символов, которые путают при наборе', () => {
    // 0/o, 1/l/i — их нет намеренно: адрес читают с чужого экрана.
    for (const bad of ['0', 'o', '1', 'l', 'i']) {
      expect(SHORT_ID_ALPHABET).not.toContain(bad);
    }
  });

  it('длина по умолчанию — 8', () => {
    expect(makeShortId()).toHaveLength(8);
    expect(makeShortId(12)).toHaveLength(12);
  });

  it('не повторяется на разумной выборке', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => makeShortId()));
    expect(seen.size).toBe(5000);
  });

  it('проверка формата отсекает мусор до похода в БД', () => {
    expect(isShortId(makeShortId())).toBe(true);
    expect(isShortId('abc')).toBe(false);              // слишком короткий
    expect(isShortId('a'.repeat(20))).toBe(false);     // слишком длинный
    expect(isShortId('abcd0123')).toBe(false);         // 0 и 1 не в алфавите
    expect(isShortId('../../etc')).toBe(false);
    expect(isShortId('ABCD2345')).toBe(false);         // только нижний регистр
    expect(isShortId('')).toBe(false);
  });

  it('собирает публичный адрес и не двоит слэш', () => {
    expect(shareUrl('https://bot.example.com', 'abcd2345'))
      .toBe('https://bot.example.com/g/abcd2345');
    expect(shareUrl('https://bot.example.com/', 'abcd2345'))
      .toBe('https://bot.example.com/g/abcd2345');
  });
});

describe('QR-код', () => {
  const url = 'https://bot.example.com/g/abcd2345';

  it('PNG отдаётся настоящим PNG', async () => {
    const png = await renderQrPng(url);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.length).toBeGreaterThan(500);
  });

  it('SVG масштабируемый и ничего не грузит из сети', async () => {
    const svg = await renderQrSvg(url);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
    // Страница обязана открыться при перегруженном вайфае в зале.
    // (xmlns — объявление пространства имён, запроса в сеть за ним нет.)
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('xlink:href');
    expect(svg.replace(/xmlns(:\w+)?="[^"]*"/g, '')).not.toMatch(/https?:\/\//);
  });

  it('длинная ссылка тоже кодируется', async () => {
    await expect(renderQrPng(`${url}?${'x'.repeat(300)}`)).resolves.toBeInstanceOf(Buffer);
  });

  /**
   * Главная проверка: код обязан ЧИТАТЬСЯ. Всё остальное про QR —
   * косметика, а нечитаемый код на фестивале это просто картинка.
   * Декодируем настоящим сканером, а не доверяем генератору на слово.
   */
  it('код действительно сканируется и даёт ту же ссылку', async () => {
    const png = await renderQrPng(url);
    const img = PNG.sync.read(png);
    const decoded = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
    expect(decoded?.data).toBe(url);
  });

  it('маленький код тоже читается — его печатают мелко', async () => {
    const png = await renderQrPng(url, { size: 200 });
    const img = PNG.sync.read(png);
    expect(jsQR(new Uint8ClampedArray(img.data), img.width, img.height)?.data).toBe(url);
  });
});

describe('страница результата', () => {
  const base = {
    imageUrl: 'https://host/g/abcd2345/i',
    downloadUrl: 'https://host/g/abcd2345/download',
    qrSvg: '<svg viewBox="0 0 10 10"></svg>',
    pageUrl: 'https://host/g/abcd2345',
    hashtags: '#ЦентрЛидер #MagnaQore',
  };

  it('показывает картинку, скачивание и хештеги', () => {
    const html = renderSharePage({ ...base, caption: 'Твой кот в шляпе' });
    expect(html).toContain(base.imageUrl);
    expect(html).toContain(`href="${base.downloadUrl}" download`);
    expect(html).toContain('#ЦентрЛидер #MagnaQore');
    expect(html).toContain('Твой кот в шляпе');
    expect(html).toContain('<svg viewBox="0 0 10 10">');
  });

  it('без подписи не рисует пустой абзац', () => {
    const html = renderSharePage({ ...base, caption: '   ' });
    expect(html).not.toContain('class="caption"');
  });

  /**
   * Подвал раньше вёл на саму же страницу — бесполезная ссылка на то, что
   * уже открыто. Теперь он ведёт к боту: это единственный выход дальше.
   */
  it('подвал ведёт на бота, а не сам на себя', () => {
    const html = renderSharePage({ ...base, botUrl: 'https://t.me/example_dev_bot' });
    expect(html).toContain('href="https://t.me/example_dev_bot"');
    // Ссылки на собственный адрес в подвале быть не должно.
    expect(html).not.toContain(`<a href="${base.pageUrl}"`);
  });

  it('без ссылки на бота подвал не ломается', () => {
    const html = renderSharePage(base);
    expect(html).toContain('Сделано на фестивале');
    expect(html).not.toContain('<a href="">');
  });

  it('палитра совпадает с админкой и не требует свежего браузера', () => {
    // Админка на нейтральной шкале shadcn. Здесь те же цвета в hex:
    // oklch не понимают браузеры старше Chrome 111 / Safari 15.4.
    const html = renderSharePage(base);
    expect(html).toContain('#0a0a0a');
    expect(html).toContain('#fafafa');
    expect(html).not.toContain('oklch(');
  });

  /**
   * Подпись пишет модель, а её текст задаёт участник. Без экранирования
   * достаточно попросить бота «подпиши картинку тегом script».
   */
  it('экранирует подпись — иначе это XSS через промпт', () => {
    const html = renderSharePage({ ...base, caption: '<img src=x onerror=alert(1)>"' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;');
  });

  it('экранирует и хештеги — их правят из админки', () => {
    const html = renderSharePage({ ...base, hashtags: '</script><script>bad()</script>' });
    expect(html).not.toContain('<script>bad()');
  });

  /**
   * Про бонус участник должен узнавать в момент, когда сам собрался
   * делиться. До этой правки фича была, а знать о ней было неоткуда:
   * бот рассказывал про бонус только если его спрашивали.
   */
  it('зовёт прислать ссылку и называет размер бонуса', () => {
    const html = renderSharePage({ ...base, bonusTokens: 3, botUrl: 'https://t.me/mq_bot' });
    expect(html).toContain('пришли ссылку на пост');
    expect(html).toContain('<b>3 токена</b>');
  });

  it('склоняет «токен» по-русски', () => {
    const say = (n: number) => renderSharePage({ ...base, bonusTokens: n });
    expect(say(1)).toContain('1 токен<');
    expect(say(3)).toContain('3 токена<');
    expect(say(5)).toContain('5 токенов<');
    expect(say(11)).toContain('11 токенов<');
    expect(say(22)).toContain('22 токена<');
  });

  it('при нулевом бонусе не обещает того, чего нет', () => {
    expect(renderSharePage({ ...base, bonusTokens: 0 })).not.toContain('Начислим');
    expect(renderSharePage(base)).not.toContain('Начислим');
  });

  it('просит поисковики не индексировать', () => {
    // Ссылка публичная, но это личная картинка участника, а не витрина.
    expect(renderSharePage(base)).toContain('name="robots" content="noindex"');
  });

  it('не тянет внешних шрифтов и скриптов', () => {
    const html = renderSharePage(base);
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('не использует нативных диалогов браузера', () => {
    // Требование заказчика: своих alert/confirm/prompt в проекте нет.
    const html = renderSharePage(base);
    expect(html).not.toMatch(/\balert\s*\(/);
    expect(html).not.toMatch(/\bconfirm\s*\(/);
    expect(html).not.toMatch(/\bprompt\s*\(/);
  });

  it('страница «нет такой ссылки» тоже человеческая', () => {
    const html = renderNotFoundPage();
    expect(html).toContain('Такой ссылки нет');
    expect(html).toContain('viewport');
  });
});
