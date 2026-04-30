-- Keep existing translation rows, but stop treating serving_desc as authoritative serving data.
-- New AI translations are tracked by source / quality / review_status.

DO $$ BEGIN
  CREATE TYPE "translation_review_status_enum" AS ENUM (
    'PENDING',
    'AI_GENERATED',
    'REVIEWED',
    'VERIFIED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "food_translations"
  ADD COLUMN IF NOT EXISTS "source" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "quality" DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "review_status" "translation_review_status_enum" NOT NULL DEFAULT 'PENDING';

ALTER TABLE "food_translations"
  ALTER COLUMN "updated_at" SET DEFAULT now(),
  ALTER COLUMN "updated_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "IDX_food_translations_review_status"
  ON "food_translations" ("review_status");
