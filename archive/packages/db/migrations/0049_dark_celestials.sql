CREATE TABLE "public_classification_budget" (
	"id" text PRIMARY KEY NOT NULL,
	"quota_date" date,
	"quota_used" integer DEFAULT 0 NOT NULL,
	"quota_reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "public_classification_budget_quota_nonnegative_chk" CHECK ("public_classification_budget"."quota_used" >= 0 AND "public_classification_budget"."quota_reserved" >= 0),
	CONSTRAINT "public_classification_budget_quota_limit_chk" CHECK ("public_classification_budget"."quota_used" + "public_classification_budget"."quota_reserved" <= 50)
);
