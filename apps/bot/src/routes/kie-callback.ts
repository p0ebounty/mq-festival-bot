import type { FastifyInstance } from 'fastify';
import { callbackTaskId, ingestRemote, parseTaskRecord, verifyWebhook, type CallbackBody } from '@mq/core';
import type { AppContext } from '../context.js';

/**
 * Приём callback от kie.ai о завершении генерации.
 *
 * Эндпоинт публичный, поэтому порядок проверок такой:
 *   1) подпись HMAC (если ключ задан) — отсекает подделки;
 *   2) taskId должен быть известен нашей БД — отсекает чужие задачи;
 *   3) переход статуса идемпотентен — повторный callback безвреден.
 *
 * Отвечаем 200 всегда, когда запрос легитимен: kie.ai при не-200 будет
 * слать повторы, а нам это не нужно — потерянные задачи добирает воркер.
 */
export function registerKieCallback(app: FastifyInstance, ctx: AppContext): void {
  app.post('/hooks/kie', async (req, reply) => {
    const body = req.body as CallbackBody | null;
    const taskId = callbackTaskId(body);

    const hmacKey = await ctx.settings.get('kie.webhookHmacKey');
    if (hmacKey) {
      const v = verifyWebhook({
        taskId,
        signature: req.headers['x-webhook-signature'] as string | undefined,
        timestamp: req.headers['x-webhook-timestamp'] as string | undefined,
        secret: hmacKey,
      });
      if (!v.ok) {
        req.log.warn({ reason: v.reason, taskId }, 'kie callback: подпись не прошла');
        return reply.code(401).send({ ok: false });
      }
    } else {
      req.log.warn('kie callback: HMAC-ключ не задан, подпись не проверяется');
    }

    if (!taskId) return reply.code(400).send({ ok: false, error: 'no task_id' });

    const gen = await ctx.generations.byTaskId(taskId);
    if (!gen) {
      // Не наша задача либо запись ещё не успела закоммититься.
      req.log.warn({ taskId }, 'kie callback: задача неизвестна');
      return reply.code(404).send({ ok: false });
    }

    // Повторный callback по уже закрытой задаче — штатная ситуация (ретрай
    // kie.ai). Выходим ДО любой работы: иначе картинка качается повторно,
    // а при ошибке скачивания мы вернём 500 и спровоцируем новые ретраи.
    if (gen.status === 'success' || gen.status === 'failed') {
      req.log.info({ taskId, status: gen.status }, 'kie callback: задача уже закрыта, пропускаем');
      return reply.send({ ok: true, duplicate: true });
    }

    const rec = parseTaskRecord({ ...(body?.data ?? {}), taskId });
    try {
      await applyTaskResult(ctx, gen.id, rec, req.log, gen);
    } catch (err) {
      // Не отдаём 500: на ошибку kie.ai начнёт слать повторы, а у нас и так
      // есть воркер-добор, который подхватит задачу опросом. Логируем громко.
      req.log.error({ taskId, generationId: gen.id, err: String(err) },
        'kie callback: не удалось применить результат, оставляем воркеру');
      return reply.send({ ok: true, deferred: true });
    }
    return reply.send({ ok: true });
  });
}

type Logger = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

/**
 * Общая точка применения результата — используется и callback'ом, и воркером,
 * чтобы логика завершения жила в одном месте.
 */
export async function applyTaskResult(
  ctx: AppContext,
  generationId: string,
  rec: ReturnType<typeof parseTaskRecord>,
  log: Logger,
  gen?: { createdAt?: Date },
): Promise<'success' | 'failed' | 'pending'> {
  if (rec.state === 'generating' || rec.state === 'waiting' || rec.state === 'queuing') {
    await ctx.generations.markGenerating(generationId);
    return 'pending';
  }

  if (rec.state === 'fail') {
    const changed = await ctx.generations.markFailed(generationId, rec.failCode, rec.failMessage);
    if (changed) log.warn({ generationId, fail: rec.failMessage }, 'генерация не удалась');
    return 'failed';
  }

  const url = rec.resultUrls[0];
  if (!url) {
    await ctx.generations.markFailed(generationId, 'no_result', 'kie.ai вернул success без ссылки');
    return 'failed';
  }

  // Забираем файл к себе СРАЗУ: у kie.ai медиа живёт 14 дней, а QR-коды
  // с фестиваля должны открываться и через месяц.
  const stored = await ingestRemote(url, ctx.storage, { subdir: 'generations' });
  const mediaRow = await ctx.media.create({
    path: stored.relPath,
    mimeType: stored.mimeType,
    bytes: stored.bytes,
    sha256: stored.sha256,
    source: 'kie',
  });

  // Длительность считаем ПО СВОИМ часам, а не по costTime от kie.ai:
  // в callback он приходит в секундах, а в recordInfo примеры показывают
  // миллисекунды. К тому же нас интересует, сколько ждал участник, —
  // это время от постановки задачи до готовности у нас, а не время модели.
  const started = gen?.createdAt instanceof Date ? gen.createdAt.getTime() : undefined;
  const durationMs = started ? Date.now() - started : undefined;

  const changed = await ctx.generations.completeSuccess(generationId, {
    outputMediaId: mediaRow.id,
    ...(rec.creditsConsumed !== undefined ? { creditsConsumed: rec.creditsConsumed } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  });

  if (changed) {
    log.info({ generationId, bytes: stored.bytes, credits: rec.creditsConsumed }, 'генерация готова');
  } else {
    // Гонка callback и воркера — нормальная ситуация, не ошибка.
    log.info({ generationId }, 'результат уже применён ранее, пропускаем');
  }
  return 'success';
}
