ALTER TABLE "llm_provider" ADD COLUMN "api_family" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_model" RENAME COLUMN "protocol" TO "wire_variant";
