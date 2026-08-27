import type { FastifyInstance, FastifyReply } from 'fastify';
import { isShortId, renderNotFoundPage, renderQrPng, renderQrSvg, renderSharePage, shareUrl } from '@mq/core';
import type { AppContext } from '../context.js';
import { env } from '../env.js';

/**
 * Публичная страница результата — цель QR-кода из ТЗ.
 *
 * Открывается БЕЗ авторизации: смысл кода в том, чтобы участник (или его
 * друг) отсканировал и сразу получил картинку. Ключом доступа служит сам
 * `shortId` — 40 бит случайности, перебором не находится, поисковикам
 * отдаём `noindex`.
 *
 * Живёт на Fastify рядом с ботом: по правилам инфраструктуры `/g/*` — его
 * маршрут, а `/` отдаёт админка на Next.js.
 */
export function registerShareRoutes(app: FastifyInstance, ctx: AppContext): void {
  type P = { Params: { shortId: string } };

  /** Общая часть: разобрать id, найти запись, прочитать файл при надобности. */
  async function lookup(shortId: string) {
    if (!isShortId(shortId)) return null;
    const row = await ctx.share.byShortId(shortId);
    return row && row.status === 'success' ? row : null;
  }

  app.get<P>('/g/:shortId', async (req, reply) => {
    const row = await lookup(req.params.shortId);
    if (!row) {
      return reply.code(404).type('text/html; charset=utf-8').send(renderNotFoundPage(ctx.botUrl));
    }

    const url = shareUrl(env.PUBLIC_URL, row.shortId);
    const [qrSvg, hashtags, bonusTokens] = await Promise.all([
      renderQrSvg(url),
      ctx.settings.get('share.hashtags'),
      ctx.settings.getInt('economy.socialBonus'),
    ]);

    // Счётчик не держит ответ: статистика не стоит лишней задержки в зале.
    void ctx.share.countVisit(row.shortId).catch(() => {});

    return reply
      .type('text/html; charset=utf-8')
      // Подпись могут поменять из админки, поэтому страницу не кэшируем;
      // тяжёлое здесь — картинка, а она кэшируется отдельно и навсегда.
      .header('Cache-Control', 'no-cache')
      .header('X-Robots-Tag', 'noindex')
      .send(renderSharePage({
        imageUrl: `${url}/i`,
        downloadUrl: `${url}/download`,
        qrSvg,
        pageUrl: url,
        botUrl: ctx.botUrl,
        caption: row.caption,
        hashtags,
        bonusTokens,
      }));
  });

  /** Картинка для показа на странице. */
  app.get<P>('/g/:shortId/i', async (req, reply) => sendFile(req.params.shortId, reply, false));

  /**
   * Скачивание. Отличается от `/i` только заголовком `Content-Disposition`:
   * без него телефон открывает картинку в браузере, а участник ждал файл
   * в галерее.
   */
  app.get<P>('/g/:shortId/download', async (req, reply) => sendFile(req.params.shortId, reply, true));

  /** QR этой же страницы картинкой — для печати и для стенда. */
  app.get<P>('/g/:shortId/qr.png', async (req, reply) => {
    const row = await lookup(req.params.shortId);
    if (!row) return reply.code(404).send({ error: 'not found' });
    const png = await renderQrPng(shareUrl(env.PUBLIC_URL, row.shortId));
    return reply.type('image/png')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(png);
  });

  async function sendFile(shortId: string, reply: FastifyReply, asAttachment: boolean) {
    const row = await lookup(shortId);
    if (!row) return reply.code(404).send({ error: 'not found' });

    let buf: Buffer;
    try {
      buf = await ctx.storage.read(row.mediaPath);
    } catch {
      app.log.error({ shortId, path: row.mediaPath }, 'файл есть в БД, но не на диске');
      return reply.code(404).send({ error: 'not found' });
    }

    const ext = row.mimeType === 'image/png' ? 'png' : 'jpg';
    return reply
      .type(row.mimeType)
      // Картинка неизменяемая — её можно кэшировать навсегда.
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Content-Length', String(buf.length))
      .header(
        'Content-Disposition',
        asAttachment ? `attachment; filename="mqbot-${shortId}.${ext}"` : 'inline',
      )
      .send(buf);
  }
}
