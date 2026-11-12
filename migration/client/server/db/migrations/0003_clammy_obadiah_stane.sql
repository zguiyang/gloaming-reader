CREATE TABLE "ai_invocation_log" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"purpose" text,
	"source" text NOT NULL,
	"user_id" text,
	"ref_type" text,
	"ref_id" text,
	"model_row_id" text,
	"provider_id" text,
	"model_id" text,
	"base_url" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_amount" numeric(18, 8),
	"cost_currency" text,
	"request_summary" jsonb,
	"response_summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "llm_app_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_model" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"label" text NOT NULL,
	"temperature" double precision,
	"max_tokens" integer,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "llm_model_provider_model_uidx" UNIQUE("provider_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "llm_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_model" ADD CONSTRAINT "llm_model_provider_id_llm_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."llm_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_invocation_log_created_at_idx" ON "ai_invocation_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_invocation_log_purpose_created_idx" ON "ai_invocation_log" USING btree ("purpose","created_at");--> statement-breakpoint
CREATE INDEX "ai_invocation_log_source_created_idx" ON "ai_invocation_log" USING btree ("source","created_at");--> statement-breakpoint
CREATE INDEX "ai_invocation_log_status_created_idx" ON "ai_invocation_log" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "llm_model_provider_idx" ON "llm_model" USING btree ("provider_id");