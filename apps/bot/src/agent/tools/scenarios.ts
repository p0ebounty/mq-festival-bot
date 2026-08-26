import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import {
  buildProfessionPrompt, buildWorldPrompt, DEFAULT_ASPECT, type AgentTool,
} from '@mq/core';
import { professions, baseWorlds } from '@mq/db/schema';
import type { AppContext } from '../../context.js';
import { submitGeneration } from './submit.js';

// ─────────────────────── каталог профессий ───────────────────────

export function makeListProfessionsTool(app: AppContext): AgentTool<Record<string, never>> {
  return {
    name: 'list_professions',
    description:
      'Получить список профессий, в которых можно себя увидеть. Вызывай, когда участник ' +
      'спрашивает «а кем можно?», «какие есть варианты», или когда он хочет фото в профессии, ' +
      'но не назвал какую. НЕ вызывай, если профессия уже названа — просто бери её.',
    input: z.object({}),
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const rows = await app.db.select().from(professions)
        .where(eq(professions.isActive, true)).orderBy(professions.sortOrder);
      return {
        ok: true,
        summary:
          `Доступны профессии: ${rows.map((r) => r.title).join(', ')}. ` +
          'Назови участнику несколько ярких живой фразой, а не списком в 12 строк, ' +
          'и скажи, что можно попросить вообще любую другую.',
        data: { professions: rows.map((r) => ({ slug: r.slug, title: r.title, about: r.description })) },
      };
    },
  };
}

// ─────────────────── сценарий 1 ТЗ: фото → профессия ───────────────────

const restyleInput = z.object({
  profession: z.string().min(2).max(64),
  extra_idea: z.string().max(600).optional(),
});

export function makeRestylePhotoTool(app: AppContext): AgentTool<z.infer<typeof restyleInput>> {
  return {
    name: 'restyle_photo',
    description:
      'Показать участника в выбранной профессии, сохранив его лицо. ' +
      'Вызывай ТОЛЬКО когда участник прислал своё фото в этом диалоге и хочет увидеть себя ' +
      'кем-то: космонавтом, врачом, инженером и так далее. ' +
      'profession — название профессии словом, можно по-русски. ' +
      'extra_idea — дополнительные пожелания участника ПО-АНГЛИЙСКИ и дословно: сказал ' +
      '«на фоне моего города» — так и передай, не заменяй общим описанием. ' +
      'Если фото не присылали — не вызывай, а попроси прислать селфи.',
    input: restyleInput,
    parameters: {
      type: 'object',
      properties: {
        profession: { type: 'string', description: 'Название профессии, например «космонавт».' },
        extra_idea: {
          type: 'string',
          description: 'Дополнительные пожелания участника на английском, дословно. Пусто, если их не было.',
        },
      },
      required: ['profession'],
      additionalProperties: false,
    },

    async run(args, ctx) {
      const photo = ctx.lastImageUrl;
      if (!photo) {
        return {
          ok: false,
          summary: 'Фото участника в этом диалоге нет. Попроси прислать селфи — без него профессию не сделать.',
          error: 'no_photo',
        };
      }

      // Ищем в каталоге, но незнакомую профессию НЕ отвергаем: участник может
      // попросить что угодно, и это как раз в духе «профессий будущего».
      const needle = args.profession.trim().toLowerCase();
      const [known] = await app.db.select().from(professions)
        .where(and(
          eq(professions.isActive, true),
          sql`lower(${professions.title}) = ${needle} or lower(${professions.slug}) = ${needle}`,
        )).limit(1);

      const fragment = known?.promptFragment
        ?? `Dress them appropriately as a ${args.profession.trim()} and place them in a workplace fitting that profession.`;

      return submitGeneration(app, ctx, {
        task: 'restyle_photo',
        kind: 'profession',
        userPrompt: ctx.userMessage,
        finalPrompt: buildProfessionPrompt({ professionFragment: fragment, idea: args.extra_idea ?? '' }),
        aspectRatio: DEFAULT_ASPECT.profession,
        images: [photo],
        successHint: `Делаю участника в образе «${known?.title ?? args.profession}».`,
      });
    },
  };
}

// ─────────────────── сценарий 2 ТЗ: миры ───────────────────

export function makeGetBaseWorldTool(app: AppContext): AgentTool<Record<string, never>> {
  return {
    name: 'get_base_world',
    description:
      'Выдать участнику «базовый мир» — готовую картинку, которую он потом изменит одной фразой. ' +
      'Вызывай, когда участник хочет поиграть в превращение миров, просит «дай мир», ' +
      'или хочет что-то изменить, но мира у него ещё нет. ' +
      'Инструмент сам отправит картинку участнику — тебе надо только объяснить правила игры.',
    input: z.object({}),
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(_input, ctx) {
      const [world] = await app.db.select().from(baseWorlds)
        .where(eq(baseWorlds.isActive, true))
        // Реже выданные вперёд, дальше случайно: у соседей по стенду
        // должны быть разные миры, иначе турнир скучный.
        .orderBy(baseWorlds.timesIssued, sql`random()`)
        .limit(1);

      if (!world) {
        return {
          ok: false,
          summary: 'Пул базовых миров пуст — администратор их ещё не залил. Предложи обычную генерацию картинки.',
          error: 'no_worlds',
        };
      }

      await app.db.update(baseWorlds)
        .set({ timesIssued: sql`${baseWorlds.timesIssued} + 1` })
        .where(eq(baseWorlds.id, world.id));
      await app.worlds.setCurrent(ctx.userId, world.mediaId);

      const sent = await app.sendMedia?.(ctx.chatId, world.mediaId, `Твой мир: ${world.title}`);
      if (!sent) {
        return { ok: false, summary: 'Картинку мира отправить не вышло. Попробуй ещё раз.', error: 'send_failed' };
      }
      ctx.log.info({ worldId: world.id, title: world.title }, 'выдан базовый мир');

      return {
        ok: true,
        summary:
          `Выдал участнику мир «${world.title}» — картинка уже ушла отдельным сообщением. ` +
          'Объясни правила: этот мир можно изменить ОДНОЙ фразой — погоду, стиль, ' +
          'архитектуру, жителей. Дай одну-две идеи для затравки, не перечисляй всё подряд.',
        data: { world_title: world.title },
      };
    },
  };
}

const transformInput = z.object({ change: z.string().min(3).max(600) });

export function makeTransformWorldTool(app: AppContext): AgentTool<z.infer<typeof transformInput>> {
  return {
    name: 'transform_world',
    description:
      'Изменить мир участника одной фразой — погоду, стиль, архитектуру, жителей. ' +
      'Вызывай, когда у участника уже есть мир и он просит его изменить. ' +
      'change — что именно поменять, ПО-АНГЛИЙСКИ и дословно по мысли участника. ' +
      'Сказал «шторм и чтобы рыцари стали роботами» — передай оба изменения. ' +
      'Ничего не добавляй от себя: меняется ровно то, что попросили. ' +
      'Если мира ещё нет — сначала вызови get_base_world.',
    input: transformInput,
    parameters: {
      type: 'object',
      properties: {
        change: {
          type: 'string',
          description:
            'Что изменить, на английском, дословно по мысли участника. Например: ' +
            '"change the weather to a violent storm and replace the knights with robots".',
        },
      },
      required: ['change'],
      additionalProperties: false,
    },

    async run(args, ctx) {
      const mediaId = await app.worlds.getCurrent(ctx.userId);
      if (!mediaId) {
        return {
          ok: false,
          summary: 'У участника ещё нет мира. Вызови get_base_world — он выдаст стартовый.',
          error: 'no_world',
        };
      }

      // Мир лежит у нас на диске; модели нужен URL, поэтому заливаем в kie.ai
      // прямо сейчас. Их ссылки живут 14 дней, кэшировать смысла нет.
      const url = await app.uploadStoredMedia?.(mediaId);
      if (!url) {
        return { ok: false, summary: 'Картинка мира не загрузилась. Попробуй ещё раз.', error: 'upload_failed' };
      }

      return submitGeneration(app, ctx, {
        task: 'transform_world',
        kind: 'world',
        userPrompt: ctx.userMessage,
        finalPrompt: buildWorldPrompt({ change: args.change }),
        aspectRatio: DEFAULT_ASPECT.world,
        images: [url],
        inputMediaIds: [mediaId],
        successHint: 'Перестраиваю мир по просьбе участника.',
      });
    },
  };
}
