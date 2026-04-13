-- V7.9 补充缺失字段迁移
-- 修复 schema.prisma 与实际数据库之间的差异

-- ═══════════════════════════════════════════════════════
-- 1. foods 表：补充营养字段
-- ═══════════════════════════════════════════════════════

ALTER TABLE "foods"
  ADD COLUMN IF NOT EXISTS "vitamin_b6"          DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "omega3"              DECIMAL(7,1),
  ADD COLUMN IF NOT EXISTS "omega6"              DECIMAL(7,1),
  ADD COLUMN IF NOT EXISTS "soluble_fiber"       DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS "insoluble_fiber"     DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS "water_content_percent" DECIMAL(5,2);

COMMENT ON COLUMN "foods"."vitamin_b6"           IS 'V7.9: 维生素 B6，单位 mg';
COMMENT ON COLUMN "foods"."omega3"               IS 'V7.9: Omega-3 脂肪酸，单位 mg';
COMMENT ON COLUMN "foods"."omega6"               IS 'V7.9: Omega-6 脂肪酸，单位 mg';
COMMENT ON COLUMN "foods"."soluble_fiber"        IS 'V7.9: 可溶性膳食纤维，单位 g';
COMMENT ON COLUMN "foods"."insoluble_fiber"      IS 'V7.9: 不可溶性膳食纤维，单位 g';
COMMENT ON COLUMN "foods"."water_content_percent" IS 'V7.9: 水分含量百分比';

-- ═══════════════════════════════════════════════════════
-- 2. food_analysis_record 表：补充审核字段
-- ═══════════════════════════════════════════════════════

ALTER TABLE "food_analysis_record"
  ADD COLUMN IF NOT EXISTS "review_status"  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "reviewed_by"    UUID,
  ADD COLUMN IF NOT EXISTS "reviewed_at"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "review_note"    TEXT;

COMMENT ON COLUMN "food_analysis_record"."review_status" IS 'V7.9: 人工审核状态：pending/accurate/inaccurate/partial';
COMMENT ON COLUMN "food_analysis_record"."reviewed_by"   IS 'V7.9: 审核人管理员 ID';
COMMENT ON COLUMN "food_analysis_record"."reviewed_at"   IS 'V7.9: 审核时间';
COMMENT ON COLUMN "food_analysis_record"."review_note"   IS 'V7.9: 审核备注';

CREATE INDEX IF NOT EXISTS "idx_food_analysis_record_review_status"
  ON "food_analysis_record"("review_status");

-- ═══════════════════════════════════════════════════════
-- 3. food_regional_info 表：补充 month_weights 字段
-- ═══════════════════════════════════════════════════════

ALTER TABLE "food_regional_info"
  ADD COLUMN IF NOT EXISTS "month_weights" JSONB;

COMMENT ON COLUMN "food_regional_info"."month_weights" IS 'V7.9: 按月份权重（用于时令食物推荐）';
