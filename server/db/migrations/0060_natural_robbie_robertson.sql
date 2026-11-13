DROP INDEX "conversation_user_open_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "content_asset_work_kind_uidx" ON "content_asset" USING btree ("work_id","kind") WHERE "content_asset"."part_id" is null and "content_asset"."kind" in ('cover', 'origin_file');--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_user_open_uidx" ON "conversation" USING btree ("user_id","surface","subject_type","subject_id") WHERE "conversation"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "source_record_save_intent_status_updated_idx" ON "source_record_save_intent" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "reading_state" ADD CONSTRAINT "reading_state_status_check" CHECK ("reading_state"."status" in ('in_progress', 'completed'));--> statement-breakpoint
ALTER TABLE "reading_work" ADD CONSTRAINT "reading_work_processing_status_check" CHECK ("reading_work"."processing_status" in ('uploaded', 'processing', 'parsed', 'metadata', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE "reading_work" ADD CONSTRAINT "reading_work_visibility_check" CHECK ("reading_work"."visibility" in ('catalog', 'private'));