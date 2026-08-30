import { describe, it, expect } from 'vitest';
import { collectDialogImages, imageContextMessages, type DialogImage } from '../src/agent/images.js';
import type { AppContext } from '../src/context.js';

/**
 * Реестр картинок — то место, где бот раньше ошибался живьём: правил не тот
 * снимок. Проверяем именно порядок и нумерацию, потому что модель выбирает
 * картинку по id, и сдвиг нумерации означает правку чужой картинки.
 */

const T0 = new Date('2026-08-27T06:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

function fakeApp(parts: {
  photos?: Array<{ url: string; at: Date }>;
  gens?: Array<{
    mediaId: string; caption: string | null; userPrompt: string;
    kind?: 'image' | 'world' | 'profession'; taskId?: string | null; at: Date | null;
  }>;
  world?: { mediaId: string; at: Date | null } | null;
  task?: { taskId: string; mediaId: string; taskText: string | null; title: string; at: Date | null } | null;
  upload?: (id: string) => Promise<string | null>;
}): AppContext {
  return {
    conversations: { userImages: async () => parts.photos ?? [] },
    generations: { resultsForConversation: async () => parts.gens ?? [] },
    worlds: { getCurrent: async () => parts.world ?? null },
    tasks: { getCurrent: async () => parts.task ?? null },
    uploadStoredMedia: parts.upload ?? (async (id: string) => `https://store/${id}.jpg`),
  } as unknown as AppContext;
}

const collect = (app: AppContext) =>
  collectDialogImages(app, {
    conversationId: 'c1', userId: 'u1', conversationStartedAt: T0,
  });

describe('сборка реестра картинок', () => {
  it('нумерует по времени, а не по источнику', async () => {
    const images = await collect(fakeApp({
      photos: [{ url: 'https://p/cat.jpg', at: at(1) }, { url: 'https://p/dog.jpg', at: at(5) }],
      gens: [{ mediaId: 'm-hat', caption: 'кот в шляпе', userPrompt: 'добавь шляпу', at: at(3) }],
    }));

    expect(images.map((i) => i.id)).toEqual(['img1', 'img2', 'img3']);
    expect(images[0]!.url).toContain('cat');
    expect(images[1]!.url).toContain('m-hat');
    expect(images[2]!.url).toContain('dog');
  });

  it('различает, кто автор картинки', async () => {
    const images = await collect(fakeApp({
      photos: [{ url: 'https://p/cat.jpg', at: at(1) }],
      gens: [{ mediaId: 'm1', caption: 'кот в шляпе', userPrompt: 'x', at: at(2) }],
    }));
    expect(images[0]!.origin).toBe('user');
    expect(images[1]!.origin).toBe('bot');
  });

  it('берёт подпись агента как описание, иначе — фразу участника', async () => {
    const images = await collect(fakeApp({
      gens: [
        { mediaId: 'm1', caption: 'Твой кот в шляпе', userPrompt: 'добавь шляпу', at: at(1) },
        { mediaId: 'm2', caption: null, userPrompt: 'сделай ночь', at: at(2) },
      ],
    }));
    expect(images[0]!.label).toContain('Твой кот в шляпе');
    expect(images[1]!.label).toContain('сделай ночь');
  });

  it('стартовый мир из прошлого диалога встаёт в начало списка', async () => {
    // Мир живёт у участника, а не у диалога: он мог быть выдан вчера.
    const images = await collect(fakeApp({
      photos: [{ url: 'https://p/cat.jpg', at: at(5) }],
      world: { mediaId: 'm-castle', at: null },
    }));
    expect(images[0]!.url).toContain('m-castle');
    expect(images[1]!.url).toContain('cat');
  });

  it('картинка без доступной ссылки в реестр не идёт', async () => {
    // Иначе в списке был бы id, на который модель сослаться не может.
    const images = await collect(fakeApp({
      photos: [{ url: 'https://p/cat.jpg', at: at(1) }],
      gens: [{ mediaId: 'broken', caption: 'x', userPrompt: 'x', at: at(2) }],
      upload: async () => null,
    }));
    expect(images).toHaveLength(1);
    expect(images[0]!.id).toBe('img1');
  });

  it('одна и та же картинка не задваивается', async () => {
    const images = await collect(fakeApp({
      photos: [{ url: 'https://p/cat.jpg', at: at(1) }, { url: 'https://p/cat.jpg', at: at(2) }],
    }));
    expect(images).toHaveLength(1);
  });

  it('пустой диалог даёт пустой реестр, а не падение', async () => {
    expect(await collect(fakeApp({}))).toEqual([]);
  });

  /**
   * Мир из игры надо отличать от обычной картинки: правка мира двигает
   * `users.current_world_media_id`, правка присланного фото — нет.
   * Живой случай 27.08: участник поправил фото башни, и его город на
   * облаках молча перестал быть его миром.
   */
  describe('признак «это мир из игры»', () => {
    it('вся цепочка мира помечена, обычные правки — нет', async () => {
      const images = await collect(fakeApp({
        photos: [{ url: 'https://p/tower.jpg', at: at(1) }],
        gens: [
          { mediaId: 'm-city', caption: 'город с макаронами', userPrompt: 'x', kind: 'world', at: at(2) },
          { mediaId: 'm-day', caption: 'дневная башня', userPrompt: 'x', kind: 'image', at: at(3) },
        ],
      }));
      expect(images[0]!.isWorld).toBeUndefined();   // присланное фото
      expect(images[1]!.isWorld).toBe(true);        // мир
      expect(images[2]!.isWorld).toBeUndefined();   // правка фото
    });

    it('признак переживает схлопывание дубля', async () => {
      // Текущий мир и результат генерации — одна и та же картинка. Дубль
      // выбрасывается, но пометка обязана остаться на выжившей записи.
      const images = await collect(fakeApp({
        gens: [{ mediaId: 'm1', caption: 'мир', userPrompt: 'x', kind: 'world', at: at(2) }],
        world: { mediaId: 'm1', at: at(3) },
      }));
      expect(images).toHaveLength(1);
      expect(images[0]!.isWorld).toBe(true);
    });

    it('мир, выданный до диалога, тоже помечен', async () => {
      const images = await collect(fakeApp({ world: { mediaId: 'm-castle', at: null } }));
      expect(images[0]!.isWorld).toBe(true);
    });
  });
});

describe('картинки в контексте модели', () => {
  const make = (n: number): DialogImage[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `img${i + 1}`, origin: i % 2 ? 'bot' : 'user',
      url: `https://x/${i}.jpg`, label: `картинка ${i}`, at: at(i),
    }));

  it('каждая картинка идёт ОТДЕЛЬНЫМ сообщением со своим id', () => {
    // Если сложить несколько в одно сообщение, модель не поймёт,
    // где img2, а где img3, и начнёт путать их местами.
    const msgs = imageContextMessages(make(3), at(10), 6);
    expect(msgs).toHaveLength(3);
    for (const m of msgs) expect(m.imageUrls).toHaveLength(1);
    expect(msgs[1]!.text).toContain('[img2]');
  });

  it('прикладывает только последние N, остальные оставляет строкой', () => {
    const msgs = imageContextMessages(make(5), at(10), 2);
    expect(msgs).toHaveLength(5);
    expect(msgs.filter((m) => m.imageUrls).length).toBe(2);
    expect(msgs[0]!.imageUrls).toBeUndefined();
    expect(msgs[0]!.text).toContain('не приложена');
    expect(msgs[4]!.imageUrls).toBeDefined();
  });

  it('называет автора картинки', () => {
    const msgs = imageContextMessages(make(2), at(10), 6);
    expect(msgs[0]!.text).toContain('Прислал участник');
    expect(msgs[1]!.text).toContain('Нарисовали мы');
  });

  it('пишет давность по-человечески', () => {
    const one = make(1);
    expect(imageContextMessages(one, at(0), 6)[0]!.text).toContain('только что');
    expect(imageContextMessages(one, at(7), 6)[0]!.text).toContain('7 мин назад');
    expect(imageContextMessages(one, at(120), 6)[0]!.text).toContain('2 ч назад');
  });

  it('пустой реестр не добавляет в контекст ничего', () => {
    expect(imageContextMessages([], at(0), 6)).toEqual([]);
  });

  it('лимит 0 оставляет список, но без вложений', () => {
    // Настройка agent.imagesInContext = 0 — аварийный тормоз по расходу.
    const msgs = imageContextMessages(make(3), at(1), 0);
    expect(msgs).toHaveLength(3);
    expect(msgs.every((m) => !m.imageUrls)).toBe(true);
  });
});

describe('задания в реестре картинок', () => {
  it('выданная картинка задания попадает в реестр вместе с id задания', async () => {
    // Без этого её нечем править: реестр — единственный способ показать
    // модели, какие картинки вообще есть (ADR 0013).
    const images = await collect(fakeApp({
      task: { taskId: 't-1', mediaId: 'm-arena', taskText: 'Поставь на арену болид', title: 'колесница → болид', at: at(2) },
    }));
    expect(images).toHaveLength(1);
    expect(images[0]!.taskId).toBe('t-1');
    expect(images[0]!.label).toContain('Поставь на арену болид');
  });

  it('правка от картинки задания наследует задание', async () => {
    // Работа участника — это всегда потомок основы, и жюри должно найти
    // её по тому же заданию, что и исходник.
    const images = await collect(fakeApp({
      task: { taskId: 't-1', mediaId: 'm-arena', taskText: 'Поставь на арену болид', title: 'колесница → болид', at: at(2) },
      gens: [{ mediaId: 'm-f1', caption: 'болид на арене', userPrompt: 'замени колесницу на болид', taskId: 't-1', at: at(5) }],
    }));
    expect(images.map((i) => i.taskId)).toEqual(['t-1', 't-1']);
  });

  it('обычная картинка заданием не помечается', async () => {
    const images = await collect(fakeApp({
      photos: [{ url: 'https://p/selfie.jpg', at: at(1) }],
      gens: [{ mediaId: 'm-cosmo', caption: 'космонавт', userPrompt: 'сделай космонавтом', at: at(3) }],
    }));
    expect(images.every((i) => i.taskId === undefined)).toBe(true);
  });

  it('задание и мир не путаются между собой', async () => {
    // Мир двигает current_world участника, задание — нет. Смешать их
    // значит однажды подменить человеку его мир Колизеем.
    const images = await collect(fakeApp({
      world: { mediaId: 'm-mars', at: at(1) },
      task: { taskId: 't-1', mediaId: 'm-arena', taskText: 'Поставь на арену болид', title: 'колесница → болид', at: at(2) },
    }));
    const world = images.find((i) => i.isWorld);
    const task = images.find((i) => i.taskId);
    expect(world?.taskId).toBeUndefined();
    expect(task?.isWorld).toBeUndefined();
  });
});
