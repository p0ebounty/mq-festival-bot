import type { AspectRatio, ImageModel, ImageRequest, Quality } from './types';

/**
 * Подбирает ближайшее поддерживаемое соотношение сторон.
 * Нужно, потому что наборы у моделей разные: у nano-banana-2 их 15,
 * у grok-imagine — 6, а seedream вообще не понимает 'auto'.
 * Без нормализации запрос уйдёт с невалидным enum и упадёт с 422.
 */
export function nearestAspect(want: AspectRatio | undefined, supported: readonly AspectRatio[]): AspectRatio {
  const fallback = supported.includes('1:1') ? '1:1' : (supported[0] as AspectRatio);
  if (!want) return fallback;
  if (supported.includes(want)) return want;

  const ratio = (a: AspectRatio): number => {
    const [w, h] = a.split(':').map(Number) as [number, number];
    return w / h;
  };
  const target = ratio(want);
  let best = fallback;
  let bestDelta = Infinity;
  for (const cand of supported) {
    // Сравниваем в логарифме — иначе 21:9 «ближе» к 16:9, чем 3:4 к 1:1.
    const delta = Math.abs(Math.log(ratio(cand)) - Math.log(target));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = cand;
    }
  }
  return best;
}

const RES_BY_QUALITY: Record<Quality, '1K' | '2K' | '4K'> = {
  fast: '1K',
  standard: '1K',
  high: '2K',
};

// ─────────────────────────── реестр ───────────────────────────
// Цены — из kie.ai/pricing, проверено 2026-08-26. Держим здесь, чтобы
// стоимость генерации попадала в лог и в админку без похода в API.

export const NANO_BANANA_2: ImageModel = {
  id: 'nano-banana-2',
  kieModel: 'nano-banana-2',
  label: 'Google Nano Banana 2',
  acceptsImages: true,
  maxImages: 14,
  aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  costUsd: { fast: 0.04, standard: 0.04, high: 0.06 },
  notes: 'Лучше всех держит лицо и выполняет точечные правки сцены. Основная модель.',
  buildInput(req) {
    return {
      prompt: req.prompt,
      ...(req.images?.length ? { image_input: req.images.slice(0, 14) } : {}),
      aspect_ratio: nearestAspect(req.aspectRatio, this.aspectRatios),
      resolution: RES_BY_QUALITY[req.quality ?? 'standard'],
      output_format: 'jpg',
    };
  },
};

export const NANO_BANANA_2_LITE: ImageModel = {
  id: 'nano-banana-2-lite',
  kieModel: 'nano-banana-2-lite',
  label: 'Nano Banana 2 Lite',
  acceptsImages: true,
  maxImages: 14,
  aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'],
  costUsd: { fast: 0.02, standard: 0.02, high: 0.02 },
  notes: 'Вдвое дешевле и быстрее старшей. Для черновиков и повторов.',
  buildInput(req) {
    return {
      prompt: req.prompt,
      ...(req.images?.length ? { image_input: req.images.slice(0, 14) } : {}),
      aspect_ratio: nearestAspect(req.aspectRatio, this.aspectRatios),
    };
  },
};

export const GPT_IMAGE_2_T2I: ImageModel = {
  id: 'gpt-image-2-t2i',
  kieModel: 'gpt-image-2-text-to-image',
  label: 'GPT Image 2 (текст → картинка)',
  acceptsImages: false,
  maxImages: 0,
  aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  costUsd: { fast: 0.03, standard: 0.03, high: 0.05 },
  notes: 'Сильное следование промпту и читаемый текст на картинке.',
  buildInput(req) {
    return {
      prompt: req.prompt,
      aspect_ratio: nearestAspect(req.aspectRatio, this.aspectRatios),
      resolution: RES_BY_QUALITY[req.quality ?? 'standard'],
    };
  },
};

export const GPT_IMAGE_2_I2I: ImageModel = {
  id: 'gpt-image-2-i2i',
  kieModel: 'gpt-image-2-image-to-image',
  label: 'GPT Image 2 (картинка → картинка)',
  acceptsImages: true,
  maxImages: 8,
  aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  costUsd: { fast: 0.03, standard: 0.03, high: 0.05 },
  notes: 'Хорошая замена nano-banana на редактировании. Поле называется input_urls.',
  buildInput(req) {
    return {
      prompt: req.prompt,
      ...(req.images?.length ? { input_urls: req.images.slice(0, 8) } : {}),
      aspect_ratio: nearestAspect(req.aspectRatio, this.aspectRatios),
      resolution: RES_BY_QUALITY[req.quality ?? 'standard'],
    };
  },
};

export const SEEDREAM_5_PRO_I2I: ImageModel = {
  id: 'seedream-5-pro-i2i',
  kieModel: 'seedream/5-pro-image-to-image',
  label: 'Seedream 5 Pro (картинка → картинка)',
  acceptsImages: true,
  maxImages: 8,
  // Внимание: 'auto' не поддерживается вообще, а 4:5/5:4 отсутствуют.
  aspectRatios: ['1:1', '3:4', '4:3', '2:3', '3:2', '9:16', '16:9', '21:9'],
  costUsd: { fast: 0.035, standard: 0.035, high: 0.07 },
  notes: 'Третий запасной путь на редактировании. Качество задаётся basic/high.',
  buildInput(req) {
    return {
      prompt: req.prompt,
      ...(req.images?.length ? { image_urls: req.images.slice(0, 8) } : {}),
      aspect_ratio: nearestAspect(req.aspectRatio, this.aspectRatios),
      quality: (req.quality ?? 'standard') === 'high' ? 'high' : 'basic',
      output_format: 'jpeg',
    };
  },
};

export const GROK_IMAGINE_2_EDIT: ImageModel = {
  id: 'grok-imagine-2-edit',
  kieModel: 'grok-imagine-image-2-0/image-edit',
  label: 'Grok Imagine 2 (правка)',
  acceptsImages: true,
  maxImages: 4,
  // Самый бедный набор — всего 6 значений, нормализация обязательна.
  aspectRatios: ['1:1', '2:3', '3:2', '9:16', '16:9'],
  costUsd: { fast: 0.03, standard: 0.03, high: 0.03 },
  notes: 'Быстрая и фотореалистичная. Не умеет задавать разрешение.',
  buildInput(req) {
    return {
      prompt: req.prompt,
      ...(req.images?.length ? { image_urls: req.images.slice(0, 4) } : {}),
      aspect_ratio: nearestAspect(req.aspectRatio, this.aspectRatios),
    };
  },
};

export const IMAGE_MODELS: readonly ImageModel[] = [
  NANO_BANANA_2, NANO_BANANA_2_LITE, GPT_IMAGE_2_T2I, GPT_IMAGE_2_I2I,
  SEEDREAM_5_PRO_I2I, GROK_IMAGINE_2_EDIT,
];

export function getModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id);
}

/** Полезная нагрузка createTask для kie.ai. */
export function buildCreateTask(
  model: ImageModel,
  req: ImageRequest,
  callBackUrl?: string,
): Record<string, unknown> {
  return {
    model: model.kieModel,
    ...(callBackUrl ? { callBackUrl } : {}),
    input: model.buildInput(req),
  };
}
