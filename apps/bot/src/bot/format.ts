/**
 * Markdown от модели → HTML для Telegram.
 *
 * Почему не MarkdownV2: он требует экранировать `_ * [ ] ( ) ~ > # + - = | { } . !`,
 * и модель ломает сообщение первой же точкой в конце предложения. Telegram
 * отвечает 400, участник не видит ничего.
 *
 * Почему не «просто HTML от модели»: тогда модель сама решает, что
 * экранировать, и рано или поздно ошибётся.
 *
 * Поэтому: модель пишет привычным markdown, экранирование делаем мы.
 */

const ALLOWED = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'a', 'blockquote', 'tg-spoiler']);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Конвертирует markdown в подмножество HTML, которое понимает Telegram.
 * Всё, что не распознано, остаётся экранированным текстом — сообщение
 * никогда не ломается, в худшем случае теряется оформление.
 */
export function toTelegramHtml(md: string): string {
  const blocks: string[] = [];

  // Блоки кода вынимаем ПЕРВЫМИ: внутри них markdown не действует.
  let s = md.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_m, code: string) => {
    blocks.push(`<pre>${escapeHtml(code.replace(/\n$/, ''))}</pre>`);
    return ` BLOCK${blocks.length - 1} `;
  });
  s = s.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    blocks.push(`<code>${escapeHtml(code)}</code>`);
    return ` BLOCK${blocks.length - 1} `;
  });

  s = escapeHtml(s);

  // Ссылки до остального: текст ссылки может содержать выделение.
  s = s.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text: string, href: string) => `<a href="${href}">${text}</a>`,
  );

  s = s
    .replace(/\*\*([^\n*]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^\n_]+)__/g, '<b>$1</b>')
    .replace(/~~([^\n~]+)~~/g, '<s>$1</s>')
    // Одиночная звёздочка — курсив, но не внутри слова (2*3*4) и не маркер списка.
    .replace(/(^|[\s(])\*([^\n*]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])_([^\n_]+)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');

  s = s
    // Заголовки Telegram не поддерживает — делаем жирной строкой.
    .replace(/^#{1,6}\s*(.+)$/gm, '<b>$1</b>')
    // Маркеры списка: у Telegram нет <ul>, ставим типографскую точку.
    .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')
    .replace(/^&gt;[ \t]?(.*)$/gm, '<blockquote>$1</blockquote>');

  s = s.replace(/ ?BLOCK(\d+) ?/g, (_m, i: string) => blocks[Number(i)] ?? '');
  return s.trim();
}

/**
 * Грубая проверка, что теги сбалансированы. Нужна как последний рубеж:
 * если что-то поехало, лучше отправить простым текстом, чем не отправить.
 */
export function looksBalanced(html: string): boolean {
  const stack: string[] = [];
  const re = /<(\/?)([a-z-]+)(?:\s[^>]*)?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, slash, tag] = m;
    const name = tag!.toLowerCase();
    if (!ALLOWED.has(name)) return false;
    if (slash) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

/** Telegram режет сообщения длиннее 4096 символов. */
export const TELEGRAM_MAX = 4096;

export function clampForTelegram(text: string): string {
  if (text.length <= TELEGRAM_MAX) return text;
  return `${text.slice(0, TELEGRAM_MAX - 1)}…`;
}

/**
 * Готовит текст к отправке. Возвращает и HTML, и запасной простой текст —
 * вызывающая сторона отправит второй, если Telegram отверг первый.
 */
export function prepareMessage(raw: string): { html: string; plain: string; useHtml: boolean } {
  const plain = clampForTelegram(raw.trim());
  const html = clampForTelegram(toTelegramHtml(raw));
  return { html, plain, useHtml: looksBalanced(html) };
}
