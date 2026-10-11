ALTER TABLE "user_tag" ADD COLUMN "source_locale" text;--> statement-breakpoint
ALTER TABLE "user_tag" ADD COLUMN "localized_names" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_tag" ADD COLUMN "user_edited_locales" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "user_tag"
    GROUP BY
      "user_id",
      lower(
        btrim(
          regexp_replace(
            normalize("name", NFC),
            U&'[[:space:]\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',
            ' ',
            'g'
          )
        ) COLLATE "und-x-icu"
      )
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'User Tag names collide under Unicode NFC normalization; resolve duplicate names before applying migration 0045';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "user_tag" DROP CONSTRAINT "user_tag_user_normalized_name_uidx";--> statement-breakpoint
UPDATE "user_tag"
SET "normalized_name" = lower(
  btrim(
    regexp_replace(
      normalize("name", NFC),
      U&'[[:space:]\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',
      ' ',
      'g'
    )
  ) COLLATE "und-x-icu"
);--> statement-breakpoint
ALTER TABLE "user_tag" ADD CONSTRAINT "user_tag_user_normalized_name_uidx" UNIQUE ("user_id", "normalized_name");
