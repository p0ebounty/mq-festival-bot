CREATE TYPE "public"."pool_kind" AS ENUM('world', 'task');--> statement-breakpoint
ALTER TABLE "base_worlds" ADD COLUMN "kind" "pool_kind" DEFAULT 'world' NOT NULL;--> statement-breakpoint
ALTER TABLE "base_worlds" ADD COLUMN "task_text" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_task_id_base_worlds_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."base_worlds"("id") ON DELETE set null ON UPDATE no action;