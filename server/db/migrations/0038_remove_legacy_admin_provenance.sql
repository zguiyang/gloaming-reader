ALTER TABLE "reading_work" ALTER COLUMN "origin_kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reading_work" ALTER COLUMN "origin_kind" DROP NOT NULL;--> statement-breakpoint
UPDATE "reading_work"
SET "origin_kind" = NULL
WHERE "origin_kind" IN ('admin_epub', 'admin_text');--> statement-breakpoint
ALTER TABLE "reading_work"
ADD CONSTRAINT "reading_work_origin_kind_check"
CHECK ("origin_kind" IS NULL OR "origin_kind" = 'user_epub');
