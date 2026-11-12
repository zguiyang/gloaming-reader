CREATE TABLE "reading_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"seconds" integer NOT NULL,
	"local_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reading_heartbeat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade,
	CONSTRAINT "reading_heartbeat_identity_uidx" UNIQUE("user_id","session_id","sequence_number")
);
--> statement-breakpoint
CREATE INDEX "reading_heartbeat_created_at_idx" ON "reading_heartbeat" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "reading_heartbeat_user_created_at_idx" ON "reading_heartbeat" USING btree ("user_id","created_at");
