DROP INDEX "reading_work_enrichment_status_idx";--> statement-breakpoint
ALTER TABLE "reading_work" DROP COLUMN "metadata_enrichment_status";--> statement-breakpoint
ALTER TABLE "reading_work" DROP COLUMN "metadata_enrichment_at";