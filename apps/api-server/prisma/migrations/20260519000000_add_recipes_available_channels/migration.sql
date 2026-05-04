-- recipes.available_channels was defined in Prisma schema but never added to the database.
-- Adding it here retroactively to resolve schema drift.

ALTER TABLE "recipes"
  ADD COLUMN IF NOT EXISTS "available_channels" JSONB NOT NULL DEFAULT '["home_cook"]';
