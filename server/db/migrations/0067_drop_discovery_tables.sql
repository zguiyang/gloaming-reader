-- Retire Discover + discovery source registry (upload-only product).
-- Ops: pnpm db:migrate (see docs/LOCAL_RUN.md § After removing Discover).
-- user_library_item and reading_work rows from old catalog saves are intentionally retained.
DROP TABLE IF EXISTS "source_record_save_intent";
DROP TABLE IF EXISTS "source_record";
DROP TABLE IF EXISTS "discovery_catalog_entry";
DROP TABLE IF EXISTS "discovery_sync_run";
DROP TABLE IF EXISTS "discovery_source";
