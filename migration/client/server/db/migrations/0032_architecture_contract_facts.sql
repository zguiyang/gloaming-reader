ALTER TABLE "reading_state" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_state" ADD CONSTRAINT "reading_state_revision_nonnegative_chk" CHECK ("reading_state"."revision" >= 0);--> statement-breakpoint
ALTER TABLE "content_asset" ADD COLUMN "generation_key" text;--> statement-breakpoint
ALTER TABLE "content_asset" ADD COLUMN "generation_token" text;--> statement-breakpoint
ALTER TABLE "content_asset" ADD COLUMN "generation_claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "content_asset" ADD COLUMN "generation_lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "content_asset" ADD CONSTRAINT "content_asset_generation_key_nonempty_chk" CHECK ("generation_key" IS NULL OR length("generation_key") > 0);--> statement-breakpoint
ALTER TABLE "content_asset" ADD CONSTRAINT "content_asset_generation_token_nonempty_chk" CHECK ("generation_token" IS NULL OR length("generation_token") > 0);--> statement-breakpoint
UPDATE "content_asset"
SET "generation_key" = "part_id" || ':' || "kind" || ':' || "content_hash"
WHERE "part_id" IS NOT NULL
  AND "kind" IN ('audio_us', 'audio_uk');--> statement-breakpoint
CREATE UNIQUE INDEX "content_asset_generation_key_uidx" ON "content_asset" USING btree ("generation_key") WHERE "generation_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "content_asset_generation_token_uidx" ON "content_asset" USING btree ("generation_token") WHERE "generation_token" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "content_asset_generation_lease_idx" ON "content_asset" USING btree ("generation_lease_expires_at") WHERE "generation_lease_expires_at" IS NOT NULL;