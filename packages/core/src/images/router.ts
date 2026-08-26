import type { ImageModel, ImageRequest, ImageTask } from './types';
import {
  GPT_IMAGE_2_I2I, GPT_IMAGE_2_T2I, GROK_IMAGINE_2_EDIT, NANO_BANANA_2,
  NANO_BANANA_2_LITE, SEEDREAM_5_PRO_I2I,
} from './registry';

/**
 * Маршруты «задача → цепочка моделей».
 *
 * Почему выбор ЗДЕСЬ, а не у LLM:
 *  - фестивалю нужна предсказуемость: одинаковый запрос даёт одинаковую модель;
 *  - агент и так решает, КАКОЙ инструмент вызвать; пусть не решает ещё и КАКОЙ
 *    моделью — это удваивает пространство недетерминизма и усложняет отладку;
 *  - цепочку правит человек одной строкой, не трогая промпт агента.
 *
 * Первый элемент — основной. Остальные подхватывают, если основной упал,
 * упёрся в лимит (429) или не уложился в таймаут. Для стенда на фестивале
 * это главная ценность: сбой одной модели не гасит точку целиком.
 */
export const ROUTES: Record<ImageTask, readonly ImageModel[]> = {
  // Лицо участника обязано остаться узнаваемым — впереди те, кто лучше
  // держит идентичность.
  restyle_photo: [NANO_BANANA_2, GPT_IMAGE_2_I2I, SEEDREAM_5_PRO_I2I],

  // Здесь важно поменять ровно то, что попросили, не разрушив сцену.
  transform_world: [NANO_BANANA_2, GPT_IMAGE_2_I2I, GROK_IMAGINE_2_EDIT],

  // Свободное творчество: сильное следование промпту важнее сохранения лица.
  text_to_image: [NANO_BANANA_2, GPT_IMAGE_2_T2I, NANO_BANANA_2_LITE],
};

export class NoSuitableModelError extends Error {
  constructor(task: ImageTask, reason: string) {
    super(`нет подходящей модели для задачи ${task}: ${reason}`);
    this.name = 'NoSuitableModelError';
  }
}

/**
 * Возвращает цепочку моделей для задачи, отфильтрованную по фактическому
 * запросу: если пришли входные изображения — модели без image-to-image
 * выбрасываются, иначе они молча проигнорируют картинку и вернут не то.
 */
export function planModels(task: ImageTask, req: ImageRequest): ImageModel[] {
  const needsImages = Boolean(req.images?.length);
  const chain = ROUTES[task].filter((m) => (needsImages ? m.acceptsImages : true));

  if (chain.length === 0) {
    throw new NoSuitableModelError(task, needsImages ? 'ни одна не принимает картинки' : 'цепочка пуста');
  }
  // Больше изображений, чем модель принимает, — не ошибка: адаптер обрежет,
  // но кандидатов с бо́льшим лимитом ставим вперёд.
  if (needsImages) {
    const n = req.images!.length;
    chain.sort((a, b) => Number(b.maxImages >= n) - Number(a.maxImages >= n));
  }
  return chain;
}

export function primaryModel(task: ImageTask, req: ImageRequest): ImageModel {
  return planModels(task, req)[0]!;
}

/** Ожидаемая стоимость основной модели — для предварительной оценки бюджета. */
export function estimateCostUsd(task: ImageTask, req: ImageRequest): number {
  return primaryModel(task, req).costUsd[req.quality ?? 'standard'];
}
