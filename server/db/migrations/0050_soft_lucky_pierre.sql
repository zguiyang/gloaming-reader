CREATE TABLE "source_record_public_classification_state" (
	"source_record_id" text PRIMARY KEY NOT NULL,
	"evidence_fingerprint" text NOT NULL,
	"completed_fingerprint" text,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_deferred_reason" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_record_public_classification_retry_nonnegative_chk" CHECK ("source_record_public_classification_state"."retry_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "source_record_public_classification_state" ADD CONSTRAINT "source_record_public_classification_state_source_record_id_source_record_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_record_public_classification_due_idx" ON "source_record_public_classification_state" USING btree ("next_attempt_at");