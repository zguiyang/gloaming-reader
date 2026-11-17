CREATE TABLE "discovery_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"claim_token" timestamp NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"refreshed" integer DEFAULT 0 NOT NULL,
	"evicted" integer DEFAULT 0 NOT NULL,
	"skipped_filter" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"error_summary" text,
	"snapshot_last_modified" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_sync_run_source_claim_uidx" UNIQUE("source_id","claim_token"),
	CONSTRAINT "discovery_sync_run_inserted_nonnegative_chk" CHECK ("discovery_sync_run"."inserted" >= 0),
	CONSTRAINT "discovery_sync_run_refreshed_nonnegative_chk" CHECK ("discovery_sync_run"."refreshed" >= 0),
	CONSTRAINT "discovery_sync_run_evicted_nonnegative_chk" CHECK ("discovery_sync_run"."evicted" >= 0),
	CONSTRAINT "discovery_sync_run_skipped_filter_nonnegative_chk" CHECK ("discovery_sync_run"."skipped_filter" >= 0),
	CONSTRAINT "discovery_sync_run_stage_check" CHECK ("discovery_sync_run"."stage" in ('queued', 'downloading', 'processing', 'succeeded', 'not_modified', 'skipped', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "discovery_source" ADD COLUMN "max_rows" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_source" ADD COLUMN "languages" text[] DEFAULT ARRAY['en']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_source" ADD COLUMN "require_epub" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_source" ADD COLUMN "eviction_policy" text DEFAULT 'hot_swap' NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_source" ADD COLUMN "budget_bytes_hint" integer DEFAULT 104857600 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_record" ADD COLUMN "popularity_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_sync_run" ADD CONSTRAINT "discovery_sync_run_source_id_discovery_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."discovery_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_sync_run_source_queued_idx" ON "discovery_sync_run" USING btree ("source_id","queued_at");--> statement-breakpoint
CREATE INDEX "source_record_source_popularity_idx" ON "source_record" USING btree ("source_id","popularity_score");--> statement-breakpoint
ALTER TABLE "discovery_source" ADD CONSTRAINT "discovery_source_max_rows_positive_chk" CHECK ("discovery_source"."max_rows" > 0);--> statement-breakpoint
ALTER TABLE "discovery_source" ADD CONSTRAINT "discovery_source_budget_bytes_nonnegative_chk" CHECK ("discovery_source"."budget_bytes_hint" >= 0);--> statement-breakpoint
ALTER TABLE "discovery_source" ADD CONSTRAINT "discovery_source_eviction_policy_check" CHECK ("discovery_source"."eviction_policy" in ('hot_swap', 'freeze_inserts'));--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_popularity_score_nonnegative_chk" CHECK ("source_record"."popularity_score" >= 0);