CREATE TABLE IF NOT EXISTS "dictionary_config" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'free_dictionary' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"enable_ai_enrichment" boolean DEFAULT true NOT NULL,
	"custom_endpoint" text,
	"api_key_ciphertext" text,
	"timeout_ms" integer DEFAULT 5000 NOT NULL,
	"cache_ttl_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dictionary_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"word" text NOT NULL,
	"phonetics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meanings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context_examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_provider_data" jsonb,
	"source" text DEFAULT 'free_dictionary' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dictionary_entry_word_uidx" UNIQUE("word")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dictionary_entry_word_idx" ON "dictionary_entry" USING btree ("word");
