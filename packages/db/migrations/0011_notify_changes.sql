-- Живое обновление админки.
--
-- Админка и бот — разные процессы, общая у них только база. Чтобы админка
-- узнавала о новых сообщениях и генерациях, не опрашивая БД по таймеру,
-- сама база сообщает об изменениях через LISTEN/NOTIFY.
--
-- Триггеры висят на таблицах, а не на коде бота: тогда уведомление уходит
-- при ЛЮБОЙ записи — из бота, из воркера, из миграции, руками из psql.
-- Забыть позвать его неоткуда.
--
-- В payload идёт только имя таблицы: у NOTIFY предел 8000 байт, а строки
-- бывают большими (промпты, jsonb). Админке хватает знать, что «что-то в
-- таких-то данных поменялось» — дальше она перечитает страницу сама.

CREATE OR REPLACE FUNCTION mq_notify_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('mq_changed', TG_TABLE_NAME);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- AFTER ... FOR EACH STATEMENT: одно уведомление на запрос, а не на строку.
-- Иначе массовая вставка залила бы канал сотнями одинаковых сообщений.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'messages', 'tool_calls', 'generations', 'conversations',
    'users', 'social_claims', 'token_ledger', 'audit_log', 'short_links'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS mq_notify_%1$s ON %1$I', t);
    EXECUTE format(
      'CREATE TRIGGER mq_notify_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I
       FOR EACH STATEMENT EXECUTE FUNCTION mq_notify_change()', t);
  END LOOP;
END $$;
