DROP TABLE IF EXISTS "article_audio";--> statement-breakpoint
DROP TABLE IF EXISTS "reading_progress";--> statement-breakpoint
DROP TABLE IF EXISTS "article";--> statement-breakpoint
DROP INDEX IF EXISTS "tts_invocation_log_article_created_idx";--> statement-breakpoint
ALTER TABLE "tts_invocation_log" DROP COLUMN IF EXISTS "article_id";--> statement-breakpoint
ALTER TABLE "tts_invocation_log" ADD COLUMN "work_id" text;--> statement-breakpoint
ALTER TABLE "tts_invocation_log" ADD COLUMN "part_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tts_invocation_log_part_created_idx" ON "tts_invocation_log" ("part_id", "created_at");--> statement-breakpoint
CREATE TABLE "reading_work" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'catalog' NOT NULL,
	"owner_user_id" text,
	"origin_kind" text DEFAULT 'admin_text' NOT NULL,
	"origin_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_note" text DEFAULT '' NOT NULL,
	"cover_asset_id" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "reading_work" ADD CONSTRAINT "reading_work_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reading_work_status_idx" ON "reading_work" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reading_work_published_at_idx" ON "reading_work" USING btree ("published_at");--> statement-breakpoint
CREATE TABLE "reading_part" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'body' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "reading_part" ADD CONSTRAINT "reading_part_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_part_work_sort_uidx" ON "reading_part" USING btree ("work_id","sort_order");--> statement-breakpoint
CREATE INDEX "reading_part_work_idx" ON "reading_part" USING btree ("work_id");--> statement-breakpoint
CREATE TABLE "reading_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"work_id" text NOT NULL,
	"current_part_id" text,
	"anchor_kind" text,
	"anchor_value" text,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"last_read_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "reading_state" ADD CONSTRAINT "reading_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_state" ADD CONSTRAINT "reading_state_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_state" ADD CONSTRAINT "reading_state_current_part_id_reading_part_id_fk" FOREIGN KEY ("current_part_id") REFERENCES "public"."reading_part"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_state_user_work_uidx" ON "reading_state" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "reading_state_user_last_read_idx" ON "reading_state" USING btree ("user_id","last_read_at");--> statement-breakpoint
CREATE INDEX "reading_state_work_idx" ON "reading_state" USING btree ("work_id");--> statement-breakpoint
CREATE TABLE "content_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text,
	"part_id" text,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "content_asset" ADD CONSTRAINT "content_asset_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset" ADD CONSTRAINT "content_asset_part_id_reading_part_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."reading_part"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_asset_part_kind_uidx" ON "content_asset" USING btree ("part_id","kind");--> statement-breakpoint
CREATE INDEX "content_asset_work_idx" ON "content_asset" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "content_asset_part_idx" ON "content_asset" USING btree ("part_id");
