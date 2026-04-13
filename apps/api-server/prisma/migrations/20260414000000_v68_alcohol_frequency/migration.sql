-- V6.8 Phase 3-B: 饮酒频率字段
-- 在 user_profiles 表新增 alcohol_frequency 字段
-- 使用 ADD COLUMN IF NOT EXISTS 保证幂等性

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "alcohol_frequency" VARCHAR(20);

COMMENT ON COLUMN "user_profiles"."alcohol_frequency" IS 'V6.8 Phase 3-B: 饮酒频率 never|occasional|frequent';
