import type { AppContext } from '../context.js';

/**
 * Реестр картинок диалога (ADR 0010).
 *
 * Зачем он появился. Раньше картинку для правки выбирал backend по эвристике,
 * а у инструментов вообще не было параметра «какую». Модель не могла ошибиться
 * в выборе — ей не давали выбирать. Плюс история собиралась только из текста,
 * то есть модель не видела ни одной картинки, кроме самой свежей, и
 * ориентировалась по своим же старым репликам.
 *
 * Теперь каждая картинка получает короткий id, список уходит в контекст,
 * а выбор делает модель — как сделал бы человек, глядя на переписку.
 *
 * Реестр НЕ хранится отдельной таблицей: он выводится из того, что и так
 * лежит в БД. Значит рассинхрону взяться неоткуда.
 */
export interface DialogImage {
  /** Короткий id для модели: img1, img2… Хронологический, append-only. */
  id: string;
  /** Кто автор: прислал участник или нарисовали мы. */
  origin: 'user' | 'bot';
  /** URL, по которому картинку прочитает модель. */
  url: string;
  /** Строчка для списка в контексте — по-русски, для модели. */
  label: string;
  /**
   * Это «мир из игры» — сценарий 2 ТЗ, а не просто картинка.
   *
   * Отличать обязательно: правка мира двигает `users.current_world_media_id`
   * вперёд по цепочке, а правка обычной фотографии — нет. Живой случай
   * 27.08: участник поправил присланное фото башни, и его город на облаках
   * молча перестал быть его миром.
   */
  isWorld?: boolean;
  /**
   * По какому заданию эта картинка — сама выданная основа или любая правка
   * от неё. Нужно, чтобы работа записалась в реестр с тем же заданием и
   * жюри могло отобрать работы по нему (ADR 0013).
   */
  taskId?: string;
  at: Date;
}

/** Сколько картинок реально прикладывать к запросу (остальные — строкой). */
export const DEFAULT_IMAGES_IN_CONTEXT = 6;

interface Draft {
  origin: 'user' | 'bot';
  at: Date;
  label: string;
  isWorld?: boolean;
  taskId?: string;
  url?: string;
  mediaId?: string;
}

/**
 * Собирает картинки диалога по времени: фото участника, наши генерации и
 * выданный стартовый мир.
 *
 * Ссылки на наши файлы берутся из кэша `media.remote_url`, поэтому обычный
 * оборот не тратит ни одной заливки.
 */
export async function collectDialogImages(
  app: AppContext,
  input: { conversationId: string; userId: string; conversationStartedAt: Date },
): Promise<DialogImage[]> {
  const drafts: Draft[] = [];

  for (const photo of await app.conversations.userImages(input.conversationId)) {
    drafts.push({
      origin: 'user',
      at: photo.at,
      url: photo.url,
      label: 'фото, которое прислал участник',
    });
  }

  for (const gen of await app.generations.resultsForConversation(input.conversationId)) {
    const idea = gen.caption?.trim() || gen.userPrompt.trim();
    drafts.push({
      origin: 'bot',
      at: gen.at ?? new Date(),
      mediaId: gen.mediaId,
      // Вся цепочка мира помечается миром, а не только последнее звено:
      // участник вправе вернуться к раннему варианту и продолжить с него.
      isWorld: gen.kind === 'world',
      ...(gen.taskId ? { taskId: gen.taskId } : {}),
      label: idea ? `мы нарисовали: «${trim(idea, 70)}»` : 'картинка, которую мы нарисовали',
    });
  }

  // Стартовый мир живёт у участника, а не у диалога: он переживает
  // «остывание» истории, и участник вправе вернуться к нему завтра.
  const world = await app.worlds.getCurrent(input.userId);
  if (world) {
    drafts.push({
      origin: 'bot',
      // Мир мог быть выдан до этого диалога — тогда ставим его в самое начало.
      at: world.at ?? new Date(input.conversationStartedAt.getTime() - 1),
      mediaId: world.mediaId,
      isWorld: true,
      label: 'стартовый мир участника (сценарий с превращением миров)',
    });
  }

  // Задание живёт у участника, как и мир: картинку выдали, а править её он
  // может и через полчаса. Без этой записи основа задания в реестр не
  // попадёт вовсе, и менять будет нечего.
  const task = await app.tasks.getCurrent(input.userId);
  if (task) {
    drafts.push({
      origin: 'bot',
      at: task.at ?? new Date(input.conversationStartedAt.getTime() - 1),
      mediaId: task.mediaId,
      taskId: task.taskId,
      label: task.taskText
        ? `картинка задания: «${trim(task.taskText, 70)}»`
        : `картинка задания «${task.title}»`,
    });
  }

  drafts.sort((a, b) => a.at.getTime() - b.at.getTime());

  const out: DialogImage[] = [];
  for (const d of drafts) {
    const url = d.url ?? (d.mediaId ? await app.uploadStoredMedia?.(d.mediaId) : null);
    // Картинка без доступной ссылки в реестр не идёт: сослаться на неё
    // модель всё равно не сможет, а пустой id в списке только запутает.
    if (!url) continue;

    // Одна и та же картинка приходит дважды: как результат генерации и как
    // текущий мир. Второй раз в список её не добавляем, но признак мира
    // переносим — иначе он потерялся бы вместе с дублем.
    const seen = out.find((x) => x.url === url);
    if (seen) {
      if (d.isWorld) seen.isWorld = true;
      if (d.taskId) seen.taskId = d.taskId;
      continue;
    }
    out.push({
      id: `img${out.length + 1}`, origin: d.origin, url, label: d.label, at: d.at,
      ...(d.isWorld ? { isWorld: true } : {}),
      ...(d.taskId ? { taskId: d.taskId } : {}),
    });
  }
  return out;
}

/**
 * Служебные сообщения с картинками — то, что реально уходит модели.
 *
 * Каждая картинка идёт ОТДЕЛЬНЫМ сообщением со своим id: если сложить
 * несколько в одно, модель не поймёт, где img2, а где img3, и начнёт
 * путать их местами.
 */
export function imageContextMessages(
  images: DialogImage[],
  now: Date,
  attachLimit = DEFAULT_IMAGES_IN_CONTEXT,
): Array<{ role: 'user'; text: string; imageUrls?: string[] }> {
  if (images.length === 0) return [];

  const attachFrom = Math.max(0, images.length - attachLimit);
  return images.map((img, i) => {
    const who = img.origin === 'user' ? 'Прислал участник' : 'Нарисовали мы';
    const head = `[${img.id}] ${who}: ${img.label}. ${ago(img.at, now)}.`;
    return i >= attachFrom
      ? { role: 'user' as const, text: head, imageUrls: [img.url] }
      : { role: 'user' as const, text: `${head} (сама картинка сюда не приложена)` };
  });
}

/** Человеческая давность — модели проще рассуждать «свежее / старее». */
function ago(at: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (min < 1) return 'только что';
  if (min === 1) return 'минуту назад';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  return h === 1 ? 'час назад' : `${h} ч назад`;
}

function trim(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
