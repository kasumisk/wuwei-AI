-- 移除废弃的 cooking_method 单值列，统一使用 cooking_methods 数组列
-- 步骤：
--   1. 将 cooking_method 值（英文/中文）映射为标准短码，合并到 cooking_methods（仅当 cooking_methods 为空时）
--   2. 删除旧索引 idx_food_library_cooking_method
--   3. 删除 cooking_method 列
--   4. 创建 GIN 索引 idx_food_library_cooking_methods

-- Step 1: 回填数据 —— 仅当 cooking_methods 为空数组且 cooking_method 非空时，
--         将烹饪方式映射为标准英文短码写入 cooking_methods
-- 实际数据中 cooking_method 值以英文为主，也可能包含中文或逗号/空格分隔的多值
-- 使用单值 CASE 映射覆盖实际出现的值
UPDATE "foods"
SET "cooking_methods" = ARRAY[
  CASE TRIM("cooking_method")
    -- 英文单值 → 标准短码
    WHEN 'steamed'      THEN 'steam'
    WHEN 'steam'        THEN 'steam'
    WHEN 'boiled'       THEN 'boil'
    WHEN 'boiling'      THEN 'boil'
    WHEN 'boil'         THEN 'boil'
    WHEN 'stir-fry'     THEN 'stir_fry'
    WHEN 'stir_fry'     THEN 'stir_fry'
    WHEN 'stir-fried'   THEN 'stir_fry'
    WHEN 'fried'        THEN 'deep_fry'
    WHEN 'frying'       THEN 'deep_fry'
    WHEN 'deep_fry'     THEN 'deep_fry'
    WHEN 'pan_frying'   THEN 'pan_fry'
    WHEN 'pan_fry'      THEN 'pan_fry'
    WHEN 'stewed'       THEN 'stew'
    WHEN 'stew'         THEN 'stew'
    WHEN 'grilled'      THEN 'grill'
    WHEN 'grill'        THEN 'grill'
    WHEN 'dried'        THEN 'raw'
    WHEN 'raw'          THEN 'raw'
    WHEN 'baking'       THEN 'bake'
    WHEN 'bake'         THEN 'bake'
    WHEN 'roast'        THEN 'roast'
    WHEN 'roasted'      THEN 'roast'
    WHEN 'sauteed'      THEN 'stir_fry'
    WHEN 'smoked'       THEN 'smoke'
    WHEN 'smoke'        THEN 'smoke'
    WHEN 'canned'       THEN 'raw'
    WHEN 'preserved'    THEN 'pickle'
    WHEN 'dehydrated'   THEN 'raw'
    WHEN 'thickening'   THEN 'stir_fry'
    WHEN 'cold_dish'    THEN 'raw'
    -- 中文单值 → 标准短码
    WHEN '炒'           THEN 'stir_fry'
    WHEN '蒸'           THEN 'steam'
    WHEN '煮'           THEN 'boil'
    WHEN '烤'           THEN 'roast'
    WHEN '煎'           THEN 'pan_fry'
    WHEN '炸'           THEN 'deep_fry'
    WHEN '炖'           THEN 'stew'
    WHEN '焖'           THEN 'simmer'
    WHEN '红烧'         THEN 'braise'
    WHEN '烧'           THEN 'braise'
    WHEN '烘焙'         THEN 'bake'
    WHEN '烧烤'         THEN 'grill'
    WHEN '凉拌'         THEN 'raw'
    WHEN '腌'           THEN 'pickle'
    WHEN '卤'           THEN 'braise'
    WHEN '微波'         THEN 'microwave'
    WHEN '熏'           THEN 'smoke'
    WHEN '发酵'         THEN 'ferment'
    WHEN '空气炸'       THEN 'air_fry'
    WHEN '电饭煲'       THEN 'rice_cook'
    ELSE 'raw'  -- 兜底：未知值默认映射为 raw（最安全的默认值）
  END
]
WHERE "cooking_method" IS NOT NULL
  AND "cooking_method" <> ''
  AND ("cooking_methods" IS NULL OR "cooking_methods" = '{}')
  -- 只处理单值情况；多值（含逗号或中文顿号）需要单独处理
  AND "cooking_method" NOT LIKE '%,%'
  AND "cooking_method" NOT LIKE '%、%';

-- Step 1b: 处理多值 cooking_method（含逗号分隔的值，如 'boiling, steaming'）
-- 对于这些记录，取第一个值映射为主方法
UPDATE "foods"
SET "cooking_methods" = ARRAY[
  CASE TRIM(SPLIT_PART("cooking_method", ',', 1))
    WHEN 'boiling'       THEN 'boil'
    WHEN 'steaming'      THEN 'steam'
    WHEN 'stir-frying'   THEN 'stir_fry'
    WHEN 'stir-fry'      THEN 'stir_fry'
    WHEN 'raw'           THEN 'raw'
    WHEN 'boiled'        THEN 'boil'
    WHEN 'steamed'       THEN 'steam'
    WHEN 'fried'         THEN 'deep_fry'
    WHEN 'grilled'       THEN 'grill'
    ELSE 'raw'
  END,
  CASE TRIM(SPLIT_PART("cooking_method", ',', 2))
    WHEN 'steaming'      THEN 'steam'
    WHEN 'boiling'       THEN 'boil'
    WHEN 'stir-frying'   THEN 'stir_fry'
    WHEN 'stir-fry'      THEN 'stir_fry'
    WHEN 'stir_fry'      THEN 'stir_fry'
    WHEN 'soup'          THEN 'boil'
    WHEN 'salad'         THEN 'raw'
    WHEN 'braised'       THEN 'braise'
    WHEN 'raw'           THEN 'raw'
    WHEN 'grilled'       THEN 'grill'
    ELSE 'raw'
  END
]
WHERE "cooking_method" IS NOT NULL
  AND "cooking_method" <> ''
  AND ("cooking_methods" IS NULL OR "cooking_methods" = '{}')
  AND "cooking_method" LIKE '%,%';

-- Step 1c: 处理中文顿号分隔的多值（如 '炖、煮、蒸'）
UPDATE "foods"
SET "cooking_methods" = ARRAY[
  CASE TRIM(SPLIT_PART("cooking_method", '、', 1))
    WHEN '炖' THEN 'stew'
    WHEN '煮' THEN 'boil'
    WHEN '蒸' THEN 'steam'
    WHEN '炒' THEN 'stir_fry'
    ELSE 'raw'
  END,
  CASE TRIM(SPLIT_PART("cooking_method", '、', 2))
    WHEN '煮' THEN 'boil'
    WHEN '蒸' THEN 'steam'
    WHEN '炒' THEN 'stir_fry'
    WHEN '炖' THEN 'stew'
    ELSE 'raw'
  END
]
WHERE "cooking_method" IS NOT NULL
  AND "cooking_method" <> ''
  AND ("cooking_methods" IS NULL OR "cooking_methods" = '{}')
  AND "cooking_method" LIKE '%、%';

-- Step 2: 删除旧索引（如果存在）
DROP INDEX IF EXISTS "idx_food_library_cooking_method";

-- Step 3: 删除 cooking_method 列
ALTER TABLE "foods" DROP COLUMN IF EXISTS "cooking_method";

-- Step 4: 创建 GIN 索引加速数组查询（如果不存在）
CREATE INDEX IF NOT EXISTS "idx_food_library_cooking_methods"
  ON "foods" USING GIN ("cooking_methods");
