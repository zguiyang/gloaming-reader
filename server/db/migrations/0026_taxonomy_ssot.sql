ALTER TABLE "reading_work" ADD COLUMN "description_provenance" text;--> statement-breakpoint
--> BACKFILL: description_provenance from metadata_provenance jsonb
UPDATE "reading_work"
SET "description_provenance" = "metadata_provenance"->>'description'
WHERE "description" <> ''
  AND "metadata_provenance"->>'description' IN ('extracted', 'ai', 'manual');--> statement-breakpoint
--> BACKFILL: jsonb-only tags → tag rows (normalized dedupe, idempotent)
INSERT INTO "tag" ("id", "name", "normalized", "origin")
SELECT md5(norm), min(name), norm, 'manual'
FROM (
	SELECT trim(t) AS name,
		CASE
			WHEN regexp_replace(lower(trim(t)), '[^a-z0-9]+', '', 'g') = '' THEN lower(trim(t))
			ELSE regexp_replace(lower(trim(t)), '[^a-z0-9]+', '', 'g')
		END AS norm
	FROM "reading_work", jsonb_array_elements_text("tags") AS t
	WHERE trim(t) <> ''
) x
GROUP BY norm
ON CONFLICT ("normalized") DO UPDATE SET "name" = EXCLUDED."name";--> statement-breakpoint
--> BACKFILL: missing reading_work_tag from jsonb (junction wins if already linked)
INSERT INTO "reading_work_tag" ("work_id", "tag_id", "provenance")
SELECT w.id, t.id,
	CASE
		WHEN w."metadata_provenance"->>'tags' IN ('extracted', 'ai', 'manual') THEN w."metadata_provenance"->>'tags'
		ELSE 'manual'
	END
FROM "reading_work" w
JOIN LATERAL jsonb_array_elements_text(w.tags) AS tag_name ON trim(tag_name) <> ''
JOIN "tag" t ON t.normalized = CASE
	WHEN regexp_replace(lower(trim(tag_name)), '[^a-z0-9]+', '', 'g') = '' THEN lower(trim(tag_name))
	ELSE regexp_replace(lower(trim(tag_name)), '[^a-z0-9]+', '', 'g')
END
WHERE NOT EXISTS (
	SELECT 1 FROM "reading_work_tag" rwt
	WHERE rwt."work_id" = w.id AND rwt."tag_id" = t.id
)
ON CONFLICT DO NOTHING;--> statement-breakpoint
--> VALIDATE before DROP (abort migration on inconsistency)
DO $$
DECLARE
  orphan_tags int;
  orphan_cats int;
  orphan_sources int;
  dup_tag_links int;
  dup_cat_links int;
  dup_source_links int;
  jsonb_gap int;
  desc_mismatch int;
BEGIN
  SELECT count(*) INTO orphan_tags
  FROM "reading_work_tag" rwt
  LEFT JOIN "tag" t ON t.id = rwt."tag_id"
  WHERE t.id IS NULL;

  SELECT count(*) INTO orphan_cats
  FROM "reading_work_category" rwc
  LEFT JOIN "category" c ON c.id = rwc."category_id"
  WHERE c.id IS NULL;

  SELECT count(*) INTO orphan_sources
  FROM "reading_work_source" rws
  LEFT JOIN "source" s ON s.id = rws."source_id"
  WHERE s.id IS NULL;

  SELECT count(*) INTO dup_tag_links
  FROM (
    SELECT "work_id", "tag_id", count(*) AS c
    FROM "reading_work_tag"
    GROUP BY "work_id", "tag_id"
    HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO dup_cat_links
  FROM (
    SELECT "work_id", "category_id", count(*) AS c
    FROM "reading_work_category"
    GROUP BY "work_id", "category_id"
    HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO dup_source_links
  FROM (
    SELECT "work_id", "source_id", count(*) AS c
    FROM "reading_work_source"
    GROUP BY "work_id", "source_id"
    HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO jsonb_gap
  FROM "reading_work" w
  WHERE jsonb_array_length(w.tags) > 0
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(w.tags) AS tag_name
      WHERE trim(tag_name) <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM "reading_work_tag" rwt
          JOIN "tag" t ON t.id = rwt."tag_id"
          WHERE rwt."work_id" = w.id
            AND t.normalized = CASE
              WHEN regexp_replace(lower(trim(tag_name)), '[^a-z0-9]+', '', 'g') = '' THEN lower(trim(tag_name))
              ELSE regexp_replace(lower(trim(tag_name)), '[^a-z0-9]+', '', 'g')
            END
        )
    );

  SELECT count(*) INTO desc_mismatch
  FROM "reading_work" w
  WHERE w."description" <> ''
    AND w."metadata_provenance"->>'description' IN ('extracted', 'ai', 'manual')
    AND w."description_provenance" IS DISTINCT FROM w."metadata_provenance"->>'description';

  IF orphan_tags > 0 THEN RAISE EXCEPTION 'taxonomy_ssot: orphan reading_work_tag rows: %', orphan_tags; END IF;
  IF orphan_cats > 0 THEN RAISE EXCEPTION 'taxonomy_ssot: orphan reading_work_category rows: %', orphan_cats; END IF;
  IF orphan_sources > 0 THEN RAISE EXCEPTION 'taxonomy_ssot: orphan reading_work_source rows: %', orphan_sources; END IF;
  IF dup_tag_links > 0 THEN RAISE EXCEPTION 'taxonomy_ssot: duplicate reading_work_tag rows: %', dup_tag_links; END IF;
  IF dup_cat_links > 0 THEN RAISE EXCEPTION 'taxonomy_ssot: duplicate reading_work_category rows: %', dup_cat_links; END IF;
  IF dup_source_links > 0 THEN RAISE EXCEPTION 'taxonomy_ssot: duplicate reading_work_source rows: %', dup_source_links; END IF;
  IF jsonb_gap > 0 THEN RAISE EXCEPTION 'taxonomy_ssot: jsonb tags not fully migrated for % works', jsonb_gap; END IF;
  IF desc_mismatch > 0 THEN RAISE EXCEPTION 'taxonomy_ssot: description_provenance mismatch for % works', desc_mismatch; END IF;
END $$;--> statement-breakpoint
ALTER TABLE "reading_work" DROP COLUMN "tags";--> statement-breakpoint
ALTER TABLE "reading_work" DROP COLUMN "metadata_provenance";
