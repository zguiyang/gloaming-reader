CREATE TABLE "part_audio_segment" (
	"id" text PRIMARY KEY NOT NULL,
	"part_id" text NOT NULL,
	"role" text NOT NULL,
	"scope_key" text NOT NULL,
	"owner_user_id" text,
	"config_fingerprint" text NOT NULL,
	"segment_index" integer NOT NULL,
	"segment_key" text NOT NULL,
	"segment_hash" text NOT NULL,
	"paragraph_anchor" text NOT NULL,
	"paragraph_text_offset" integer DEFAULT 0 NOT NULL,
	"text_length" integer NOT NULL,
	"voice" text NOT NULL,
	"mime_type" text DEFAULT 'audio/mpeg' NOT NULL,
	"duration_ms" integer,
	"word_timings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"generation_token" text,
	"lease_expires_at" timestamp,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "part_audio_segment_role_check" CHECK ("part_audio_segment"."role" in ('us', 'uk')),
	CONSTRAINT "part_audio_segment_status_check" CHECK ("part_audio_segment"."status" in ('generating', 'ready', 'failed')),
	CONSTRAINT "part_audio_segment_segment_hash_nonempty_chk" CHECK (length("part_audio_segment"."segment_hash") > 0),
	CONSTRAINT "part_audio_segment_scope_key_nonempty_chk" CHECK (length("part_audio_segment"."scope_key") > 0)
);
--> statement-breakpoint
ALTER TABLE "part_audio_segment" ADD CONSTRAINT "part_audio_segment_part_id_reading_part_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."reading_part"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_audio_segment" ADD CONSTRAINT "part_audio_segment_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "part_audio_segment_identity_uidx" ON "part_audio_segment" USING btree ("part_id","role","scope_key","config_fingerprint","segment_hash");--> statement-breakpoint
CREATE INDEX "part_audio_segment_part_segment_idx" ON "part_audio_segment" USING btree ("part_id","role","segment_index");--> statement-breakpoint
CREATE INDEX "part_audio_segment_lease_idx" ON "part_audio_segment" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "part_audio_segment_token_uidx" ON "part_audio_segment" USING btree ("generation_token") WHERE "part_audio_segment"."generation_token" is not null;