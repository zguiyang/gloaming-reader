ALTER TABLE "source_record" ADD COLUMN "work_id" text;--> statement-breakpoint
ALTER TABLE "source_record" ADD COLUMN "materialization_status" text DEFAULT 'not_materialized' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_work_uidx" UNIQUE("work_id");--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_materialization_status_check" CHECK ("source_record"."materialization_status" in ('not_materialized', 'processing', 'ready', 'failed'));