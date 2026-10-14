-- Forward-only repair: clear the removed budget deferral so eligible records retry on the next dispatch pass.
UPDATE "source_record_public_classification_state"
SET "last_deferred_reason" = NULL, "next_attempt_at" = now()
WHERE "last_deferred_reason" = 'budget_unavailable';--> statement-breakpoint
-- Forward-only repair: requeue runs that were blocked only by the removed daily quota and are still authorized.
UPDATE "user_personal_tag_run" AS r
SET "state" = 'queued', "attempts" = 0, "error_code" = NULL, "updated_at" = now()
FROM "user_personal_tag_preference" AS p, "reading_work" AS w
WHERE r."state" = 'skipped'
  AND r."error_code" = 'daily_limit_reached'
  AND p."user_id" = r."user_id"
  AND p."enabled" = true
  AND p."generation" = r."generation"
  AND w."id" = r."work_id"
  AND w."owner_user_id" = r."user_id"
  AND w."origin_kind" = 'user_epub'
  AND w."processing_status" = 'ready';--> statement-breakpoint
-- Forward-only repair: preserved skips get a current reason; the removed quota code is never retained.
UPDATE "user_personal_tag_run" AS r
SET "error_code" = CASE
      WHEN EXISTS (
        SELECT 1
        FROM "user_personal_tag_preference" AS p
        WHERE p."user_id" = r."user_id"
          AND p."enabled" = true
          AND p."generation" = r."generation"
      ) THEN 'work_not_eligible'
      ELSE 'authorization_expired'
    END,
    "updated_at" = now()
WHERE r."state" = 'skipped'
  AND r."error_code" = 'daily_limit_reached';--> statement-breakpoint
DROP TABLE "public_classification_budget";--> statement-breakpoint
ALTER TABLE "user_personal_tag_preference" DROP CONSTRAINT "user_personal_tag_preference_quota_nonnegative_chk";--> statement-breakpoint
ALTER TABLE "user_personal_tag_preference" DROP CONSTRAINT "user_personal_tag_preference_quota_limit_chk";--> statement-breakpoint
ALTER TABLE "user_personal_tag_preference" DROP COLUMN "quota_date";--> statement-breakpoint
ALTER TABLE "user_personal_tag_preference" DROP COLUMN "quota_used";--> statement-breakpoint
ALTER TABLE "user_personal_tag_preference" DROP COLUMN "quota_reserved";
