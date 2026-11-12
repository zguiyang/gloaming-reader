DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "reading_work"
    WHERE "status" NOT IN (
      'uploaded',
      'processing',
      'parsed',
      'metadata',
      'tts',
      'ready',
      'failed',
      'published'
    )
  ) THEN
    RAISE EXCEPTION 'reading_work.status contains values outside the PR-01 migration allowlist';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "user_library_item" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"work_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_library_item_user_work_uidx" UNIQUE("user_id","work_id")
);
--> statement-breakpoint
ALTER TABLE "user_library_item" ADD CONSTRAINT "user_library_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_library_item" ADD CONSTRAINT "user_library_item_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_library_item_user_idx" ON "user_library_item" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_library_item_work_idx" ON "user_library_item" USING btree ("work_id");--> statement-breakpoint
ALTER TABLE "llm_provider" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "llm_provider" ADD CONSTRAINT "llm_provider_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_app_setting" ADD COLUMN "id" text;--> statement-breakpoint
ALTER TABLE "llm_app_setting" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
UPDATE "llm_app_setting" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "llm_app_setting" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_app_setting" DROP CONSTRAINT "llm_app_setting_pkey";--> statement-breakpoint
ALTER TABLE "llm_app_setting" ADD CONSTRAINT "llm_app_setting_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "llm_app_setting" ADD CONSTRAINT "llm_app_setting_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_config" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "tts_config" ADD CONSTRAINT "tts_config_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_work" ADD COLUMN "processing_status" text;--> statement-breakpoint
UPDATE "reading_work"
SET "processing_status" = CASE
  WHEN "status" IN ('tts', 'published') THEN 'ready'
  ELSE "status"
END;--> statement-breakpoint
ALTER TABLE "reading_work" ALTER COLUMN "processing_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_work" ALTER COLUMN "processing_status" SET DEFAULT 'processing';--> statement-breakpoint
DROP INDEX "reading_work_status_idx";--> statement-breakpoint
ALTER TABLE "reading_work" DROP COLUMN "status";--> statement-breakpoint
CREATE INDEX "reading_work_processing_status_idx" ON "reading_work" USING btree ("processing_status");--> statement-breakpoint
INSERT INTO "user_library_item" ("id", "user_id", "work_id", "created_at")
SELECT gen_random_uuid()::text, "user_id", "work_id", "added_at"
FROM "reading_state";--> statement-breakpoint
CREATE UNIQUE INDEX "llm_provider_user_name_uidx" ON "llm_provider" USING btree ("owner_user_id","name") WHERE "owner_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_app_setting_instance_key_uidx" ON "llm_app_setting" USING btree ("key") WHERE "owner_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_app_setting_user_key_uidx" ON "llm_app_setting" USING btree ("owner_user_id","key") WHERE "owner_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tts_config_instance_uidx" ON "tts_config" USING btree ((true)) WHERE "owner_user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tts_config_user_uidx" ON "tts_config" USING btree ("owner_user_id") WHERE "owner_user_id" is not null;
