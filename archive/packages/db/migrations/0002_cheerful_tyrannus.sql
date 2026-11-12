CREATE TABLE "practice_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"article_id" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"current_index" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_item" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"correct_option_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "practice_item_article_sort_uidx" UNIQUE("article_id","sort_order")
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"article_id" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"progress_ratio" integer DEFAULT 0 NOT NULL,
	"last_read_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_user_article_uidx" UNIQUE("user_id","article_id")
);
--> statement-breakpoint
ALTER TABLE "practice_attempt" ADD CONSTRAINT "practice_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempt" ADD CONSTRAINT "practice_attempt_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_item" ADD CONSTRAINT "practice_item_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "practice_attempt_one_in_progress_uidx" ON "practice_attempt" USING btree ("user_id","article_id") WHERE "practice_attempt"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "practice_attempt_user_idx" ON "practice_attempt" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "practice_attempt_article_idx" ON "practice_attempt" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "practice_item_article_idx" ON "practice_item" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "reading_progress_user_last_read_idx" ON "reading_progress" USING btree ("user_id","last_read_at");--> statement-breakpoint
CREATE INDEX "reading_progress_article_idx" ON "reading_progress" USING btree ("article_id");