CREATE TABLE "article_audio" (
	"article_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"voice" text NOT NULL,
	"role" text,
	"content_hash" text NOT NULL,
	"redis_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"duration_ms" integer,
	"last_error" text,
	"generated_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_invocation_log" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"source" text NOT NULL,
	"user_id" text,
	"article_id" text,
	"voice" text,
	"role" text,
	"text_preview" text,
	"text_length" integer,
	"latency_ms" integer,
	"cached" boolean
);
--> statement-breakpoint
ALTER TABLE "article_audio" ADD CONSTRAINT "article_audio_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tts_invocation_log_created_at_idx" ON "tts_invocation_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tts_invocation_log_status_created_idx" ON "tts_invocation_log" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tts_invocation_log_article_created_idx" ON "tts_invocation_log" USING btree ("article_id","created_at");