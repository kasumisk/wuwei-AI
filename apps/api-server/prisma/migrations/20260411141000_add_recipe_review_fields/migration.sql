-- V6.3 P3-4: Recipe UGC review workflow fields
ALTER TABLE "recipes"
ADD COLUMN IF NOT EXISTS "review_status" VARCHAR(20) NOT NULL DEFAULT 'approved',
ADD COLUMN IF NOT EXISTS "submitted_by" UUID,
ADD COLUMN IF NOT EXISTS "reviewed_by" UUID,
ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "review_note" TEXT;

CREATE INDEX IF NOT EXISTS "idx_recipes_review_status" ON "recipes"("review_status");
