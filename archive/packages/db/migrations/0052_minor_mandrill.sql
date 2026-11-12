CREATE TABLE "discovery_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"claim_token" timestamp NOT NULL,
	"start_token" timestamp,
	"stage" text DEFAULT 'queued' NOT NULL,
	"committed_records" integer DEFAULT 0 NOT NULL,
	"committed_batches" integer DEFAULT 0 NOT NULL,
	"unavailable_records" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp NOT NULL,
	"started_at" timestamp,
	"last_activity_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"error_summary" text,
	"snapshot_last_modified" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_sync_run_source_claim_uidx" UNIQUE("source_id","claim_token"),
	CONSTRAINT "discovery_sync_run_committed_records_nonnegative_chk" CHECK ("discovery_sync_run"."committed_records" >= 0),
	CONSTRAINT "discovery_sync_run_committed_batches_nonnegative_chk" CHECK ("discovery_sync_run"."committed_batches" >= 0),
	CONSTRAINT "discovery_sync_run_unavailable_records_nonnegative_chk" CHECK ("discovery_sync_run"."unavailable_records" >= 0),
	CONSTRAINT "discovery_sync_run_stage_check" CHECK ("discovery_sync_run"."stage" in ('queued', 'downloading', 'processing', 'reconciling', 'succeeded', 'not_modified', 'skipped', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "discovery_sync_run" ADD CONSTRAINT "discovery_sync_run_source_id_discovery_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."discovery_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_sync_run_source_queued_idx" ON "discovery_sync_run" USING btree ("source_id","queued_at");