ALTER TABLE "article_audio" RENAME COLUMN "redis_key" TO "storage_key";
--> statement-breakpoint
ALTER TABLE "article_audio" ADD COLUMN "word_timings" jsonb DEFAULT '[]'::jsonb NOT NULL;
