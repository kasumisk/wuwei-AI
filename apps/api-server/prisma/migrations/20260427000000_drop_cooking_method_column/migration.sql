-- 移除废弃的 cooking_method 单值列，统一使用 cooking_methods 数组列
-- 步骤：
--   1. 将 cooking_method 中文值映射为英文短码，合并到 cooking_methods（仅当 cooking_methods 为空时）
--   2. 删除旧索引 idx_food_library_cooking_method
--   3. 删除 cooking_method 列
--   4. 创建 GIN 索引 idx_food_library_cooking_methods

-- Step 1: 回填数据 —— 仅当 cooking_methods 为空数组且 cooking_method 非空时，
--         将中文烹饪方式映射为英文短码写入 cooking_methods
UPDATE "foods"
SET "cooking_methods" = ARRAY[
  CASE "cooking_method"
    WHEN '炒'   THEN 'stir_fry'
    WHEN '蒸'   THEN 'steam'
    WHEN '煮'   THEN 'boil'
    WHEN '烤'   THEN 'roast'
    WHEN '煎'   THEN 'pan_fry'
    WHEN '炸'   THEN 'deep_fry'
    WHEN '炖'   THEN 'stew'
    WHEN '焖'   THEN 'simmer'
    WHEN '红烧' THEN 'braise'
    WHEN '烧'   THEN 'braise'
    WHEN '烘焙' THEN 'bake'
    WHEN '烘'   THEN 'bake'
    WHEN '烧烤' THEN 'grill'
    WHEN '凉拌' THEN 'raw'
    WHEN '拌'   THEN 'raw'
    WHEN '腌'   THEN 'pickle'
    WHEN '卤'   THEN 'braise'
    WHEN '微波' THEN 'microwave'
    WHEN '熏'   THEN 'smoke'
    WHEN '发酵' THEN 'ferment'
    WHEN '空气炸' THEN 'air_fry'
    WHEN '电饭煲' THEN 'rice_cook'
    ELSE 'stir_fry'  -- 兜底：未知值默认映射为 stir_fry
  END
]
WHERE "cooking_method" IS NOT NULL
  AND "cooking_method" <> ''
  AND ("cooking_methods" IS NULL OR "cooking_methods" = '{}');

-- Step 2: 删除旧索引（如果存在）
DROP INDEX IF EXISTS "idx_food_library_cooking_method";

-- Step 3: 删除 cooking_method 列
ALTER TABLE "foods" DROP COLUMN IF EXISTS "cooking_method";

-- Step 4: 创建 GIN 索引加速数组查询（如果不存在）
CREATE INDEX IF NOT EXISTS "idx_food_library_cooking_methods"
  ON "foods" USING GIN ("cooking_methods");
