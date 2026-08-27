import postgres from 'postgres';
import { getCurrentAdmin } from '@/lib/auth';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
// Поток живёт минутами — сериализовать его в статику нечего.
export const runtime = 'nodejs';

/**
 * Живое обновление админки через SSE.
 *
 * Админка и бот — разные процессы, общая у них только база. Поэтому
 * источник событий — сама база: триггеры (миграция 0011) шлют
 * `pg_notify('mq_changed', <таблица>)` при любой записи, а этот маршрут
 * держит `LISTEN` и пересылает событие в браузер.
 *
 * Опроса по таймеру нет намеренно: он либо тормозит, либо долбит БД, а
 * тут задержка получается в миллисекунды и при полном простое трафика нет.
 *
 * Соединение своё, а НЕ из общего пула: `LISTEN` занимает его целиком,
 * и вытащить его из пула значит однажды оставить приложение без коннекта.
 */
export async function GET(req: Request) {
  if (!(await getCurrentAdmin())) {
    return new Response('unauthorized', { status: 401 });
  }

  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          closed = true;
        }
      };

      const shutdown = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        void sql.end({ timeout: 1 }).catch(() => {});
        try { controller.close(); } catch { /* уже закрыт */ }
      };

      // Прокси и балансировщики рвут молчащее соединение. Комментарий SSE
      // (строка с двоеточия) держит его живым и клиентом игнорируется.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { shutdown(); }
      }, 25_000);

      req.signal.addEventListener('abort', shutdown);

      try {
        await sql.listen('mq_changed', (payload) => send('changed', payload || 'unknown'));
        send('ready', 'ok');
      } catch {
        send('error', 'listen failed');
        shutdown();
      }
    },
    cancel() {
      void sql.end({ timeout: 1 }).catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx и подобные буферизуют поток и ломают SSE — просим не буферизовать.
      'X-Accel-Buffering': 'no',
    },
  });
}
