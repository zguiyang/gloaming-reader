ALTER TABLE "tag" ADD COLUMN "localized_names" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "localized_names" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "localized_names" jsonb DEFAULT '{}'::jsonb NOT NULL;
