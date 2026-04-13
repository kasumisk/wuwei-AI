-- V7.0: 复合目标字段
-- 在 user_profiles 表新增 compound_goal JSONB 字段
-- 支持多目标组合（主目标 + 次目标 + 阶段计划）
-- 使用 ADD COLUMN IF NOT EXISTS 保证幂等性

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "compound_goal" JSONB;

COMMENT ON COLUMN "user_profiles"."compound_goal" IS 'V7.0: 复合目标 { primary, secondary?, secondaryWeight?, phases?, currentPhaseIndex?, startDate? }';
