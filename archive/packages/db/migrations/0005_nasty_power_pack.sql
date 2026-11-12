CREATE TABLE "tts_config" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'azure' NOT NULL,
	"region" text NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"default_voice" text NOT NULL,
	"us_voice" text NOT NULL,
	"uk_voice" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
