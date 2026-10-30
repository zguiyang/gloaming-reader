ALTER TABLE "source_category_mapping" DROP CONSTRAINT "source_category_mapping_status_check";--> statement-breakpoint
ALTER TABLE "source_category_mapping" ADD COLUMN "lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "source_category_mapping" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "source_category_mapping" ADD CONSTRAINT "source_category_mapping_status_check" CHECK ("source_category_mapping"."status" in ('pending', 'analyzing', 'review', 'confirmed', 'ignored'));