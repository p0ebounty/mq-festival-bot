/** Форматирование для таблиц админки. Всё по-русски. */

/**
 * Часовой пояс, в котором админка показывает время.
 *
 * Задан ЯВНО, и на то две причины. Сервер живёт в UTC, поэтому без него
 * страница на сервере рисовала «13:15», а браузер организатора — «16:15»:
 * React считал это расхождением гидратации и перерисовывал таблицу
 * (две ошибки в консоли Next на странице диалогов, 30.08). Плюс в
 * серверном рендере время было на три часа раньше реального — на
 * фестивале это сбивает с толку сильнее, чем кажется.
 *
 * Меняется здесь, если фестиваль пройдёт в другом поясе.
 */
export const ADMIN_TIME_ZONE = 'Europe/Moscow';

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: ADMIN_TIME_ZONE,
  });
}

export function dateTimeFull(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: ADMIN_TIME_ZONE,
  });
}

/**
 * «5 мин назад» — на стенде важнее давность, чем точное время.
 *
 * ⚠️ Считается от `Date.now()`, поэтому сервер и браузер дают разный текст
 * по самой природе величины: между рендерами проходит время. Узлы с этим
 * значением помечаются `suppressHydrationWarning` — расхождение здесь
 * ожидаемо и не является дефектом.
 */
export function ago(d: Date | string | null | undefined): string {
  if (!d) return 'никогда';
  const date = typeof d === 'string' ? new Date(d) : d;
  const min = Math.round((Date.now() - date.getTime()) / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const days = Math.round(h / 24);
  return days === 1 ? 'вчера' : `${days} дн назад`;
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return `${(ms / 1000).toFixed(1)} с`;
}

/**
 * Как назвать участника. `tgId` принимаем и строкой, и bigint: в серверных
 * выборках это bigint, а в клиентские компоненты он уезжает строкой —
 * bigint не переживает сериализацию из server component.
 */
export function userLabel(u: {
  firstName?: string | null; username?: string | null; tgId?: bigint | string | null;
}): string {
  return u.firstName || (u.username ? `@${u.username}` : null) || (u.tgId ? `id ${u.tgId}` : 'без имени');
}

/** Заголовки статусов — в таблицах нужен русский, а не enum из БД. */
export const GENERATION_STATUS: Record<string, { label: string; tone: 'ok' | 'bad' | 'wait' }> = {
  pending: { label: 'в очереди', tone: 'wait' },
  submitted: { label: 'отправлена', tone: 'wait' },
  generating: { label: 'рисуется', tone: 'wait' },
  success: { label: 'готово', tone: 'ok' },
  failed: { label: 'сбой', tone: 'bad' },
  refunded: { label: 'возврат', tone: 'bad' },
};

export const GENERATION_KIND: Record<string, string> = {
  image: 'картинка',
  profession: 'профессия',
  world: 'мир',
};

export const LEDGER_REASON: Record<string, string> = {
  signup: 'стартовый баланс',
  generation: 'генерация',
  refund: 'возврат',
  social_bonus: 'бонус за репост',
  admin: 'правка админа',
};

export const CLAIM_EVIDENCE: Record<string, string> = {
  phash: 'совпал хеш картинки',
  'vision+page': 'решил проверяющий по странице',
  'vision+screenshot': 'решил проверяющий по скриншоту',
  none: 'отсеяно на разборе ссылки',
};
