CREATE TABLE "uploaded_object" (
	"id" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"ref_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uploaded_object_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE INDEX "uploaded_object_storage_key_idx" ON "uploaded_object" USING btree ("storage_key");