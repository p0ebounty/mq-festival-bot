import type { FastifyBaseLogger } from 'fastify';
import {
  runAgent, buildSystemPrompt, DEFAULT_SYSTEM_PROMPT, ChatProviderError,
  type AgentMessage,
} from '@mq/core';
import type { AppContext } from '../context.js';

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
  /** Висела ли клавиатура до этого ответа — её придётся снимать. */
  keyboardWasShown: boolean;
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
    return { text: 'Доступ закрыт.', userId: user.id, conversationId: '', keyboardWasShown: false };
  }

  const historyLimit = await app.settings.getInt('agent.historyMessages');
  const maxIterations = await app.settings.getInt('agent.maxToolIterations');
  const costPerImage = await app.settings.getInt('economy.costPerImage');

  // Диалог «остывает» за 30 минут — вчерашний контекст не всплывает сегодня.
  const conversation = await app.conversations.current(user.id, msg.chatId, 30);

  const history = await app.conversations.history(conversation.id, historyLimit);
  // Фото могло прийти сообщением раньше, чем просьба «сделай меня космонавтом».
  const lastImageUrl = msg.imageUrls?.[0] ?? (await app.conversations.lastImageUrl(conversation.id)) ?? undefined;

  // Что участник видел последним: свежая генерация или присланное фото.
  // Если фото пришло прямо сейчас — оно и есть текущее, ничего не ищем.
  let currentImageUrl = lastImageUrl;
  if (!msg.imageUrls?.length) {
    const last = await app.generations.lastResult(user.id);
    if (last?.mediaId) {
      const url = await app.uploadStoredMedia?.(last.mediaId);
      if (url) currentImageUrl = url;
    }
  }
  const priorMessages: AgentMessage[] = history
    .filter((m) => m.role !== 'system' && (m.text ?? '').length > 0)
    .map((m): AgentMessage => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: m.text ?? '',
    }));

  const userMessage: AgentMessage = {
    role: 'user',
    text: msg.text,
    ...(msg.imageUrls?.length ? { imageUrls: msg.imageUrls } : {}),
  };

  await app.conversations.addMessage({
    conversationId: conversation.id,
    role: 'user',
    text: msg.text,
    tgMessageId: msg.tgMessageId,
    ...(msg.imageUrls?.length ? { contentJson: { imageUrls: msg.imageUrls } } : {}),
  });

  const customPrompt = await app.settings.get('agent.systemPrompt');
  const system = buildSystemPrompt(customPrompt || DEFAULT_SYSTEM_PROMPT, {
    firstName: user.firstName,
    tokenBalance: user.tokenBalance,
    costPerImage,
    hasWorld: Boolean(user.currentWorldMediaId),
    hasImage: Boolean(currentImageUrl),
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
      messages: [...priorMessages, userMessage],
      maxIterations,
      toolContext: {
        userId: user.id,
        conversationId: conversation.id,
        chatId: msg.chatId,
        userMessage: msg.text,
        lastImageUrl,
        currentImageUrl,
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
    return { text, userId: user.id, conversationId: conversation.id, keyboardWasShown: user.keyboardShown };
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

  // Флаг обновляем здесь, а не в боте: он часть состояния участника.
  if (suggestions.length !== 0 || user.keyboardShown) {
    await app.keyboard.setShown(user.id, suggestions.length > 0);
  }

  return {
    text: result.text,
    userId: user.id,
    conversationId: conversation.id,
    keyboardWasShown: user.keyboardShown,
    ...(cardSent ? { cardSent } : {}),
    ...(suggestions.length ? { suggestions } : {}),
  };
}
