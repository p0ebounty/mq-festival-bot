ALTER TABLE "users" ADD COLUMN "current_task_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "current_task_at" timestamp with time zone;