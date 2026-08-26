import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { media } from '@mq/db/schema';
import type { AppContext } from '../context.js';

/**
 * Отдача сохранённых файлов. Обращение по UUID записи, а не по пути на диске:
 * путь наружу не светится и подобрать чужой файл перебором нельзя.
 */
export function registerMediaRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Params: { id: string } }>('/media/:id', async (req, reply) => {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(400).send({ error: 'bad id' });

    const [row] = await ctx.db.select().from(media).where(eq(media.id, id)).limit(1);
    if (!row) return reply.code(404).send({ error: 'not found' });

    let buf: Buffer;
    try {
      buf = await ctx.storage.read(row.path);
    } catch {
      req.log.error({ mediaId: id, path: row.path }, 'файл есть в БД, но не на диске');
      return reply.code(404).send({ error: 'not found' });
    }

    return reply
      .type(row.mimeType)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Content-Length', String(row.bytes))
      .send(buf);
  });
}
