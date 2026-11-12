CREATE TABLE "article" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"level" text DEFAULT 'easy' NOT NULL,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"series_id" text,
	"series_order" integer,
	"estimated_minutes" integer,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "article_status_idx" ON "article" USING btree ("status");--> statement-breakpoint
CREATE INDEX "article_series_idx" ON "article" USING btree ("series_id","series_order");