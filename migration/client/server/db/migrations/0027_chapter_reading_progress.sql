ALTER TABLE "reading_state" ADD COLUMN "completed_through_sort_order" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
UPDATE "reading_state" AS rs
SET "completed_through_sort_order" = sub.max_sort
FROM (
  SELECT rp.work_id, MAX(rp.sort_order) AS max_sort
  FROM reading_part AS rp
  GROUP BY rp.work_id
) AS sub
WHERE rs.work_id = sub.work_id
  AND rs.status = 'completed';--> statement-breakpoint
UPDATE "reading_state" AS rs
SET "completed_through_sort_order" = rp.sort_order - 1
FROM reading_part AS rp
WHERE rp.id = rs.current_part_id
  AND rs.status = 'in_progress'
  AND rs.current_part_id IS NOT NULL;--> statement-breakpoint
