-- V7.3 + V7.4: 食物形态与可获得性字段
-- 在 foods 表新增 food_form, dish_priority, acquisition_difficulty 字段
-- food_form 区分原材料/成品菜/半成品，用于推荐引擎的 dish 优先逻辑
-- acquisition_difficulty 标记食材获取难度，过滤稀有食材
-- 全部使用 ADD COLUMN IF NOT EXISTS 保证幂等性

-- ═══════════════════════════════════════════════════════
-- 1. foods 表扩展（V7.3）
-- ═══════════════════════════════════════════════════════

ALTER TABLE "foods"
  ADD COLUMN IF NOT EXISTS "food_form"   VARCHAR(20) DEFAULT 'ingredient',
  ADD COLUMN IF NOT EXISTS "dish_priority" INTEGER;

COMMENT ON COLUMN "foods"."food_form"      IS 'V7.3: 食物形态 ingredient=原材料 | dish=成品菜 | semi_prepared=半成品';
COMMENT ON COLUMN "foods"."dish_priority"  IS 'V7.3: 成品菜推荐优先级 0-100，仅 dish/semi_prepared 有值';

-- ═══════════════════════════════════════════════════════
-- 2. foods 表扩展（V7.4）
-- ═══════════════════════════════════════════════════════

ALTER TABLE "foods"
  ADD COLUMN IF NOT EXISTS "acquisition_difficulty" INTEGER DEFAULT 3;

COMMENT ON COLUMN "foods"."acquisition_difficulty" IS 'V7.4: 食物可获得性难度 1=随处可得 2=常见 3=普通 4=较难 5=稀有';

-- ═══════════════════════════════════════════════════════
-- 3. 索引：加速按 food_form 过滤的推荐查询
-- ═══════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "idx_foods_food_form" ON "foods" ("food_form");
