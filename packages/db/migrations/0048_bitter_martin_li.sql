CREATE TABLE "public_category_alias" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"locale" text NOT NULL,
	"alias" text NOT NULL,
	"normalized_name" text NOT NULL,
	"edited_by" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "public_category_alias_category_locale_normalized_uidx" UNIQUE("category_id","locale","normalized_name"),
	CONSTRAINT "public_category_alias_locale_normalized_name_uidx" UNIQUE("locale","normalized_name"),
	CONSTRAINT "public_category_alias_edited_by_check" CHECK ("public_category_alias"."edited_by" in ('manual', 'ai')),
	CONSTRAINT "public_category_alias_nonempty_chk" CHECK (length("public_category_alias"."alias") > 0),
	CONSTRAINT "public_category_alias_normalized_name_nonempty_chk" CHECK (length("public_category_alias"."normalized_name") > 0)
);
--> statement-breakpoint
ALTER TABLE "public_category" ADD COLUMN "meaning" text;--> statement-breakpoint
ALTER TABLE "public_category_alias" ADD CONSTRAINT "public_category_alias_category_fk" FOREIGN KEY ("category_id") REFERENCES "public"."public_category"("id") ON DELETE cascade ON UPDATE no action;