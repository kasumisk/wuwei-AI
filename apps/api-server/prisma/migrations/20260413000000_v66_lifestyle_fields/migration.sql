-- V6.6 Phase 2-C: 生活方式画像字段激活
-- 在 user_profiles 表新增 5 个生活方式相关字段
-- 全部使用 ADD COLUMN IF NOT EXISTS 保证幂等性

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "sleep_quality"            TEXT,
  ADD COLUMN IF NOT EXISTS "stress_level"             TEXT,
  ADD COLUMN IF NOT EXISTS "hydration_goal"           INTEGER,
  ADD COLUMN IF NOT EXISTS "supplements_used"         JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "meal_timing_preference"   TEXT;

-- 字段注释（需要 pgvector 注释支持时跳过，主流 PostgreSQL 均支持）
COMMENT ON COLUMN "user_profiles"."sleep_quality"          IS '睡眠质量: poor|fair|good';
COMMENT ON COLUMN "user_profiles"."stress_level"           IS '压力水平: low|medium|high';
COMMENT ON COLUMN "user_profiles"."hydration_goal"         IS '每日目标饮水量(ml)';
COMMENT ON COLUMN "user_profiles"."supplements_used"       IS '正在服用的补剂列表';
COMMENT ON COLUMN "user_profiles"."meal_timing_preference" IS '用餐时间偏好: early_bird|standard|late_eater';
