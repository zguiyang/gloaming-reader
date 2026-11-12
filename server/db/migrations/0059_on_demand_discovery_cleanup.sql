-- On-demand Discover: drop public-category module, sync-run observability, and
-- orphan bibliography rows that were never saved into a library.

DELETE FROM source_record sr
WHERE sr.work_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM source_record_save_intent si
    WHERE si.source_record_id = sr.id
  );
--> statement-breakpoint
DROP TABLE IF EXISTS "source_record_category_mapping_support" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "source_record_public_category_suppression" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "source_record_public_category" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "source_record_public_classification_state" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "source_category_reconciliation" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "source_category_mapping_category" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "source_category_mapping" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "public_category_alias" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "public_category_label" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "public_category" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "discovery_sync_run" CASCADE;--> statement-breakpoint
UPDATE "discovery_source" SET "source_type" = 'gutenberg_opds' WHERE "source_key" = 'project_gutenberg';
