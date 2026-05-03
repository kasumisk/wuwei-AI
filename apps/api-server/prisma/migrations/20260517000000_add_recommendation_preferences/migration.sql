-- AlterTable: add recommendation_preferences to user_profiles
-- This column was added to schema.prisma without a migration file; backfilling here.
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "recommendation_preferences" JSONB NOT NULL DEFAULT '{}';
