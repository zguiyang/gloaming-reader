UPDATE "ai_invocation_log"
SET "request_summary" = "request_summary" - 'selectionPreview' - 'selection_preview'
WHERE "request_summary" ?| ARRAY['selectionPreview', 'selection_preview'];
--> statement-breakpoint
UPDATE "ai_invocation_log"
SET "response_summary" = "response_summary" - 'replyPreview' - 'reply_preview'
WHERE "response_summary" ?| ARRAY['replyPreview', 'reply_preview'];
--> statement-breakpoint
UPDATE "ai_invocation_log"
SET "error_message" = CASE WHEN "status" = 'failure' THEN 'AI invocation failed' ELSE NULL END
WHERE "error_message" IS NOT NULL;
--> statement-breakpoint
UPDATE "tts_invocation_log"
SET "error_message" = CASE WHEN "status" = 'failure' THEN 'TTS invocation failed' ELSE NULL END
WHERE "error_message" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "tts_invocation_log" DROP COLUMN "text_preview";
