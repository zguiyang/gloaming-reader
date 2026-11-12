CREATE TABLE "learner_day" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "learner_day_user_date_uidx" UNIQUE("user_id","local_date")
);
--> statement-breakpoint
ALTER TABLE "learner_day" ADD CONSTRAINT "learner_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;