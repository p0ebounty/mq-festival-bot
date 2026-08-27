import { z } from 'zod';
import {
  checkLink, hasAnyHashtag, looksSame, perceptualHash, urlKey,
  type AgentTool, type ToolResult,
} from '@mq/core';
import type { ClaimEvidence } from '@mq/db';
import type { AppContext } from '../../context.js';
import { downloadImage, fetchOpenGraph, fetchPublicPage } from '../../social/page-fetch.js';
import { askVerifier } from '../../social/verifier.js';

const input = z.object({
  url: z.string().min(8).max(500),
});

interface Checks extends Record<string, unknown> {
  domain: boolean;
  publicPage: boolean;
  imageMatch: boolean;
  hashtags: boolean;
  platform?: string | undefined;
}

/**
 * Бонус за публикацию в соцсети (ADR 0007).
 *
 * Проверяем **ссылку**, а не скриншот. Скриншот не доказывает ничего: его
 * можно нарисовать, снять чужой пост или снять черновик. Ссылка доказывает:
 * если страница открывается БЕЗ логина и на ней лежит наша картинка, значит
 * публикация есть и она публичная.
 *
 * Каскад идёт от дешёвого и точного к дорогому и приблизительному и
 * обрывается, как только доказательство получено. Ручной модерации нет —
 * бот автономен, поэтому каждая ветка обязана решить сама.
 */
export function makeVerifySocialTool(app: AppContext): AgentTool<z.infer<typeof input>> {
  return {
    name: 'verify_social_post',
    description:
      'Проверить публикацию участника в соцсети и начислить бонусные токены. ' +
      'Вызывай, когда участник присылает ССЫЛКУ на свой пост с нашей картинкой ' +
      'или говорит, что выложил её. ' +
      'url — ссылка на саму публикацию, а не на профиль или канал. ' +
      'Подходят Telegram, VK, Одноклассники, X, Instagram. ' +
      'НЕ вызывай, если ссылки нет: попроси её. Скриншот не подходит — объясни, ' +
      'что нужна именно ссылка, по ней видно, что пост действительно опубликован. ' +
      'Инструмент сам всё проверит и сам начислит: спрашивать разрешения не надо.',
    input,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Ссылка на публикацию участника.' },
      },
      required: ['url'],
      additionalProperties: false,
    },

    async run(args, ctx) {
      const bonus = await app.settings.getInt('economy.socialBonus');
      const weakLimit = await app.settings.getInt('economy.weakProofLimit');
      const hashtags = await app.settings.get('share.hashtags');

      const checks: Checks = { domain: false, publicPage: false, imageMatch: false, hashtags: false };

      // ── шаг 1: разбор ссылки. Без единого запроса в сеть ──
      const link = checkLink(args.url);
      if (!link.ok || !link.url) {
        return reject(app, ctx, checks, link.reason ?? 'ссылка не подошла', {
          ...(link.platform ? { platform: link.platform } : {}),
        });
      }
      checks.domain = true;
      checks.platform = link.platform;

      const key = urlKey(link.url);
      const already = await app.social.claimByUrlKey(key);
      if (already) {
        return {
          ok: false,
          summary: 'Эта публикация уже приносила бонус.',
          note: 'Скажи, что за один пост бонус даётся один раз, и предложи выложить другую картинку.',
          error: 'already_claimed',
        };
      }

      // Последняя удачная генерация участника — с ней и сверяем картинку.
      const mine = await app.generations.lastSuccessfulForUser(ctx.userId);
      if (!mine?.mediaId) {
        return {
          ok: false,
          summary: 'У участника ещё нет готовых картинок, публиковать нечего.',
          note: 'Предложи сначала что-нибудь сделать.',
          error: 'nothing_to_share',
        };
      }
      const ourPhash = await ourHash(app, mine.mediaId);

      // ── шаг 2: открываем страницу как случайный прохожий, без cookies ──
      let page = link.openable
        ? await fetchPublicPage(link.url)
        : { public: false, text: '', imageUrls: [] as string[] };

      // og-разметку берём НЕ только когда страница не открылась.
      //
      // Живая проверка на t.me показала, что рендер отдаёт картинку через
      // раз (ленивая загрузка), а текст поста обрезан карточкой канала.
      // og при этом стабилен: площадки отдают его намеренно, чтобы ссылка
      // красиво разворачивалась в мессенджерах. Поэтому источники
      // СКЛАДЫВАЕМ: публичность подтверждает браузер, а картинку и полный
      // текст чаще даёт превью.
      if (!page.public || page.imageUrls.length === 0) {
        const og = await fetchOpenGraph(link.url);
        if (og.public) {
          page = page.public
            ? {
                ...page,                 // скриншот из браузера не теряем
                public: true,
                text: `${page.text}\n${og.text}`,
                imageUrls: [...new Set([...page.imageUrls, ...og.imageUrls])],
              }
            : { ...og, public: true };
        }
      }
      checks.publicPage = page.public;
      checks.hashtags = page.text ? hasAnyHashtag(page.text, hashtags) : false;

      // ── шаг 3: сверка перцептивного хеша — сильное доказательство ──
      if (page.public && ourPhash) {
        for (const imgUrl of page.imageUrls.slice(0, 6)) {
          const buf = await downloadImage(imgUrl);
          if (!buf) continue;
          const theirs = await perceptualHash(buf).catch(() => null);
          if (theirs && looksSame(ourPhash, theirs)) {
            checks.imageMatch = true;
            break;
          }
        }
      }

      if (checks.imageMatch) {
        return approve(app, ctx, {
          checks, evidence: 'phash', bonus, url: link.url, key,
          generationId: mine.id,
          reason: 'Пост открылся без входа, картинка на странице совпала с нашей.',
        });
      }

      // ── шаг 4: решает отдельный проверяющий агент ──
      //
      // Здесь раньше стояла эвристика «страница открылась и хештеги на
      // месте — начисляем». Её было слишком легко обойти: выложить любой
      // кадр с нашими хештегами. Теперь смотрит узкий агент без
      // инструментов: ему дают нашу картинку, картинки с публикации и текст
      // страницы, и он отвечает только «опубликовано / та же картинка».
      // Начисляет по-прежнему код — по правилам ADR 0007.
      const evidence: ClaimEvidence = page.public ? 'vision+page' : 'vision+screenshot';
      const used = await app.social.weakApprovalCount(ctx.userId);
      const fail = (why: string) => reject(app, ctx, checks, why,
        { platform: link.platform, url: link.url, key, generationId: mine.id, evidence });

      // Лимит проверяем ДО вызова модели: нет смысла тратить запрос,
      // если начислить всё равно нельзя.
      if (used >= weakLimit) {
        return fail(weakLimit === 0
          ? 'нашей картинки на публикации не нашлось'
          : 'нашей картинки на публикации не нашлось, а бонус без точного совпадения уже выдавался');
      }

      const ourUrl = await app.uploadStoredMedia?.(mine.mediaId);
      if (!ourUrl) return fail('не удалось сверить публикацию с твоей картинкой');

      // Скриншот идёт в дело, только если картинок со страницы нет: он
      // тяжелее и хуже читается, чем сама картинка поста.
      const postImages = [...page.imageUrls];
      if (postImages.length === 0 && page.screenshot) {
        const up = await app.kie.uploadBase64({
          base64: `data:image/jpeg;base64,${page.screenshot.toString('base64')}`,
          fileName: `claim-${key.slice(0, 10)}.jpg`,
        }).catch(() => null);
        if (up) postImages.push(up.downloadUrl);
      }

      let verdict;
      try {
        verdict = await askVerifier(await app.chatProvider(), {
          ourImageUrl: ourUrl,
          postImageUrls: postImages,
          pageText: page.text,
          hashtags,
          pageWasPublic: page.public,
        });
      } catch (err) {
        ctx.log.warn({ err: String(err).slice(0, 140) }, 'проверяющий не ответил');
        return fail('проверка не отработала, попробуй прислать ссылку ещё раз');
      }
      ctx.log.info({ userId: ctx.userId, ...verdict }, 'вердикт проверяющего');

      if (!verdict.published) return fail(verdict.reason);
      if (!verdict.sameImage) {
        return fail('на публикации не нашлось картинки, которую мы для тебя сделали');
      }
      if (verdict.confidence === 'low' && !page.public) {
        // Слабый вердикт по недоступной странице — это уже совсем ничего.
        return fail('по этой ссылке не видно ни поста, ни картинки');
      }

      return approve(app, ctx, {
        checks, evidence, bonus, url: link.url, key, generationId: mine.id,
        reason: `Публикация подтверждена: ${verdict.reason}`,
      });
    },
  };
}

interface ApproveInput {
  checks: Checks;
  evidence: ClaimEvidence;
  bonus: number;
  url: string;
  key: string;
  generationId: string;
  reason: string;
}

async function approve(
  app: AppContext,
  ctx: { userId: string; log: { info: (o: unknown, m?: string) => void } },
  a: ApproveInput,
): Promise<ToolResult> {
  const claim = await app.social.record({
    userId: ctx.userId,
    generationId: a.generationId,
    postUrl: a.url,
    urlKey: a.key,
    status: 'approved',
    evidence: a.evidence,
    checks: a.checks,
    tokensAwarded: a.bonus,
    verdictReason: a.reason,
  });
  const balance = await app.tokens.grant(ctx.userId, a.bonus, {
    reason: 'social_bonus', socialClaimId: claim.id,
  });
  ctx.log.info({ userId: ctx.userId, evidence: a.evidence, bonus: a.bonus }, 'начислен бонус за репост');

  return {
    ok: true,
    summary: `${a.reason} Начислено ${a.bonus} токен(ов), баланс ${balance}.`,
    note: 'Поблагодари коротко и по-человечески, без канцелярита. Про доказательства и проверки не рассказывай.',
    data: { verdict: 'approved', evidence: a.evidence, tokensAwarded: a.bonus, balance, checks: a.checks },
  };
}

async function reject(
  app: AppContext,
  ctx: { userId: string },
  checks: Checks,
  why: string,
  extra: {
    platform?: string | undefined; url?: string | undefined; key?: string | undefined;
    generationId?: string | undefined; evidence?: ClaimEvidence | undefined;
  } = {},
): Promise<ToolResult> {
  // Отказы пишем тоже: по ним видно, обо что спотыкаются участники, и это
  // единственный способ понять, не слишком ли строг каскад.
  await app.social.record({
    userId: ctx.userId,
    status: 'rejected',
    evidence: extra.evidence ?? 'none',
    checks: { ...checks, ...(extra.platform ? { platform: extra.platform } : {}) },
    tokensAwarded: 0,
    verdictReason: why,
    ...(extra.generationId ? { generationId: extra.generationId } : {}),
    ...(extra.url ? { postUrl: extra.url } : {}),
    // Ключ НЕ пишем при отказе: иначе участник, поправив пост, не сможет
    // подать ту же ссылку заново — уникальный индекс её уже занял.
  }).catch(() => {});

  return {
    ok: false,
    summary: `Бонус не начислен: ${why}.`,
    note:
      'Объясни причину своими словами и подскажи, что сделать: прислать ссылку именно на пост, ' +
      'открытый для всех, с нашей картинкой и хештегами. Не извиняйся трижды.',
    error: 'not_verified',
    data: { verdict: 'rejected', checks },
  };
}

/** pHash нашей генерации. Считаем на лету, если при сохранении не посчитали. */
async function ourHash(app: AppContext, mediaId: string): Promise<string | null> {
  const row = await app.media.byId(mediaId);
  if (!row) return null;
  if (row.phash) return row.phash;
  try {
    const buf = await app.storage.read(row.path);
    const hash = await perceptualHash(buf);
    await app.media.rememberPhash(mediaId, hash);
    return hash;
  } catch {
    return null;
  }
}
