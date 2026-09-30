CREATE TABLE "user_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_tag_user_normalized_name_uidx" UNIQUE("user_id","normalized_name"),
	CONSTRAINT "user_tag_user_id_id_uidx" UNIQUE("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "user_tag" ADD CONSTRAINT "user_tag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "user_tag_user_idx" ON "user_tag" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "user_work_tag" (
	"user_id" text NOT NULL,
	"work_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "user_work_tag_user_work_tag_uidx" UNIQUE("user_id","work_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "user_work_tag" ADD CONSTRAINT "user_work_tag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_work_tag" ADD CONSTRAINT "user_work_tag_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_work_tag" ADD CONSTRAINT "user_work_tag_user_tag_fk" FOREIGN KEY ("user_id","tag_id") REFERENCES "public"."user_tag"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "user_work_tag_user_work_idx" ON "user_work_tag" USING btree ("user_id","work_id");
--> statement-breakpoint
CREATE INDEX "user_work_tag_user_tag_idx" ON "user_work_tag" USING btree ("user_id","tag_id");
