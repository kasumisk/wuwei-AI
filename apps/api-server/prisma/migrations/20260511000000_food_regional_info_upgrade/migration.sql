-- Upgrade food_regional_info from coarse regional metadata to scoped regional intelligence.

DO $$ BEGIN
  CREATE TYPE "food_availability_enum" AS ENUM ('year_round', 'seasonal', 'rare', 'limited', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "food_regional_info"
  DROP CONSTRAINT IF EXISTS "UQ_41a17bad128becea48895910fa6",
  DROP CONSTRAINT IF EXISTS "UQ_food_regional_info_scope";

DROP INDEX IF EXISTS "IDX_food_regional_info_region";
DROP INDEX IF EXISTS "IDX_food_regional_info_country";
DROP INDEX IF EXISTS "IDX_food_regional_info_country_region";
DROP INDEX IF EXISTS "UQ_food_regional_info_scope";

ALTER TABLE "food_regional_info"
  DROP COLUMN IF EXISTS "region",
  DROP COLUMN IF EXISTS "local_price_range",
  DROP COLUMN IF EXISTS "availability";

ALTER TABLE "food_regional_info"
  ADD COLUMN IF NOT EXISTS "country_code" VARCHAR(2),
  ADD COLUMN IF NOT EXISTS "region_code" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "city_code" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "price_min" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "price_max" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "currency_code" VARCHAR(3),
  ADD COLUMN IF NOT EXISTS "price_unit" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "availability" "food_availability_enum" NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "seasonality_confidence" DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "source" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "source_url" TEXT,
  ADD COLUMN IF NOT EXISTS "source_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) DEFAULT now();

ALTER TABLE "food_regional_info"
  ALTER COLUMN "country_code" SET NOT NULL,
  ALTER COLUMN "updated_at" SET NOT NULL;

CREATE UNIQUE INDEX "UQ_food_regional_info_scope"
  ON "food_regional_info" ("food_id", "country_code", "region_code", "city_code")
  NULLS NOT DISTINCT;

CREATE INDEX "IDX_food_regional_info_country"
  ON "food_regional_info" ("country_code");

CREATE INDEX "IDX_food_regional_info_country_region"
  ON "food_regional_info" ("country_code", "region_code");
