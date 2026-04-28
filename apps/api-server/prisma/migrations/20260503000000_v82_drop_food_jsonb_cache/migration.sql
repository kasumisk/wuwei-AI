-- V8.2 follow-up: drop foods jsonb cache columns after provenance cutover
-- Preconditions:
--   1. All success/failure source writes have been switched to food_field_provenance
--   2. verify-food-infra.ts passes on staging before applying to higher envs

ALTER TABLE "foods"
  DROP COLUMN IF EXISTS "field_sources",
  DROP COLUMN IF EXISTS "field_confidence";
