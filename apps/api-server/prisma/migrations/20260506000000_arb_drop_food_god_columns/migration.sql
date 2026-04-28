-- ARB-2026-04: Food 上帝表拆分 — 删除主表已迁移列
--
-- 前置条件（已满足）：
--   1. 拆分表已创建（migration 20260505000000_arb_food_god_table_split）
--   2. 存量数据已全量回填（foods:1441 = nutrition:1441 = health:1441 = taxonomy:1441 = portion:1441）
--   3. 所有写入路径已加双写（food-library / food-enrichment / food-pipeline-orchestrator）
--   4. 读取路径已改为优先读拆分表（extractNutrition / extractCooking）
--   5. 编译零错误
--
-- 拆分策略：4 张 1:1 拆分表，ON DELETE CASCADE，主表列在此 migration 中正式下线

-- ─── food_nutrition_details 已接管的列 ────────────────────────────────────────
ALTER TABLE "foods"
  DROP COLUMN IF EXISTS "vitamin_a",
  DROP COLUMN IF EXISTS "vitamin_c",
  DROP COLUMN IF EXISTS "vitamin_d",
  DROP COLUMN IF EXISTS "vitamin_e",
  DROP COLUMN IF EXISTS "vitamin_b6",
  DROP COLUMN IF EXISTS "vitamin_b12",
  DROP COLUMN IF EXISTS "folate",
  DROP COLUMN IF EXISTS "zinc",
  DROP COLUMN IF EXISTS "magnesium",
  DROP COLUMN IF EXISTS "phosphorus",
  DROP COLUMN IF EXISTS "purine",
  DROP COLUMN IF EXISTS "cholesterol",
  DROP COLUMN IF EXISTS "saturated_fat",
  DROP COLUMN IF EXISTS "trans_fat",
  DROP COLUMN IF EXISTS "omega3",
  DROP COLUMN IF EXISTS "omega6",
  DROP COLUMN IF EXISTS "added_sugar",
  DROP COLUMN IF EXISTS "natural_sugar",
  DROP COLUMN IF EXISTS "soluble_fiber",
  DROP COLUMN IF EXISTS "insoluble_fiber";

-- ─── food_health_assessments 已接管的列 ──────────────────────────────────────
ALTER TABLE "foods"
  DROP COLUMN IF EXISTS "glycemic_index",
  DROP COLUMN IF EXISTS "glycemic_load",
  DROP COLUMN IF EXISTS "is_processed",
  DROP COLUMN IF EXISTS "is_fried",
  DROP COLUMN IF EXISTS "processing_level",
  DROP COLUMN IF EXISTS "fodmap_level",
  DROP COLUMN IF EXISTS "oxalate_level",
  DROP COLUMN IF EXISTS "quality_score",
  DROP COLUMN IF EXISTS "satiety_score",
  DROP COLUMN IF EXISTS "nutrient_density";

-- ─── food_taxonomies 已接管的列 ──────────────────────────────────────────────
ALTER TABLE "foods"
  DROP COLUMN IF EXISTS "meal_types",
  DROP COLUMN IF EXISTS "tags",
  DROP COLUMN IF EXISTS "allergens",
  DROP COLUMN IF EXISTS "compatibility",
  DROP COLUMN IF EXISTS "available_channels",
  DROP COLUMN IF EXISTS "flavor_profile",
  DROP COLUMN IF EXISTS "texture_tags",
  DROP COLUMN IF EXISTS "cuisine",
  DROP COLUMN IF EXISTS "dish_type";

-- ─── food_portion_guides 已接管的列 ──────────────────────────────────────────
ALTER TABLE "foods"
  DROP COLUMN IF EXISTS "standard_serving_g",
  DROP COLUMN IF EXISTS "standard_serving_desc",
  DROP COLUMN IF EXISTS "common_portions",
  DROP COLUMN IF EXISTS "cooking_methods",
  DROP COLUMN IF EXISTS "required_equipment",
  DROP COLUMN IF EXISTS "prep_time_minutes",
  DROP COLUMN IF EXISTS "cook_time_minutes",
  DROP COLUMN IF EXISTS "skill_required",
  DROP COLUMN IF EXISTS "serving_temperature",
  DROP COLUMN IF EXISTS "estimated_cost_level",
  DROP COLUMN IF EXISTS "shelf_life_days",
  DROP COLUMN IF EXISTS "water_content_percent";
