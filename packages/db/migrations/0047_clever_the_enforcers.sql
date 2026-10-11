CREATE TABLE "public_category" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text DEFAULT 'manual' NOT NULL,
	"source_locale" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "public_category_created_by_check" CHECK ("public_category"."created_by" in ('manual', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "public_category_label" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"edited_by" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "public_category_label_category_locale_uidx" UNIQUE("category_id","locale"),
	CONSTRAINT "public_category_label_locale_normalized_name_uidx" UNIQUE("locale","normalized_name"),
	CONSTRAINT "public_category_label_edited_by_check" CHECK ("public_category_label"."edited_by" in ('manual', 'ai')),
	CONSTRAINT "public_category_label_name_nonempty_chk" CHECK (length("public_category_label"."name") > 0),
	CONSTRAINT "public_category_label_normalized_name_nonempty_chk" CHECK (length("public_category_label"."normalized_name") > 0)
);
--> statement-breakpoint
CREATE TABLE "source_record_public_category" (
	"id" text PRIMARY KEY NOT NULL,
	"source_record_id" text NOT NULL,
	"category_id" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_record_public_category_record_category_uidx" UNIQUE("source_record_id","category_id"),
	CONSTRAINT "source_record_public_category_source_check" CHECK ("source_record_public_category"."source" in ('manual', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "source_record_public_category_suppression" (
	"source_record_id" text NOT NULL,
	"category_id" text NOT NULL,
	"removed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_record_public_category_suppression_record_category_uidx" UNIQUE("source_record_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "public_category_label" ADD CONSTRAINT "public_category_label_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."public_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record_public_category" ADD CONSTRAINT "source_record_public_category_record_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record_public_category" ADD CONSTRAINT "source_record_public_category_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."public_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record_public_category_suppression" ADD CONSTRAINT "source_record_public_category_suppression_record_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record_public_category_suppression" ADD CONSTRAINT "source_record_public_category_suppression_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."public_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_record_public_category_category_idx" ON "source_record_public_category" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "source_record_public_category_suppression_category_idx" ON "source_record_public_category_suppression" USING btree ("category_id");