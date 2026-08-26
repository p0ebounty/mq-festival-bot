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

export interface ProfessionPromptInput {
  /** Творческая часть от агента — мысль участника, дословно. */
  idea: string;
  /** Кусок из каталога профессий: во что одеть и куда поставить. */
  professionFragment: string;
}

/**
 * Сценарий 1 ТЗ: фото участника → он же в профессии.
 *
 * Главное здесь — узнаваемость. Замер 26.08 показал, что при слабых
 * ограничениях модель «улучшает» лицо и человек себя не узнаёт, а тогда
 * он и делиться не станет — то есть фича не работает.
 */
export function buildProfessionPrompt(input: ProfessionPromptInput): string {
  const idea = input.idea.trim();

  return [
    'Transform the person in the provided photograph.',
    // Требование идентичности идёт ПЕРВЫМ и повторяется — так модели
    // держат лицо заметно лучше, чем когда оно спрятано в конце.
    'Keep their face, facial features, skin tone, hairstyle and hair colour',
    'strictly identical to the original photo. This must remain recognisably the same person.',
    'Do not beautify, slim, age, rejuvenate or otherwise alter their appearance.',
    '',
    input.professionFragment.trim(),
    '',
    // ⚠️ Приоритет пожеланий участника над заготовкой каталога.
    // Замер 26.08 показал живую ошибку: участник просил «на фоне родного
    // города», а заготовка «космонавта» ставила станцию с Землёй в окне —
    // и просьба человека просто пропадала. Каталог задаёт умолчание,
    // но последнее слово всегда за участником: в этом весь смысл фичи.
    idea
      ? `The participant specifically asked for this: ${idea} ` +
        'This request takes priority: where it conflicts with the setting described above, ' +
        'follow the participant and change the environment accordingly, keeping the outfit.'
      : '',
    '',
    QUALITY,
    NO_ARTIFACTS,
  ].filter(Boolean).join(' ');
}

export interface WorldPromptInput {
  /** Что именно попросил изменить участник — дословно, одной фразой. */
  change: string;
}

/**
 * Сценарий 2 ТЗ: базовый мир → изменённый одной фразой.
 *
 * Здесь наоборот: менять надо ТОЛЬКО названное. Замер показал, что без
 * жёсткого требования модель переписывает сцену целиком — красиво, но это
 * уже не «изменить одной фразой», а новая картинка.
 */
export function buildWorldPrompt(input: WorldPromptInput): string {
  return [
    'Edit the provided image.',
    `Apply exactly this change: ${input.change.trim()}`,
    '',
    'Keep everything else identical to the original: composition, camera angle,',
    'framing, layout of objects, and the artistic style and medium of the original image.',
    'Change only what the instruction asks for. Do not redraw the scene from scratch.',
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

/** Портрет для профессии, широкий кадр для мира — разумные умолчания. */
export const DEFAULT_ASPECT: Record<'profession' | 'world' | 'free', AspectRatio> = {
  profession: '3:4',
  world: '16:9',
  free: '1:1',
};
