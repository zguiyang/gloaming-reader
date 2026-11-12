ALTER TABLE "learner_day" RENAME TO "reading_day";--> statement-breakpoint
ALTER TABLE "reading_day" RENAME CONSTRAINT "learner_day_user_date_uidx" TO "reading_day_user_date_uidx";--> statement-breakpoint
ALTER TABLE "reading_day" RENAME CONSTRAINT "learner_day_user_id_user_id_fk" TO "reading_day_user_id_user_id_fk";
