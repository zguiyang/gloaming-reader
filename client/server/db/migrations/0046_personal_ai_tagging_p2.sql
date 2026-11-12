CREATE TABLE "user_personal_tag_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"quota_date" date,
	"quota_used" integer DEFAULT 0 NOT NULL,
	"quota_reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_personal_tag_preference_generation_nonnegative_chk" CHECK ("user_personal_tag_preference"."generation" >= 0),
	CONSTRAINT "user_personal_tag_preference_quota_nonnegative_chk" CHECK ("user_personal_tag_preference"."quota_used" >= 0 AND "user_personal_tag_preference"."quota_reserved" >= 0),
	CONSTRAINT "user_personal_tag_preference_quota_limit_chk" CHECK ("user_personal_tag_preference"."quota_used" + "user_personal_tag_preference"."quota_reserved" <= 10)
);
--> statement-breakpoint
ALTER TABLE "user_personal_tag_preference" ADD CONSTRAINT "user_personal_tag_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "user_work_tag_suppression" (
	"user_id" text NOT NULL,
	"work_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"removed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_work_tag_suppression_user_work_tag_uidx" UNIQUE("user_id","work_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "user_work_tag_suppression" ADD CONSTRAINT "user_work_tag_suppression_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_work_tag_suppression" ADD CONSTRAINT "user_work_tag_suppression_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_work_tag_suppression" ADD CONSTRAINT "user_work_tag_suppression_user_tag_fk" FOREIGN KEY ("user_id","tag_id") REFERENCES "public"."user_tag"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "user_personal_tag_run" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"work_id" text NOT NULL,
	"generation" integer NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_personal_tag_run_user_work_generation_uidx" UNIQUE("user_id","work_id","generation"),
	CONSTRAINT "user_personal_tag_run_state_check" CHECK ("user_personal_tag_run"."state" in ('queued', 'processing', 'completed', 'skipped', 'failed')),
	CONSTRAINT "user_personal_tag_run_attempts_nonnegative_chk" CHECK ("user_personal_tag_run"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_personal_tag_run" ADD CONSTRAINT "user_personal_tag_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_personal_tag_run" ADD CONSTRAINT "user_personal_tag_run_work_id_reading_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."reading_work"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_personal_tag_run_state_idx" ON "user_personal_tag_run" USING btree ("state");--> statement-breakpoint
ALTER TABLE "user_tag" ADD COLUMN "created_by" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_tag" ADD CONSTRAINT "user_tag_created_by_check" CHECK ("user_tag"."created_by" in ('manual', 'ai'));--> statement-breakpoint
ALTER TABLE "user_work_tag" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_work_tag" ADD CONSTRAINT "user_work_tag_source_check" CHECK ("user_work_tag"."source" in ('manual', 'ai'));
