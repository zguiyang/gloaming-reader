CREATE TABLE "source_category_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"source_value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"suggestion" jsonb,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "source_category_mapping_source_value_uidx" UNIQUE("source_id","normalized_value"),
	CONSTRAINT "source_category_mapping_status_check" CHECK ("source_category_mapping"."status" in ('pending', 'review', 'confirmed', 'ignored')),
	CONSTRAINT "source_category_mapping_value_check" CHECK (length("source_category_mapping"."normalized_value") > 0)
);
--> statement-breakpoint
CREATE TABLE "source_category_mapping_category" (
	"mapping_id" text NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "source_category_mapping_category_uidx" UNIQUE("mapping_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "source_category_mapping" ADD CONSTRAINT "source_category_mapping_source_id_discovery_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."discovery_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_category_mapping_category" ADD CONSTRAINT "source_category_mapping_category_mapping_id_source_category_mapping_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."source_category_mapping"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_category_mapping_category" ADD CONSTRAINT "source_category_mapping_category_category_id_public_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."public_category"("id") ON DELETE restrict ON UPDATE no action;