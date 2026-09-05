/**
 * Текст ответа агента, когда в этом же ходе поставлена генерация.
 *
 * Живой случай 05.09: участник просит «добавь на небе НЛО», бот шлёт
 * карточку «Рисую… картинка появится прямо здесь» и следом пишет от себя
 * «Добавил НЛО в небо над марсианской станцией». Прошедшее время рядом с
 * пустой карточкой читается как «сделал, а картинки нет» — заказчик решил,
 * что генерация не работает. Модель просили говорить «рисую», а не
 * «добавил», и просьбы недостаточно: gpt-5-5 всё равно отчитывается о
 * результате, которого ещё нет.
 *
 * Поэтому текст здесь пишет код, а не модель: он говорит ровно то, что
 * человек видит на экране. Подпись к будущей картинке модель уже написала —
 * она стоит на карточке, терять её авторский текст незачем.
 */
export const PROGRESS_TEXT =
  'Рисую. Картинка появится в карточке выше — обычно через минуту, иногда две-три.';

/** Инструменты, которые ставят генерацию и шлют карточку «Рисую…». */
const GENERATING_TOOLS: ReadonlySet<string> = new Set(['edit_image', 'generate_image']);

/**
 * Поставлена ли в этом ходе генерация. Смотрим на РЕЗУЛЬТАТ инструмента, а
 * не на признак «карточка ушла»: его ставят и выдача задания, и выдача мира
 * (чтобы ответ шёл под картинкой), и по нему первая версия подменяла
 * «напиши своими словами, что изменить» на «рисую» — на выданном задании
 * рисовать нечего (dev, 05.09 09:40).
 */
export function generationPlaced(
  toolCalls: ReadonlyArray<{ name: string; result: { ok: boolean; data?: Record<string, unknown> } }>,
): boolean {
  return toolCalls.some((t) => GENERATING_TOOLS.has(t.name) && t.result.ok && t.result.data?.status === 'accepted');
}

/**
 * Выдано ли в этом ходе задание. Картинка с текстом задания уже у
 * участника; всё, что модель пишет следом, — лишнее. 05.09 она написала
 * «Пусть сам опишет, что на картинке надо изменить — в этом и интерес»:
 * мысль вслух в третьем лице, поверх и так понятной картинки.
 */
export function taskIssued(
  toolCalls: ReadonlyArray<{ name: string; result: { ok: boolean } }>,
): boolean {
  return toolCalls.some((t) => t.name === 'get_task' && t.result.ok);
}

export type ReplyOverride = 'progress' | 'task_issued';

/**
 * Что отправить участнику после хода агента.
 *
 * Выдано задание — ничего: картинка с целью уже у него, пустой текст
 * отправитель не шлёт и убирает «Думаю…». Поставлена генерация — честное
 * «рисую» вместо отчёта о результате, которого нет. Иначе — слова модели.
 */
export function shapeReply(
  modelText: string,
  toolCalls: ReadonlyArray<{ name: string; result: { ok: boolean; data?: Record<string, unknown> } }>,
): { text: string; override?: ReplyOverride } {
  if (taskIssued(toolCalls)) return { text: '', override: 'task_issued' };
  if (generationPlaced(toolCalls)) return { text: PROGRESS_TEXT, override: 'progress' };
  return { text: modelText };
}
