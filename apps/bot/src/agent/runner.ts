import type { FastifyBaseLogger } from 'fastify';
import {
  runAgent, buildSystemPrompt, DEFAULT_SYSTEM_PROMPT, ChatProviderError,
  type AgentMessage,
} from '@mq/core';
import type { AppContext } from '../context.js';
import { collectDialogImages, imageContextMessages } from './images.js';

export interface IncomingMessage {
  tgId: bigint;
  chatId: bigint;
  tgMessageId: bigint;
  text: string;
  /** Публичные URL фото участника (уже загруженных в kie.ai). */
  imageUrls?: string[];
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
    ...(msg.imageUrls?.length ? { contentJson: { imageUrls: msg.imageUrls } } : {}),
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
    hasWorld: images.some((i) => i.isWorld),
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

  // Записываем ответ ассистента и все вызовы инструментов под ним.
  const assistantRow = await app.conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    text: result.text,
    contentJson: { iterations: result.iterations, hitLimit: result.hitLimit },
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
    text: result.text,
    userId: user.id,
    conversationId: conversation.id,
    ...(cardSent ? { cardSent } : {}),
    ...(suggestions.length ? { suggestions } : {}),
  };
}
