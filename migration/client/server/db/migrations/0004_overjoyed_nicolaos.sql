CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"surface" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"preview" text DEFAULT '' NOT NULL,
	"ended_at" timestamp,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"status" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_user_last_msg_idx" ON "conversation" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_user_scope_last_idx" ON "conversation" USING btree ("user_id","surface","subject_type","subject_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_user_open_idx" ON "conversation" USING btree ("user_id","surface","subject_type","subject_id") WHERE "conversation"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "conversation_message_conv_created_idx" ON "conversation_message" USING btree ("conversation_id","created_at");