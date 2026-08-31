import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sql, eq, desc } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';

/**
 * Ловушка Drizzle, которая молча врала на проде.
 *
 * В СПИСКЕ ВЫБОРКИ Drizzle рендерит колонку без имени таблицы. Поэтому
 * коррелированный подзапрос, собранный через интерполяцию, теряет связь с
 * внешней таблицей:
 *
 *   sql`(select count(*) from ${messages}
 *        where ${messages.conversationId} = ${conversations.id})`
 *   → (select count(*) from "messages" where "conversation_id" = "id")
 *
 * Оба имени резолвятся в колонки messages, сравнивается conversation_id с
 * собственным id строки. SQL валидный (обе колонки uuid), ошибки нет,
 * ответ ВСЕГДА ноль.
 *
 * Так админка показывала «0 сообщ.» у диалога из 38 сообщений и «0»
 * генераций у всех участников сразу. Молчаливый ноль опаснее падения:
 * его принимают за правду и по нему принимают решения.
 *
 * Тест не ходит в базу — он смотрит на сгенерированный SQL.
 */

const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  lastMessageAt: timestamp('last_message_at'),
});
const messages = pgTable('messages', {
  id: uuid('id').primaryKey(),
  conversationId: uuid('conversation_id').notNull(),
  text: text('text'),
});

const db = drizzle.mock();

/** Схлопывает переносы, чтобы условие искалось одной строкой. */
const flat = (q: { toSQL(): { sql: string } }) => q.toSQL().sql.replace(/\s+/g, ' ');

describe('коррелированные подзапросы в админке', () => {
  it('интерполяция колонок теряет имя таблицы — так и было на проде', () => {
    const broken = db.select({
      id: conversations.id,
      messages: sql<number>`(select count(*)::int from ${messages}
        where ${messages.conversationId} = ${conversations.id})`,
    }).from(conversations);

    // Фиксируем сам дефект: если Drizzle однажды начнёт квалифицировать
    // колонки сам, тест упадёт и обходной путь можно будет убрать.
    expect(flat(broken)).toContain('where "conversation_id" = "id"');
    expect(flat(broken)).not.toContain('conversations.id');
  });

  it('голый SQL с алиасом корреляцию сохраняет', () => {
    const fixed = db.select({
      id: conversations.id,
      messages: sql<number>`(select count(*)::int from messages m
        where m.conversation_id = conversations.id)`,
    }).from(conversations).where(eq(conversations.userId, 'x'))
      .orderBy(desc(conversations.lastMessageAt));

    expect(flat(fixed)).toContain('where m.conversation_id = conversations.id');
  });

  it('в исходнике админки не осталось интерполяции внутри подзапросов', () => {
    // Главная защита: сам файл не должен содержать ${...} внутри (select ...).
    const src = readFileSync(new URL('../src/lib/queries.ts', import.meta.url), 'utf8')
      // Комментарии выкидываем: в них лежит ОБРАЗЕЦ сломанного запроса,
      // и без этого тест ловил бы собственное объяснение.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // Каждый шаблонный литерал, внутри которого есть подзапрос.
    //
    // ⚠️ `\(\s*select`, а не `\(select`: 31.08 счётчик работ по заданию
    // писался как «(\n select count(*) from ${generations} …» — со скобкой
    // и переносом строки. Регулярка без \s* его не увидела, тест прошёл
    // зелёным, а в админке у задания с тремя работами стоял ноль.
    // Защита, которая ловит только одно написание, защищает только от него.
    const subqueries = src.match(/`[^`]*\(\s*select[^`]*`/gi) ?? [];
    expect(subqueries.length, 'подзапросы вообще нашлись').toBeGreaterThan(0);

    for (const q of subqueries) {
      expect(q, `интерполяция внутри подзапроса:\n${q}`).not.toMatch(/\$\{/);
    }
  });

  it('проверка видит подзапрос, записанный с переноса строки', () => {
    // Тот самый пропущенный случай, дословно.
    const sample = '`(\n      select count(*)::int from ${generations}\n    )`';
    expect(sample.match(/`[^`]*\(\s*select[^`]*`/gi)).not.toBeNull();
  });
});
