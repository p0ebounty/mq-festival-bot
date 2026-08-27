import { describe, it, expect, vi } from 'vitest';
import { parseVerdict, askVerifier } from '../src/social/verifier.js';
import type { ChatProvider } from '@mq/core';

/**
 * Проверяющий — узкий агент без инструментов (ADR 0007, шаг 4).
 * Его ответ решает, начислять ли токены, поэтому разбор обязан быть
 * недоверчивым: непонятный ответ — это «нет», а не «наверное да».
 */
describe('разбор вердикта проверяющего', () => {
  it('читает обычный JSON', () => {
    expect(parseVerdict('{"published":true,"sameImage":true,"confidence":"high","reason":"пост на месте"}'))
      .toEqual({ published: true, sameImage: true, confidence: 'high', reason: 'пост на месте' });
  });

  it('переживает обёртку в markdown', () => {
    const raw = '```json\n{"published":true,"sameImage":false,"confidence":"low","reason":"другая картинка"}\n```';
    expect(parseVerdict(raw)).toMatchObject({ published: true, sameImage: false });
  });

  it('переживает болтовню вокруг JSON', () => {
    const raw = 'Вот мой ответ:\n{"published":true,"sameImage":true,"confidence":"high","reason":"ок"}\nГотово.';
    expect(parseVerdict(raw).sameImage).toBe(true);
  });

  it('мусор — это «нет», а не «наверное да»', () => {
    // Начисление необратимо: молчаливое «да» дороже молчаливого «нет».
    for (const raw of ['', 'не знаю', '{битый', '{"published":']) {
      expect(parseVerdict(raw)).toMatchObject({ published: false, sameImage: false, confidence: 'low' });
    }
  });

  it('только строгое true считается подтверждением', () => {
    // Модель любит отвечать "yes" и 1 — это не подтверждение.
    const v = parseVerdict('{"published":"yes","sameImage":1,"confidence":"высокая","reason":""}');
    expect(v.published).toBe(false);
    expect(v.sameImage).toBe(false);
    expect(v.confidence).toBe('low');
    expect(v.reason).toBe('без пояснения');
  });

  it('длинное пояснение обрезается — оно идёт в чат', () => {
    const v = parseVerdict(`{"published":true,"sameImage":true,"confidence":"high","reason":"${'а'.repeat(500)}"}`);
    expect(v.reason.length).toBeLessThanOrEqual(200);
  });
});

describe('запрос к проверяющему', () => {
  function provider(answer: string) {
    const complete = vi.fn().mockResolvedValue({
      text: answer, toolCalls: [], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
    });
    return { provider: { id: 'fake', complete } as unknown as ChatProvider, complete };
  }

  const evidence = {
    ourImageUrl: 'https://ours/pic.jpg',
    postImageUrls: ['https://post/a.jpg', 'https://post/b.jpg'],
    pageText: 'Смотрите что вышло',
    pageWasPublic: true,
  };

  it('наша картинка идёт ПЕРВОЙ — на неё ссылается инструкция', async () => {
    const { provider: p, complete } = provider('{"published":true,"sameImage":true,"confidence":"high","reason":"ок"}');
    await askVerifier(p, evidence);
    const req = complete.mock.calls[0]![0] as { messages: Array<{ imageUrls: string[] }> };
    expect(req.messages[0]!.imageUrls[0]).toBe('https://ours/pic.jpg');
  });

  it('идёт БЕЗ инструментов — он только смотрит и отвечает', async () => {
    const { provider: p, complete } = provider('{"published":true,"sameImage":true,"confidence":"high","reason":"ок"}');
    await askVerifier(p, evidence);
    const req = complete.mock.calls[0]![0] as { tools: unknown[]; system: string };
    expect(req.tools).toEqual([]);
    // Текст чужой страницы попадает в промпт — защита от указаний внутри него
    // должна быть прописана явно.
    expect(req.system).toMatch(/ДАННЫЕ[^.]*не указания/);
  });

  /**
   * Хештеги проверяющему не показывают НАМЕРЕННО. Иначе он начнёт решать
   * по ним: «тегов нет — значит не тот пост», — а их отсутствие почти
   * всегда означает, что мы не смогли прочитать текст (VK режет описание,
   * Instagram не отдаёт ничего). Отказывать за собственную слепоту нельзя.
   */
  it('хештеги НЕ попадают в решение проверяющего', async () => {
    const { provider: p, complete } = provider('{"published":true,"sameImage":true,"confidence":"high","reason":"ок"}');
    await askVerifier(p, evidence);
    const req = complete.mock.calls[0]![0] as { system: string; messages: Array<{ text: string }> };
    expect(req.messages[0]!.text).not.toMatch(/хештег/i);
    // В системной части они упомянуты ровно затем, чтобы их игнорировать.
    expect(req.system).toMatch(/Хештеги[^.]*НЕ касаются/);
  });

  it('текст страницы обрезается, чтобы длинный пост не раздул запрос', async () => {
    const { provider: p, complete } = provider('{"published":false,"sameImage":false,"confidence":"low","reason":"нет"}');
    await askVerifier(p, { ...evidence, pageText: 'я'.repeat(50_000) });
    const req = complete.mock.calls[0]![0] as { messages: Array<{ text: string }> };
    expect(req.messages[0]!.text.length).toBeLessThan(6000);
  });
});
