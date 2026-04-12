-- V7.1 Phase 1-A/E: 食物模型现实化增强 + 厨房设备画像
-- 在 foods 表新增 6 个字段，user_profiles 表新增 1 个字段
-- 全部使用 ADD COLUMN IF NOT EXISTS 保证幂等性

-- ═══════════════════════════════════════════════════════
-- 1. foods 表扩展
-- ═══════════════════════════════════════════════════════

ALTER TABLE "foods"
  ADD COLUMN IF NOT EXISTS "cooking_methods"      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "required_equipment"   TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "serving_temperature"  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "texture_tags"         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "ingredient_list"      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "dish_type"            VARCHAR(20);

COMMENT ON COLUMN "foods"."cooking_methods"     IS 'V7.1: 多种可行烹饪方式（扩展单一 cooking_method）';
COMMENT ON COLUMN "foods"."required_equipment"  IS 'V7.1: 所需设备列表（oven, microwave, air_fryer, steamer, wok, none）';
COMMENT ON COLUMN "foods"."serving_temperature" IS 'V7.1: 建议食用温度（hot, warm, cold, room_temp）';
COMMENT ON COLUMN "foods"."texture_tags"        IS 'V7.1: 口感标签（crispy, creamy, chewy, soft, crunchy）';
COMMENT ON COLUMN "foods"."ingredient_list"     IS 'V7.1: 完整食材清单（扩展单一 main_ingredient）';
COMMENT ON COLUMN "foods"."dish_type"           IS 'V7.1: 成品类型（dish, soup, drink, dessert, snack, staple）';

-- ═══════════════════════════════════════════════════════
-- 2. 数据迁移: cooking_method → cooking_methods
-- ═══════════════════════════════════════════════════════

UPDATE "foods"
SET "cooking_methods" = ARRAY["cooking_method"]
WHERE "cooking_method" IS NOT NULL
  AND "cooking_methods" = '{}';

-- ═══════════════════════════════════════════════════════
-- 3. 数据迁移: main_ingredient → ingredient_list
-- ═══════════════════════════════════════════════════════

UPDATE "foods"
SET "ingredient_list" = ARRAY["main_ingredient"]
WHERE "main_ingredient" IS NOT NULL
  AND "ingredient_list" = '{}';

-- ═══════════════════════════════════════════════════════
-- 4. 数据迁移: recipe_ingredients → ingredient_list 补充
--    对有 recipe 关联的食物，从配料表聚合食材名
-- ═══════════════════════════════════════════════════════

UPDATE "foods" f
SET "ingredient_list" = sub.ingredients
FROM (
  SELECT ri.food_id, ARRAY_AGG(DISTINCT ri.ingredient_name) AS ingredients
  FROM "recipe_ingredients" ri
  WHERE ri.food_id IS NOT NULL
  GROUP BY ri.food_id
) sub
WHERE f.id = sub.food_id
  AND f."ingredient_list" = '{}';

-- ═══════════════════════════════════════════════════════
-- 5. user_profiles 表扩展
-- ═══════════════════════════════════════════════════════

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "kitchen_profile" JSONB;

COMMENT ON COLUMN "user_profiles"."kitchen_profile" IS 'V7.1: 厨房设备画像 { hasOven, hasMicrowave, hasAirFryer, hasRiceCooker, hasSteamer, primaryStove }';
