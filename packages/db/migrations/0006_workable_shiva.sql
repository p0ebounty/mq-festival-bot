ALTER TABLE "generations" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "remote_url" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "remote_url_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "current_world_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;