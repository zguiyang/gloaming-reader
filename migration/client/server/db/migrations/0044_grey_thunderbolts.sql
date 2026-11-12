CREATE TABLE "source_record_save_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_record_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_code" text,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_record_save_intent_user_record_uidx" UNIQUE("user_id","source_record_id"),
	CONSTRAINT "source_record_save_intent_status_check" CHECK ("source_record_save_intent"."status" in ('pending', 'failed', 'completed')),
	CONSTRAINT "source_record_save_intent_failure_code_nonempty_chk" CHECK ("source_record_save_intent"."failure_code" is null or length("source_record_save_intent"."failure_code") > 0)
);
--> statement-breakpoint
ALTER TABLE "source_record_save_intent" ADD CONSTRAINT "source_record_save_intent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record_save_intent" ADD CONSTRAINT "source_record_save_intent_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_record_save_intent_user_idx" ON "source_record_save_intent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "source_record_save_intent_record_status_idx" ON "source_record_save_intent" USING btree ("source_record_id","status");