import type { FastifyBaseLogger } from 'fastify';
import {
  runAgent, buildSystemPrompt, DEFAULT_SYSTEM_PROMPT, ChatProviderError,
  type AgentMessage,
} from '@mq/core';
import type { AppContext } from '../context.js';
import { collectDialogImages, imageContextMessages } from './images.js';
import { capReply, DRAWING_TOOLS } from './reply-limit.js';
import { generationPlaced, progressReply } from './progress-text.js';
import { moderate } from '../moderation/index.js';

export interface IncomingMessage {
  tgId: bigint;
  chatId: bigint;
  tgMessageId: bigint;
  text: string;
  /** Публичные URL фото участника (уже загруженных в kie.ai). */
  imageUrls?: string[];
  /**
   * Наши копии этих фото. Ссылки провайдера умирают раньше обещанного
   * (31.08 — на четвёртый день вместо четырнадцати), и без своей копии
   * обновить их нечем: диалог начинает отвечать HTTP 400 на любое слово.
   */
  imageMediaIds?: string[];
  from: { username?: string | undefined; firstName?: string | undefined; lastName?: string | undefined; languageCode?: string | undefined };
}

export interface AgentReply {
  text: string;
  userId: string;
  conversationId: string;
  /** Кнопки-подсказки, если агент их предложил. */
  suggestions?: string[];
  /** Была ли отправлена карточка «Рисую…»: тогда текст идёт новым сообщением. */
  cardSent?: boolean;
}

/**
 * Полный оборот: участник → контекст → цикл агента → запись в БД → ответ.
 *
 * Всё, что здесь пишется в БД, потом видно в админке: и сообщения, и вызовы
 * инструментов с аргументами и результатом. Это главный инструмент отладки
 * поведения агента, поэтому пишем ДО отправки ответа, а не после.
 */
export async function handleIncoming(
  app: AppContext,
  msg: IncomingMessage,
  log: FastifyBaseLogger,
): Promise<AgentReply> {
  const startBalance = await app.settings.getInt('economy.startBalance');
  const user = await app.users.ensure({
    tgId: msg.tgId,
    username: msg.from.username ?? null,
    firstName: msg.from.firstName ?? null,
    lastName: msg.from.lastName ?? null,
    languageCode: msg.from.languageCode ?? null,
  }, startBalance);

  if (user.isBanned) {
    return { text: 'Доступ закрыт.', userId: user.id, conversationId: '' };
  }

  // Присланное фото проверяется ДО того, как попадёт в разговор и в
  // хранилище: иначе оно успеет уйти модели вместе с историей и осесть в
  // галерее админки. Текстовые запросы проверяются позже, у самой
  // генерации, — там виден готовый промпт (ADR 0014).
  if (msg.imageUrls?.length) {
    const verdict = await moderate(app, {
      userId: user.id,
      stage: 'photo',
      text: msg.text,
      imageUrls: msg.imageUrls,
      log,
    });
    if (!verdict.allowed) {
      log.info({ userId: user.id, category: verdict.category, source: verdict.source },
        'фото отклонено проверкой');
      // Сбой проверки — НЕ «плохое фото». Прежний общий текст винил снимок
      // и советовал прислать другой, хотя тот же самый проходит через
      // минуту: 03.09 участник получил «такое фото я не возьму», когда у
      // kie.ai моргнуло зрение. Совет обязан вести к успеху.
      return {
        text: verdict.source === 'unavailable'
          ? 'Проверка фото сейчас не отвечает — это у меня, а не у тебя. '
            + 'Пришли то же самое ещё раз через минуту, и поедем дальше.'
          : `Такое фото я не возьму: ${verdict.reason}. Пришли другое — и сделаем.`,
        userId: user.id,
        conversationId: '',
      };
    }
  }

  const historyLimit = await app.settings.getInt('agent.historyMessages');
  const maxIterations = await app.settings.getInt('agent.maxToolIterations');
  const costPerImage = await app.settings.getInt('economy.costPerImage');

  // Диалог «остывает» за 30 минут — вчерашний контекст не всплывает сегодня.
  const conversation = await app.conversations.current(user.id, msg.chatId, 30);

  const history = await app.conversations.history(conversation.id, historyLimit);

  const priorMessages: AgentMessage[] = history
    .filter((m) => m.role !== 'system' && (m.text ?? '').length > 0)
    .map((m): AgentMessage => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: m.text ?? '',
    }));

  // Картинку к самому сообщению НЕ цепляем: она придёт ниже, в реестре, и
  // уже со своим id. Иначе модель увидела бы её дважды и без опознавателя.
  const userMessage: AgentMessage = { role: 'user', text: msg.text };

  await app.conversations.addMessage({
    conversationId: conversation.id,
    role: 'user',
    text: msg.text,
    tgMessageId: msg.tgMessageId,
    ...(msg.imageUrls?.length
      ? { contentJson: { imageUrls: msg.imageUrls, ...(msg.imageMediaIds?.length ? { imageMediaIds: msg.imageMediaIds } : {}) } }
      : {}),
  });

  // Реестр строим ПОСЛЕ записи сообщения: тогда только что присланное фото
  // тоже получает id и попадает в список (ADR 0010).
  const images = await collectDialogImages(app, {
    conversationId: conversation.id,
    userId: user.id,
    conversationStartedAt: conversation.startedAt,
  });
  const imagesInContext = await app.settings.getInt('agent.imagesInContext');
  const imageMessages: AgentMessage[] = imageContextMessages(images, new Date(), imagesInContext)
    .map((m): AgentMessage => ({
      role: 'user',
      text: m.text,
      ...(m.imageUrls ? { imageUrls: m.imageUrls } : {}),
    }));

  // Промпт живёт ТОЛЬКО в коде: это характер бота, а не крутилка. Правка
  // из админки была убрана по решению владельца — менять его вслепую на
  // живом фестивале опаснее, чем выкатить изменение.
  const system = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, {
    firstName: user.firstName,
    tokenBalance: user.tokenBalance,
    costPerImage,
    imageCount: images.length,
    hasWorld: images.some((i) => i.isWorld || Boolean(i.taskId)),
    hasUserPhoto: images.some((i) => i.origin === 'user'),
  });

  // Агент может предложить кнопки через suggest_replies — собираем сюда.
  let suggestions: string[] = [];
  let cardSent = false;

  let result;
  try {
    result = await runAgent({
      provider: await app.chatProvider(),
      registry: app.registry,
      system,
      messages: [...priorMessages, ...imageMessages, userMessage],
      maxIterations,
      toolContext: {
        userId: user.id,
        conversationId: conversation.id,
        chatId: msg.chatId,
        userMessage: msg.text,
        images,
        suggest: (options) => { suggestions = options; },
        notePlaceholderSent: () => { cardSent = true; },
        log: { info: (o, m) => log.info(o as object, m), warn: (o, m) => log.warn(o as object, m) },
      },
    });
  } catch (err) {
    const known = err instanceof ChatProviderError;
    log.error({ err: String(err), userId: user.id }, 'агент не смог ответить');
    const text = known ? err.userMessage : 'Что-то пошло не так. Попробуй ещё раз через минутку.';
    await app.conversations.addMessage({ conversationId: conversation.id, role: 'assistant', text });
    await app.conversations.touch(conversation.id);
    return { text, userId: user.id, conversationId: conversation.id };
  }

  // Ограничитель длины — последний заслон перед отправкой (см. reply-limit.ts).
  // Инструменты к этому моменту УЖЕ отработали: режется текст, а не ход.
  // Откатывать выданную картинку или списанный токен он не может и не должен.
  const drew = result.toolCalls.some((t) => DRAWING_TOOLS.has(t.name) && t.result.ok);
  // Поставлена генерация — текст пишет код: «рисую», а не «добавил».
  // Модель отчитывается о результате, которого ещё нет (см. progress-text.ts).
  // Именно по результату инструмента, а не по cardSent: тот признак ставит и
  // выдача задания, и на ней «рисую» было ложью в другую сторону.
  const progress = progressReply(result.text, generationPlaced(result.toolCalls));
  const capped = capReply(progress.text, { drawing: drew });

  if (capped.cut) {
    // Подсказки того же хода выбрасываем: они были про то, что мы только что
    // отрезали. Живой случай — кнопка «Сделай для GitHub Pages» под vite-проектом.
    suggestions = [];
    log.warn({
      userId: user.id,
      reason: capped.cut.reason,
      chars: capped.cut.chars,
      tools: result.toolCalls.map((t) => t.name),
    }, 'ответ агента обрезан ограничителем');
  }

  // Записываем ответ ассистента и все вызовы инструментов под ним.
  //
  // В text — то, что человек РЕАЛЬНО увидел, иначе админка врёт про диалог.
  // Оригинал уходит в content_json: раздел «Диалоги» это главный инструмент
  // отладки агента, и без оригинала никто не узнает, что модель пыталась
  // сделать. В историю следующего хода уйдёт именно text — модель должна
  // прочитать свой отказ, а не продолжить с места обрыва.
  const assistantRow = await app.conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    text: capped.text,
    contentJson: {
      iterations: result.iterations,
      hitLimit: result.hitLimit,
      ...(capped.cut ? { cut: capped.cut } : {}),
      // Оригинал модели — для админки: видно, что она собиралась сказать.
      ...(progress.overridden ? { progressOverride: result.text } : {}),
    },
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });

  for (const t of result.toolCalls) {
    await app.conversations.addToolCall({
      messageId: assistantRow.id,
      toolName: t.name,
      toolUseId: t.id,
      input: t.input,
      output: { ok: t.result.ok, summary: t.result.summary, ...(t.result.data ?? {}) },
      ok: t.result.ok,
      errorMessage: t.result.error ?? null,
      durationMs: t.durationMs,
    });
  }

  await app.conversations.touch(conversation.id);

  if (result.hitLimit) {
    log.warn({ userId: user.id, iterations: result.iterations }, 'агент упёрся в лимит итераций');
  }

  return {
    text: capped.text,
    userId: user.id,
    conversationId: conversation.id,
    ...(cardSent ? { cardSent } : {}),
    ...(suggestions.length ? { suggestions } : {}),
  };
}
