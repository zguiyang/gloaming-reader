CREATE TABLE "source_record_category_mapping_support" (
	"source_record_id" text NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "source_record_category_mapping_support_uidx" UNIQUE("source_record_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "source_record_public_category" DROP CONSTRAINT "source_record_public_category_source_check";--> statement-breakpoint
ALTER TABLE "source_record_category_mapping_support" ADD CONSTRAINT "source_record_category_mapping_support_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record_category_mapping_support" ADD CONSTRAINT "source_record_category_mapping_support_category_id_public_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."public_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record_public_category" ADD CONSTRAINT "source_record_public_category_source_check" CHECK ("source_record_public_category"."source" in ('manual', 'ai', 'source'));