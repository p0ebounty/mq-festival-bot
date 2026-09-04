ALTER TABLE "generations" ADD COLUMN "world_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_world_id_base_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."base_worlds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Восстановление связи для уже сделанных работ.
--
-- До этой миграции мир нигде не записывался: у генерации оставался только
-- `source_url` — ссылка на картинку, которая ушла в модель. По ней связь
-- восстанавливается: первое звено правит саму выданную картинку мира,
-- дальше цепочка идёт через результат предыдущей правки.
--
-- Восстанавливает не всё: у части медиа `remote_url` не сохранился, такие
-- звенья цепочку обрывают. На проде это 8 работ из 10 — лучше, чем пустая
-- страница, и ошибочных привязок такой разбор не даёт.
WITH RECURSIVE chain AS (
	SELECT g.id, bw.id AS world_id
	FROM generations g
	JOIN media m ON m.remote_url = g.source_url
	JOIN base_worlds bw ON bw.media_id = m.id AND bw.kind = 'world'
	WHERE g.kind = 'world'
	UNION
	SELECT g2.id, c.world_id
	FROM chain c
	JOIN generations g1 ON g1.id = c.id
	JOIN media om ON om.id = g1.output_media_id
	JOIN generations g2 ON g2.source_url = om.remote_url AND g2.kind = 'world'
)
UPDATE generations g
SET world_id = c.world_id
FROM (SELECT DISTINCT ON (id) id, world_id FROM chain) c
WHERE g.id = c.id AND g.world_id IS NULL;
