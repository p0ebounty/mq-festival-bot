import { describe, it, expect } from 'vitest';
import {
  nearestAspect, buildCreateTask, planModels, primaryModel, estimateCostUsd,
  NoSuitableModelError, IMAGE_MODELS, NANO_BANANA_2, GPT_IMAGE_2_T2I,
  SEEDREAM_5_PRO_I2I, GROK_IMAGINE_2_EDIT,
} from '../src/images/index';

describe('нормализация соотношения сторон', () => {
  it('оставляет поддерживаемое как есть', () => {
    expect(nearestAspect('16:9', NANO_BANANA_2.aspectRatios)).toBe('16:9');
  });

  it('подбирает ближайшее, если точного нет', () => {
    // у grok нет 4:5 — ближайшее по пропорции 2:3, а не 1:1
    expect(GROK_IMAGINE_2_EDIT.aspectRatios).not.toContain('4:5');
    const got = nearestAspect('4:5', GROK_IMAGINE_2_EDIT.aspectRatios);
    expect(['2:3', '1:1']).toContain(got);
  });

  it('без запроса даёт 1:1', () => {
    expect(nearestAspect(undefined, NANO_BANANA_2.aspectRatios)).toBe('1:1');
  });

  it('никогда не возвращает значение вне списка модели', () => {
    for (const m of IMAGE_MODELS) {
      for (const want of ['1:1', '21:9', '4:5', '9:16', '1:4'] as const) {
        const got = nearestAspect(want as never, m.aspectRatios);
        expect(m.aspectRatios, `${m.id} вернул ${got}`).toContain(got);
      }
    }
  });
});

describe('адаптеры под разные API', () => {
  it('nano-banana-2 кладёт картинки в image_input', () => {
    const p = buildCreateTask(NANO_BANANA_2, { prompt: 'x', images: ['u1'] });
    expect(p.model).toBe('nano-banana-2');
    expect((p.input as Record<string, unknown>).image_input).toEqual(['u1']);
  });

  it('gpt-image-2 использует input_urls, seedream и grok — image_urls', () => {
    const gpt = buildCreateTask(
      IMAGE_MODELS.find((m) => m.id === 'gpt-image-2-i2i')!, { prompt: 'x', images: ['u'] });
    expect((gpt.input as Record<string, unknown>).input_urls).toEqual(['u']);

    for (const m of [SEEDREAM_5_PRO_I2I, GROK_IMAGINE_2_EDIT]) {
      const p = buildCreateTask(m, { prompt: 'x', images: ['u'] });
      expect((p.input as Record<string, unknown>).image_urls, m.id).toEqual(['u']);
    }
  });

  it('seedream переводит качество в basic/high, а не в 1K/2K', () => {
    const input = buildCreateTask(SEEDREAM_5_PRO_I2I, { prompt: 'x', quality: 'high' })
      .input as Record<string, unknown>;
    expect(input.quality).toBe('high');
    expect(input.resolution).toBeUndefined();
  });

  it('обрезает лишние картинки до лимита модели', () => {
    const many = Array.from({ length: 20 }, (_, i) => `u${i}`);
    const input = buildCreateTask(NANO_BANANA_2, { prompt: 'x', images: many })
      .input as Record<string, unknown>;
    expect((input.image_input as string[]).length).toBe(14);
  });

  it('без картинок поле входа вообще не появляется', () => {
    const input = buildCreateTask(NANO_BANANA_2, { prompt: 'x' }).input as Record<string, unknown>;
    expect('image_input' in input).toBe(false);
  });

  it('callBackUrl добавляется только когда передан', () => {
    expect(buildCreateTask(NANO_BANANA_2, { prompt: 'x' }).callBackUrl).toBeUndefined();
    expect(buildCreateTask(NANO_BANANA_2, { prompt: 'x' }, 'https://cb').callBackUrl).toBe('https://cb');
  });
});

describe('маршрутизация', () => {
  it('для сценариев с фото выбирает nano-banana-2 основной', () => {
    expect(primaryModel('restyle_photo', { prompt: 'x', images: ['u'] }).id).toBe('nano-banana-2');
    expect(primaryModel('transform_world', { prompt: 'x', images: ['u'] }).id).toBe('nano-banana-2');
  });

  it('даёт запасные модели, а не одну', () => {
    expect(planModels('restyle_photo', { prompt: 'x', images: ['u'] }).length).toBeGreaterThanOrEqual(2);
  });

  it('при входных картинках отбрасывает text-to-image модели', () => {
    const chain = planModels('text_to_image', { prompt: 'x', images: ['u'] });
    expect(chain.every((m) => m.acceptsImages)).toBe(true);
    expect(chain.map((m) => m.id)).not.toContain(GPT_IMAGE_2_T2I.id);
  });

  it('без картинок text-to-image модель доступна', () => {
    expect(planModels('text_to_image', { prompt: 'x' }).map((m) => m.id)).toContain(GPT_IMAGE_2_T2I.id);
  });

  it('вперёд ставит модель, которая вмещает все картинки', () => {
    const imgs = Array.from({ length: 10 }, (_, i) => `u${i}`);
    // grok берёт максимум 4, поэтому не должен быть первым
    const chain = planModels('transform_world', { prompt: 'x', images: imgs });
    expect(chain[0]!.maxImages).toBeGreaterThanOrEqual(10);
  });

  it('оценка стоимости совпадает с ценой основной модели', () => {
    expect(estimateCostUsd('text_to_image', { prompt: 'x' })).toBe(NANO_BANANA_2.costUsd.standard);
  });

  it('каждая цепочка непуста и без дублей', () => {
    for (const task of ['text_to_image', 'restyle_photo', 'transform_world'] as const) {
      const ids = planModels(task, { prompt: 'x' }).map((m) => m.id);
      expect(ids.length, task).toBeGreaterThan(0);
      expect(new Set(ids).size, task).toBe(ids.length);
    }
  });

  it('NoSuitableModelError экспортируется для обработки наверху', () => {
    expect(new NoSuitableModelError('text_to_image', 'test')).toBeInstanceOf(Error);
  });
});
