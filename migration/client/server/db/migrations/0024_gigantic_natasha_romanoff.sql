ALTER TABLE "llm_model" ADD COLUMN "context_length" integer;--> statement-breakpoint
ALTER TABLE "llm_provider" ADD COLUMN "balance_endpoint" text;--> statement-breakpoint
ALTER TABLE "llm_provider" ADD COLUMN "balance_amount_path" text;--> statement-breakpoint
ALTER TABLE "llm_provider" ADD COLUMN "balance_currency_path" text;