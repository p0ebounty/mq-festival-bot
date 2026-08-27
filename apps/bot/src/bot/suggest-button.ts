import { InlineKeyboard } from 'grammy';

/**
 * Кнопки-подсказки под сообщением бота.
 *
 * Раньше это была нижняя панель (reply-клавиатура), и она **болталась**:
 * панель принадлежит чату, а не сообщению, и снять её можно единственным
 * способом — прислать НОВОЕ сообщение со снятием. Проверено запросами к
 * API: `editMessageText` на попытку снять отвечает `inline keyboard
 * expected`, а сообщение, отправленное с клавиатурой или со снятием,
 * вообще нередактируемо (`message can't be edited`).
 *
 * Значит подсказка жила от нажатия до следующей реплики агента — то есть
 * всю генерацию картинки, а если человек отошёл, то навсегда.
 *
 * Inline-кнопки принадлежат сообщению. Нажали — правим это сообщение и
 * убираем их: подсказка исчезает в момент использования. Не нажали — она
 * уезжает вверх вместе со своим сообщением, как обычный текст.
 *
 * Побочная выгода: inline-разметку МОЖНО прицепить к правке, поэтому
 * заглушка «Думаю…» теперь превращается в ответ прямо с кнопками, без
 * удаления и пересылки.
 */
const PREFIX = 'sg:';

/** Жёсткий лимит Telegram на callback_data — 64 БАЙТА, не символа. */
const MAX_BYTES = 64;

/**
 * Подрезает строку так, чтобы вместе с префиксом она уложилась в лимит.
 *
 * Режем по кодовым точкам, а не по байтам: половинка символа испортила бы
 * и подпись, и текст, который уйдёт от лица участника. Подпись и полезная
 * нагрузка — ОДНА И ТА ЖЕ строка, иначе на кнопке будет написано одно, а
 * отправится другое.
 */
export function fitCallbackText(text: string): string {
  const budget = MAX_BYTES - Buffer.byteLength(PREFIX, 'utf8');
  const chars = [...text];
  let out = '';
  for (const ch of chars) {
    if (Buffer.byteLength(out + ch, 'utf8') > budget) break;
    out += ch;
  }
  return out;
}

/** Клавиатура подсказок: по одной кнопке в ряд — так они читаются на телефоне. */
export function suggestionKeyboard(options: readonly string[]): InlineKeyboard | undefined {
  const rows = options
    .map((o) => fitCallbackText(o.trim()))
    .filter((o) => o.length > 0);
  if (rows.length === 0) return undefined;
  // Через конструктор, а не цепочкой `.text().row()`: хвостовой `.row()`
  // оставляет пустой ряд, и Telegram рисует под кнопками лишнюю полосу.
  return new InlineKeyboard(rows.map((o) => [InlineKeyboard.text(o, PREFIX + o)]));
}

/** Регулярка для регистрации обработчика нажатия. */
export const SUGGEST_PATTERN = new RegExp(`^${PREFIX}(.+)$`, 's');

/** Что написать от лица участника. `null` — данные не наши или пустые. */
export function decodeSuggestion(data: string | undefined): string | null {
  if (!data?.startsWith(PREFIX)) return null;
  const text = data.slice(PREFIX.length).trim();
  return text.length > 0 ? text : null;
}
