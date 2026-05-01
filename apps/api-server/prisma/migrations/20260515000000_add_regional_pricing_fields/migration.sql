-- Migration: add_regional_pricing_fields
-- 区域+时区优化 (阶段 2.1) + 阶段 4.1 价格适配字段
--
-- 变更：
--   1. user_profiles.region_code  VarChar(5)  → VarChar(20)，default 'CN' → 'US'
--   2. user_profiles.timezone     default 'Asia/Shanghai' → 'America/New_York'
--   3. user_profiles.locale       新增 VarChar(10)，default 'en-US'
--   4. user_profiles.currency_code 新增 VarChar(3)，nullable
--   5. user_profiles.budget_per_meal 新增 Decimal(10,2)，nullable
--
-- 默认值与 apps/api-server/src/common/config/regional-defaults.ts 保持同步：
--   DEFAULT_REGION_CODE = 'US'
--   DEFAULT_TIMEZONE    = 'America/New_York'
--   DEFAULT_LOCALE      = 'en-US'

-- 1. 扩展 region_code 字段长度并更新默认值
ALTER TABLE "user_profiles"
  ALTER COLUMN "region_code" TYPE VARCHAR(20),
  ALTER COLUMN "region_code" SET DEFAULT 'US';

-- 2. 更新 timezone 默认值（已有行保留原值，新行使用新默认）
ALTER TABLE "user_profiles"
  ALTER COLUMN "timezone" SET DEFAULT 'America/New_York';

-- 3. 新增 locale 字段
ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "locale" VARCHAR(10) DEFAULT 'en-US';

-- 4. 新增 currency_code 字段（阶段 4.1 PriceFitFactor）
ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "currency_code" VARCHAR(3);

-- 5. 新增 budget_per_meal 字段（阶段 4.1 PriceFitFactor）
ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "budget_per_meal" DECIMAL(10, 2);
