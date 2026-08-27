import type { AspectRatio } from './types';

/**
 * Сборка промптов для сценариев ТЗ.
 *
 * Разделение ответственности:
 *   - **агент** пишет творческую часть — мысль участника, переведённую на
 *     английский и дословно сохранённую;
 *   - **этот модуль** дописывает техническую обвязку и жёсткие ограничения,
 *     одинаковые для всех участников.
 *
 * Обвязка живёт здесь, а не в промпте агента, потому что она не должна
 * зависеть от настроения модели: «сохрани лицо» обязано быть в КАЖДОМ
 * запросе сценария 1, а не тогда, когда агент вспомнил.
 * См. .claude/rules/20-bot-agent.md
 */

/** Общий хвост качества. Без него модели тяготеют к плоской картинке. */
const QUALITY = 'Sharp focus, professional lighting, high detail, natural colours.';

/** Что модель не должна пририсовывать сама. */
const NO_ARTIFACTS = 'No text, watermarks, logos or captions anywhere in the image.';

export interface EditPromptInput {
  /** Что именно попросил изменить участник — дословно, одной фразой. */
  change: string;
}

/**
 * Единственная правка картинки — и «сделай меня космонавтом», и «добавь
 * шторм в мой мир», и «перекрась куртку».
 *
 * Раньше это были два разных сборщика под два сценария ТЗ, и оба
 * применялись только к «своему» инструменту. Побочный эффект был скверный:
 * защита лица работала лишь в сценарии «профессия», а на обычной правке
 * фотографии человека модель спокойно «улучшала» ему внешность. Теперь оба
 * требования — узнаваемость человека и «менять только названное» — идут в
 * КАЖДУЮ правку (ADR 0010).
 *
 * Порядок частей выверен замерами: требование идентичности стоит рядом с
 * началом, иначе модели теряют лицо; «не перерисовывай сцену с нуля» —
 * в конце, потому что без него модель делает красивую, но чужую картинку.
 */
export function buildEditPrompt(input: EditPromptInput): string {
  return [
    'Edit the provided image.',
    `Apply exactly this change: ${input.change.trim()}`,
    '',
    'If a person is visible, keep their face, facial features, skin tone, hairstyle',
    'and hair colour strictly identical to the original — it must remain recognisably',
    'the same person. Do not beautify, slim, age or rejuvenate anyone.',
    '',
    'Everything the instruction does not mention stays as it was: the subject, the',
    'composition and framing, and the artistic style and medium of the original image.',
    'Do not redraw the scene from scratch.',
    '',
    NO_ARTIFACTS,
  ].filter(Boolean).join(' ');
}

/**
 * Сценарий «с нуля»: тут обвязка минимальна — участник волен просить что угодно,
 * и лишние ограничения только сузили бы фантазию.
 */
export function buildFreePrompt(idea: string): string {
  return `${idea.trim()} ${QUALITY} ${NO_ARTIFACTS}`;
}

/**
 * Умолчания кадра. Соотношение теперь называет агент — он видит картинку и
 * понимает, портрет это или пейзаж; здесь только запасные значения.
 */
export const DEFAULT_ASPECT: Record<'profession' | 'world' | 'free', AspectRatio> = {
  profession: '3:4',
  world: '16:9',
  free: '1:1',
};
