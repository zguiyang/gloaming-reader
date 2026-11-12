CREATE TABLE "review_item" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	"kind" text NOT NULL,
	"sentence" text NOT NULL,
	"focus" text NOT NULL,
	"options" jsonb NOT NULL,
	"hint_zh" text NOT NULL,
	"correct_option_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_item_article_sort_uidx" UNIQUE("article_id","sort_order")
);
--> statement-breakpoint
CREATE TABLE "review_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" date NOT NULL,
	"source" text NOT NULL,
	"outcome" text DEFAULT 'in_progress' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_session_user_date_uidx" UNIQUE("user_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "review_session_item" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"review_item_id" text,
	"sort_order" integer NOT NULL,
	"article_id" text NOT NULL,
	"article_title" text NOT NULL,
	"article_body" text NOT NULL,
	"kind" text NOT NULL,
	"sentence" text NOT NULL,
	"focus" text NOT NULL,
	"options" jsonb NOT NULL,
	"hint_zh" text NOT NULL,
	"correct_option_index" integer NOT NULL,
	"selected_index" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_session_item_session_sort_uidx" UNIQUE("session_id","sort_order")
);
--> statement-breakpoint
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_session" ADD CONSTRAINT "review_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_session_item" ADD CONSTRAINT "review_session_item_session_id_review_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."review_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_session_item" ADD CONSTRAINT "review_session_item_review_item_id_review_item_id_fk" FOREIGN KEY ("review_item_id") REFERENCES "public"."review_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_item_article_idx" ON "review_item" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "review_session_date_idx" ON "review_session" USING btree ("local_date");--> statement-breakpoint
CREATE INDEX "review_session_item_session_idx" ON "review_session_item" USING btree ("session_id");