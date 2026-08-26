/** Соотношения сторон в нашем внутреннем словаре. */
export const ASPECT_RATIOS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Что именно делает пользователь — определяет выбор модели. */
export type ImageTask =
  | 'text_to_image'    // с нуля по тексту
  | 'restyle_photo'    // сценарий 1 ТЗ: лицо участника → профессия
  | 'transform_world'; // сценарий 2 ТЗ: базовый мир → новый мир

/** Уровень качества в наших терминах; каждый адаптер переводит по-своему. */
export type Quality = 'fast' | 'standard' | 'high';

/** Нормализованный запрос — одинаковый для всех моделей. */
export interface ImageRequest {
  prompt: string;
  /** URL входных изображений (уже загруженных в kie.ai File Upload API). */
  images?: string[];
  aspectRatio?: AspectRatio;
  quality?: Quality;
}

export interface ImageModel {
  /** Наш стабильный идентификатор (пишется в БД, не меняется). */
  id: string;
  /** Значение поля `model` для kie.ai createTask. */
  kieModel: string;
  label: string;
  /** Принимает ли входные изображения (image-to-image). */
  acceptsImages: boolean;
  /** Максимум входных изображений. */
  maxImages: number;
  /** Какие соотношения сторон поддерживает НАТИВНО. */
  aspectRatios: readonly AspectRatio[];
  /** Цена за изображение в USD по уровням качества (для логов и бюджета). */
  costUsd: Record<Quality, number>;
  /** Сильные стороны — основание для маршрутизации, а не рекламный текст. */
  notes: string;
  /**
   * Собирает поле `input` для kie.ai. Модели несовместимы между собой:
   * image_input / input_urls / image_urls, resolution / quality / ничего.
   */
  buildInput(req: ImageRequest): Record<string, unknown>;
}
