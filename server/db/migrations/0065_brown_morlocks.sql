CREATE TABLE "discovery_catalog_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"popularity_score" integer DEFAULT 0 NOT NULL,
	"has_epub" boolean DEFAULT false NOT NULL,
	"issued_at" date,
	"cover_url" text,
	"content_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_catalog_entry_source_external_uidx" UNIQUE("source_id","external_id"),
	CONSTRAINT "discovery_catalog_entry_external_id_nonempty_chk" CHECK (length("discovery_catalog_entry"."external_id") > 0),
	CONSTRAINT "discovery_catalog_entry_popularity_score_nonnegative_chk" CHECK ("discovery_catalog_entry"."popularity_score" >= 0)
);
--> statement-breakpoint
ALTER TABLE "discovery_catalog_entry" ADD CONSTRAINT "discovery_catalog_entry_source_id_discovery_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."discovery_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_catalog_entry_source_popularity_idx" ON "discovery_catalog_entry" USING btree ("source_id","popularity_score");--> statement-breakpoint
CREATE INDEX "discovery_catalog_entry_source_last_seen_idx" ON "discovery_catalog_entry" USING btree ("source_id","last_seen_at");