-- Migrate single-track article_audio rows to composite (article_id, role) PK.
UPDATE "article_audio" SET "role" = 'us' WHERE "role" IS NULL OR "role" NOT IN ('us', 'uk');
--> statement-breakpoint
ALTER TABLE "article_audio" DROP CONSTRAINT "article_audio_pkey";
--> statement-breakpoint
ALTER TABLE "article_audio" ALTER COLUMN "role" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "article_audio" ADD CONSTRAINT "article_audio_article_id_role_pk" PRIMARY KEY("article_id","role");
