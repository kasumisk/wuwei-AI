-- V6.9 Phase 3-B: precomputed_recommendations 新增渠道维度字段
-- channel 字段用于区分不同渠道的推荐缓存，切换渠道时不命中旧缓存
-- 使用 ADD COLUMN IF NOT EXISTS 保证幂等性

-- ═══════════════════════════════════════════════════════
-- 1. 新增 channel 列
-- ═══════════════════════════════════════════════════════

ALTER TABLE "precomputed_recommendations"
  ADD COLUMN IF NOT EXISTS "channel" VARCHAR(30) NOT NULL DEFAULT 'unknown';

COMMENT ON COLUMN "precomputed_recommendations"."channel" IS 'V6.9 Phase 3-B: 渠道维度（切换渠道时不命中旧缓存）';

-- ═══════════════════════════════════════════════════════
-- 2. 删除旧的 unique 约束（原为 user_id+date+meal_type 三列）
--    并重建包含 channel 的四列唯一约束
--    先尝试删除可能存在的旧约束名，IF NOT EXISTS 不适用于 DROP CONSTRAINT，
--    用 DO $$ 块做存在性检查
-- ═══════════════════════════════════════════════════════

DO $$
BEGIN
  -- 删除不含 channel 的旧唯一约束（如果存在）
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'precomputed_recommendations'
      AND constraint_name = 'uq_precomputed_user_date_meal'
  ) THEN
    ALTER TABLE "precomputed_recommendations"
      DROP CONSTRAINT "uq_precomputed_user_date_meal";
  END IF;
END $$;

-- 创建含 channel 的新唯一约束（幂等：已存在则跳过）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'precomputed_recommendations'
      AND constraint_name = 'uq_precomputed_user_date_meal_channel'
  ) THEN
    ALTER TABLE "precomputed_recommendations"
      ADD CONSTRAINT "uq_precomputed_user_date_meal_channel"
      UNIQUE (user_id, date, meal_type, channel);
  END IF;
END $$;
