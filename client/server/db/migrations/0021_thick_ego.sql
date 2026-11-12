ALTER TABLE "category" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "tag" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;