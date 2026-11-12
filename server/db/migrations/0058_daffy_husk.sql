CREATE TABLE "source_category_reconciliation" (
	"mapping_id" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"cursor" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_category_reconciliation_status_check" CHECK ("source_category_reconciliation"."status" in ('pending', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "source_category_reconciliation" ADD CONSTRAINT "source_category_reconciliation_mapping_id_source_category_mapping_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."source_category_mapping"("id") ON DELETE cascade ON UPDATE no action;