ALTER TABLE "social_claims" DROP CONSTRAINT "social_claims_screenshot_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "social_claims" ALTER COLUMN "screenshot_media_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "social_claims" ADD COLUMN "post_url" text;--> statement-breakpoint
ALTER TABLE "social_claims" ADD COLUMN "url_key" varchar(32);--> statement-breakpoint
ALTER TABLE "social_claims" ADD COLUMN "evidence" text;--> statement-breakpoint
ALTER TABLE "social_claims" ADD COLUMN "checks" jsonb;--> statement-breakpoint
ALTER TABLE "social_claims" ADD CONSTRAINT "social_claims_screenshot_media_id_media_id_fk" FOREIGN KEY ("screenshot_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_claims_url_uniq" ON "social_claims" USING btree ("url_key");