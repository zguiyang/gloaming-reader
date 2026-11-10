CREATE TABLE "discovery_source" (
	"id" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"source_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"sync_started_at" timestamp,
	"sync_finished_at" timestamp,
	"last_success_at" timestamp,
	"last_error_summary" text,
	"snapshot_last_modified" text,
	"snapshot_version" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_source_key_uidx" UNIQUE("source_key"),
	CONSTRAINT "discovery_source_key_nonempty_chk" CHECK (length("discovery_source"."source_key") > 0),
	CONSTRAINT "discovery_source_sync_status_check" CHECK ("discovery_source"."sync_status" in ('idle', 'queued', 'syncing', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "source_record" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"rights_statement" text,
	"cover_url" text,
	"content_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"availability" text DEFAULT 'available' NOT NULL,
	"source_updated_at" timestamp,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_record_source_external_uidx" UNIQUE("source_id","external_id"),
	CONSTRAINT "source_record_external_id_nonempty_chk" CHECK (length("source_record"."external_id") > 0),
	CONSTRAINT "source_record_availability_check" CHECK ("source_record"."availability" in ('available', 'unavailable'))
);
--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_source_id_discovery_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."discovery_source"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "source_record_source_idx" ON "source_record" USING btree ("source_id");
--> statement-breakpoint
CREATE INDEX "source_record_source_availability_idx" ON "source_record" USING btree ("source_id","availability");
--> statement-breakpoint
CREATE INDEX "source_record_languages_gin_idx" ON "source_record" USING gin ("languages");
--> statement-breakpoint
CREATE INDEX "source_record_last_seen_idx" ON "source_record" USING btree ("last_seen_at");
