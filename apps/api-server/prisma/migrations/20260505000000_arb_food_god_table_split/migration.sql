-- ============================================================================
-- Migration: ARB 2026-04 — Food god-table split (Phase 1: shadow tables)
-- ============================================================================
-- Strategy: SHADOW SPLIT (a.k.a. dual-write friendly)
--   * Create 4 new domain tables, each 1:1 with `foods` (food_id UNIQUE FK).
--   * Backfill from existing `foods` rows via INSERT ... SELECT.
--   * DO NOT drop any column on `foods` in this phase.
--   * Existing reads keep working; new writes can target either side until
--     a future phase migrates the read path and drops the legacy columns.
--
-- Safety:
--   * Zero data loss: source rows in `foods` are untouched.
--   * Idempotent: ON CONFLICT (food_id) DO NOTHING prevents double-backfill
--     if this migration is re-run on a partially-populated environment.
--   * Cascade: all 4 child tables ON DELETE CASCADE so deleting a food cleans
--     up its split rows.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. food_nutrition_details (微量营养与精细化营养)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "food_nutrition_details" (
    "id"               UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "food_id"          UUID         NOT NULL,
    "vitamin_a"        DECIMAL(7,1),
    "vitamin_c"        DECIMAL(6,1),
    "vitamin_d"        DECIMAL(5,2),
    "vitamin_e"        DECIMAL(5,2),
    "vitamin_b6"       DECIMAL(5,2),
    "vitamin_b12"      DECIMAL(5,2),
    "folate"           DECIMAL(6,1),
    "zinc"             DECIMAL(5,2),
    "magnesium"        DECIMAL(6,1),
    "phosphorus"       DECIMAL(7,1),
    "purine"           DECIMAL(7,1),
    "cholesterol"      DECIMAL(6,1),
    "saturated_fat"    DECIMAL(5,1),
    "trans_fat"        DECIMAL(5,2),
    "omega3"           DECIMAL(7,1),
    "omega6"           DECIMAL(7,1),
    "added_sugar"      DECIMAL(5,1),
    "natural_sugar"    DECIMAL(5,1),
    "soluble_fiber"    DECIMAL(5,1),
    "insoluble_fiber"  DECIMAL(5,1),
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "food_nutrition_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "food_nutrition_details_food_id_key" ON "food_nutrition_details"("food_id");

ALTER TABLE "food_nutrition_details"
    ADD CONSTRAINT "food_nutrition_details_food_id_fkey"
    FOREIGN KEY ("food_id") REFERENCES "foods"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

-- Backfill (idempotent via NOT EXISTS guard)
INSERT INTO "food_nutrition_details" (
    food_id, vitamin_a, vitamin_c, vitamin_d, vitamin_e, vitamin_b6, vitamin_b12,
    folate, zinc, magnesium, phosphorus, purine, cholesterol,
    saturated_fat, trans_fat, omega3, omega6,
    added_sugar, natural_sugar, soluble_fiber, insoluble_fiber
)
SELECT
    f.id, f.vitamin_a, f.vitamin_c, f.vitamin_d, f.vitamin_e, f.vitamin_b6, f.vitamin_b12,
    f.folate, f.zinc, f.magnesium, f.phosphorus, f.purine, f.cholesterol,
    f.saturated_fat, f.trans_fat, f.omega3, f.omega6,
    f.added_sugar, f.natural_sugar, f.soluble_fiber, f.insoluble_fiber
FROM "foods" f
WHERE NOT EXISTS (
    SELECT 1 FROM "food_nutrition_details" d WHERE d.food_id = f.id
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. food_health_assessments (健康评估)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "food_health_assessments" (
    "id"                UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "food_id"           UUID         NOT NULL,
    "glycemic_index"    INTEGER,
    "glycemic_load"     DECIMAL(5,1),
    "is_processed"      BOOLEAN,
    "is_fried"          BOOLEAN,
    "processing_level"  INTEGER,
    "fodmap_level"      VARCHAR(10),
    "oxalate_level"     VARCHAR(10),
    "quality_score"     DECIMAL(3,1),
    "satiety_score"     DECIMAL(3,1),
    "nutrient_density"  DECIMAL(5,1),
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "food_health_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "food_health_assessments_food_id_key" ON "food_health_assessments"("food_id");
CREATE INDEX "idx_food_health_quality_score"   ON "food_health_assessments"("quality_score");
CREATE INDEX "idx_food_health_processing_level" ON "food_health_assessments"("processing_level");

ALTER TABLE "food_health_assessments"
    ADD CONSTRAINT "food_health_assessments_food_id_fkey"
    FOREIGN KEY ("food_id") REFERENCES "foods"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

INSERT INTO "food_health_assessments" (
    food_id, glycemic_index, glycemic_load, is_processed, is_fried,
    processing_level, fodmap_level, oxalate_level,
    quality_score, satiety_score, nutrient_density
)
SELECT
    f.id, f.glycemic_index, f.glycemic_load, f.is_processed, f.is_fried,
    f.processing_level, f.fodmap_level, f.oxalate_level,
    f.quality_score, f.satiety_score, f.nutrient_density
FROM "foods" f
WHERE NOT EXISTS (
    SELECT 1 FROM "food_health_assessments" h WHERE h.food_id = f.id
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. food_taxonomies (分类/标签/兼容性)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "food_taxonomies" (
    "id"                 UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "food_id"            UUID         NOT NULL,
    "meal_types"         JSONB        NOT NULL DEFAULT '[]',
    "tags"               JSONB        NOT NULL DEFAULT '[]',
    "allergens"          JSONB        NOT NULL DEFAULT '[]',
    "compatibility"      JSONB        NOT NULL DEFAULT '{}',
    "available_channels" JSONB        NOT NULL DEFAULT '["home_cook","restaurant","delivery","convenience"]',
    "flavor_profile"     JSONB,
    "texture_tags"       TEXT[]       NOT NULL DEFAULT '{}',
    "cuisine"            VARCHAR(100),
    "dish_type"          VARCHAR(30),
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "food_taxonomies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "food_taxonomies_food_id_key" ON "food_taxonomies"("food_id");
CREATE INDEX "idx_food_taxonomy_meal_types_gin" ON "food_taxonomies" USING GIN ("meal_types");
CREATE INDEX "idx_food_taxonomy_tags_gin"       ON "food_taxonomies" USING GIN ("tags");
CREATE INDEX "idx_food_taxonomy_allergens_gin"  ON "food_taxonomies" USING GIN ("allergens");
CREATE INDEX "idx_food_taxonomy_cuisine"        ON "food_taxonomies"("cuisine");

ALTER TABLE "food_taxonomies"
    ADD CONSTRAINT "food_taxonomies_food_id_fkey"
    FOREIGN KEY ("food_id") REFERENCES "foods"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

INSERT INTO "food_taxonomies" (
    food_id, meal_types, tags, allergens, compatibility, available_channels,
    flavor_profile, texture_tags, cuisine, dish_type
)
SELECT
    f.id,
    COALESCE(f.meal_types,         '[]'::jsonb),
    COALESCE(f.tags,               '[]'::jsonb),
    COALESCE(f.allergens,          '[]'::jsonb),
    COALESCE(f.compatibility,      '{}'::jsonb),
    COALESCE(f.available_channels, '["home_cook","restaurant","delivery","convenience"]'::jsonb),
    f.flavor_profile,
    COALESCE(f.texture_tags, ARRAY[]::TEXT[]),
    f.cuisine,
    f.dish_type
FROM "foods" f
WHERE NOT EXISTS (
    SELECT 1 FROM "food_taxonomies" t WHERE t.food_id = f.id
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. food_portion_guides (份量 / 烹饪 / 操作)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "food_portion_guides" (
    "id"                    UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "food_id"               UUID         NOT NULL,
    "standard_serving_g"    INTEGER      NOT NULL DEFAULT 100,
    "standard_serving_desc" VARCHAR(1000),
    "common_portions"       JSONB        NOT NULL DEFAULT '[]',
    "cooking_methods"       TEXT[]       NOT NULL DEFAULT '{}',
    "required_equipment"    TEXT[]       NOT NULL DEFAULT '{}',
    "prep_time_minutes"     INTEGER,
    "cook_time_minutes"     INTEGER,
    "skill_required"        VARCHAR(20),
    "serving_temperature"   VARCHAR(30),
    "estimated_cost_level"  INTEGER,
    "shelf_life_days"       INTEGER,
    "water_content_percent" DECIMAL(5,2),
    "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "food_portion_guides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "food_portion_guides_food_id_key" ON "food_portion_guides"("food_id");
CREATE INDEX "idx_food_portion_cooking_methods" ON "food_portion_guides" USING GIN ("cooking_methods");

ALTER TABLE "food_portion_guides"
    ADD CONSTRAINT "food_portion_guides_food_id_fkey"
    FOREIGN KEY ("food_id") REFERENCES "foods"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

INSERT INTO "food_portion_guides" (
    food_id, standard_serving_g, standard_serving_desc, common_portions,
    cooking_methods, required_equipment, prep_time_minutes, cook_time_minutes,
    skill_required, serving_temperature, estimated_cost_level,
    shelf_life_days, water_content_percent
)
SELECT
    f.id,
    COALESCE(f.standard_serving_g, 100),
    f.standard_serving_desc,
    COALESCE(f.common_portions,    '[]'::jsonb),
    COALESCE(f.cooking_methods,    ARRAY[]::TEXT[]),
    COALESCE(f.required_equipment, ARRAY[]::TEXT[]),
    f.prep_time_minutes,
    f.cook_time_minutes,
    f.skill_required,
    f.serving_temperature,
    f.estimated_cost_level,
    f.shelf_life_days,
    f.water_content_percent
FROM "foods" f
WHERE NOT EXISTS (
    SELECT 1 FROM "food_portion_guides" p WHERE p.food_id = f.id
);

-- ============================================================================
-- End of migration. Validation suggestions (run manually if desired):
--   SELECT (SELECT COUNT(*) FROM foods)                  AS total_foods,
--          (SELECT COUNT(*) FROM food_nutrition_details) AS nutrition_rows,
--          (SELECT COUNT(*) FROM food_health_assessments) AS health_rows,
--          (SELECT COUNT(*) FROM food_taxonomies)        AS taxonomy_rows,
--          (SELECT COUNT(*) FROM food_portion_guides)    AS portion_rows;
--   All four counts should equal total_foods.
-- ============================================================================
