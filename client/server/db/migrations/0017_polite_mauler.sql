CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "category_name_unique" UNIQUE("name"),
	CONSTRAINT "category_normalized_unique" UNIQUE("normalized")
);
--> statement-breakpoint
CREATE TABLE "reading_work_category" (
	"work_id" text NOT NULL,
	"category_id" text NOT NULL,
	"provenance" text DEFAULT 'extracted' NOT NULL,
	CONSTRAINT "reading_work_category_work_category_uidx" UNIQUE("work_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "reading_work_source" (
	"work_id" text NOT NULL,
	"source_id" text NOT NULL,
	"provenance" text DEFAULT 'extracted' NOT NULL,
	CONSTRAINT "reading_work_source_work_source_uidx" UNIQUE("work_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "reading_work_tag" (
	"work_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"provenance" text DEFAULT 'extracted' NOT NULL,
	CONSTRAINT "reading_work_tag_work_tag_uidx" UNIQUE("work_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"match_rule" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tag_name_unique" UNIQUE("name"),
	CONSTRAINT "tag_normalized_unique" UNIQUE("normalized")
);
--> statement-breakpoint
ALTER TABLE "reading_work" ADD COLUMN "metadata_enrichment_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_work" ADD COLUMN "metadata_enrichment_at" timestamp;--> statement-breakpoint
ALTER TABLE "reading_work" ADD COLUMN "metadata_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_work_category" ADD CONSTRAINT "reading_work_category_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_work_category" ADD CONSTRAINT "reading_work_category_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_work_source" ADD CONSTRAINT "reading_work_source_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_work_source" ADD CONSTRAINT "reading_work_source_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_work_tag" ADD CONSTRAINT "reading_work_tag_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_work_tag" ADD CONSTRAINT "reading_work_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_normalized_idx" ON "category" USING btree ("normalized");--> statement-breakpoint
CREATE INDEX "reading_work_category_work_idx" ON "reading_work_category" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "reading_work_category_category_idx" ON "reading_work_category" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "reading_work_source_work_idx" ON "reading_work_source" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "reading_work_source_source_idx" ON "reading_work_source" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "reading_work_tag_work_idx" ON "reading_work_tag" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "reading_work_tag_tag_idx" ON "reading_work_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "source_match_rule_idx" ON "source" USING btree ("match_rule");--> statement-breakpoint
CREATE INDEX "tag_normalized_idx" ON "tag" USING btree ("normalized");--> statement-breakpoint
CREATE INDEX "reading_work_enrichment_status_idx" ON "reading_work" USING btree ("metadata_enrichment_status");--> statement-breakpoint
--> Seed: predefined category enumeration (appendix A of METADATA-PIPELINE-PLAN.md)
INSERT INTO "category" ("id", "name", "normalized") VALUES
	('cat-fiction', 'Fiction', 'fiction'),
	('cat-non-fiction', 'Non-Fiction', 'nonfiction'),
	('cat-science', 'Science', 'science'),
	('cat-fantasy', 'Fantasy', 'fantasy'),
	('cat-science-fiction', 'Science Fiction', 'sciencefiction'),
	('cat-mystery', 'Mystery', 'mystery'),
	('cat-thriller', 'Thriller', 'thriller'),
	('cat-romance', 'Romance', 'romance'),
	('cat-history', 'History', 'history'),
	('cat-biography', 'Biography', 'biography'),
	('cat-self-help', 'Self-Help', 'selfhelp'),
	('cat-business', 'Business', 'business'),
	('cat-technology', 'Technology', 'technology'),
	('cat-philosophy', 'Philosophy', 'philosophy'),
	('cat-poetry', 'Poetry', 'poetry'),
	('cat-classic', 'Classic', 'classic');--> statement-breakpoint
--> Data migration: legacy reading_work.tags jsonb → tag + reading_work_tag (manual provenance)
INSERT INTO "tag" ("id", "name", "normalized")
SELECT md5(norm), min(name), norm
FROM (
	SELECT name,
		CASE
			WHEN regexp_replace(lower(trim(name)), '[^a-z0-9]+', '', 'g') = '' THEN lower(trim(name))
			ELSE regexp_replace(lower(trim(name)), '[^a-z0-9]+', '', 'g')
		END AS norm
	FROM (SELECT trim(t) AS name FROM "reading_work", jsonb_array_elements_text("tags") AS t) x
) y
GROUP BY norm;--> statement-breakpoint
INSERT INTO "reading_work_tag" ("work_id", "tag_id", "provenance")
SELECT w.id, t.id, 'manual'
FROM "reading_work" w
JOIN LATERAL jsonb_array_elements_text(w.tags) AS tag_name ON true
JOIN "tag" t ON t.normalized = CASE
	WHEN regexp_replace(lower(trim(tag_name)), '[^a-z0-9]+', '', 'g') = '' THEN lower(trim(tag_name))
	ELSE regexp_replace(lower(trim(tag_name)), '[^a-z0-9]+', '', 'g')
END
ON CONFLICT DO NOTHING;--> statement-breakpoint
--> Existing works are not auto-enriched (no bulk AI spend); admin can trigger later.
UPDATE "reading_work" SET "metadata_enrichment_status" = 'skipped' WHERE "metadata_enrichment_status" = 'pending';