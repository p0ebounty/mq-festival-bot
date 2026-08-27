import { describe, it, expect } from 'vitest';
import { makeSuggestTool, MAX_SUGGESTIONS, MAX_SUGGESTION_LEN } from '../src/agent/tools/suggest';
import type { ToolContext } from '@mq/core';

function ctxWith(sink: string[][]): ToolContext {
  return {
    userId: 'u', conversationId: 'c', chatId: 1n, userMessage: 'x',
    log: { info: () => {}, warn: () => {} },
    suggest: (o) => sink.push(o),
  };
}
const tool = makeSuggestTool();

describe('кнопки-подсказки', () => {
  it('передаёт варианты в канал бота', async () => {
    const sink: string[][] = [];
    const r = await tool.run({ options: ['Хочу космонавтом', 'Хочу врачом'] }, ctxWith(sink));
    expect(r.ok).toBe(true);
    expect(sink[0]).toEqual(['Хочу космонавтом', 'Хочу врачом']);
  });

  it('подрезает длинный вариант, а не выбрасывает его', async () => {
    const sink: string[][] = [];
    const long = 'Хочу увидеть себя космонавтом на фоне родного города вечером';
    await tool.run({ options: [long] }, ctxWith(sink));
    expect(sink[0]![0]!.length).toBe(MAX_SUGGESTION_LEN);
    expect(sink[0]![0]).toMatch(/…$/);
  });

  it('короткий вариант не трогает', async () => {
    const sink: string[][] = [];
    await tool.run({ options: ['Давай ещё раз'] }, ctxWith(sink));
    expect(sink[0]).toEqual(['Давай ещё раз']);
  });

  it('лишние варианты отсекаются по лимиту', async () => {
    const sink: string[][] = [];
    const many = Array.from({ length: MAX_SUGGESTIONS + 2 }, (_, i) => `в${i}`);
    // zod отвергнет на входе, поэтому проверяем ветку run напрямую
    await tool.run({ options: many }, ctxWith(sink));
    expect(sink[0]!.length).toBe(MAX_SUGGESTIONS);
  });

  it('схема не пропускает больше лимита', () => {
    const many = Array.from({ length: MAX_SUGGESTIONS + 1 }, (_, i) => `в${i}`);
    expect(tool.input.safeParse({ options: many }).success).toBe(false);
  });

  it('пустые строки отфильтровываются', async () => {
    const sink: string[][] = [];
    const r = await tool.run({ options: ['  ', 'Норм'] }, ctxWith(sink));
    expect(r.ok).toBe(true);
    expect(sink[0]).toEqual(['Норм']);
  });

  it('если все пустые — честный отказ', async () => {
    const sink: string[][] = [];
    const r = await tool.run({ options: ['   '] }, ctxWith(sink));
    expect(r.ok).toBe(false);
    expect(sink).toHaveLength(0);
  });

  it('без канала подсказок отвечает понятно, а не падает', async () => {
    const r = await tool.run({ options: ['Да'] }, {
      userId: 'u', conversationId: 'c', chatId: 1n, userMessage: 'x',
      log: { info: () => {}, warn: () => {} },
    });
    expect(r.ok).toBe(false);
    expect(`${r.summary} ${r.note ?? ''}`).toContain('словами');
  });

  it('указание не дублировать кнопки лежит в служебном поле, не в факте', async () => {
    const sink: string[][] = [];
    const r = await tool.run({ options: ['Да'] }, ctxWith(sink));
    expect(r.note).toContain('Не дублируй');
    // в summary только факт — его агент может пересказать участнику
    expect(r.summary).not.toContain('Не дублируй');
  });
});
