-- V8.0 食物补全元数据字段迁移
-- 新增 5 个辅助字段：data_completeness, enrichment_status, last_enriched_at, field_sources, field_confidence
-- 新增 3 个索引：enrichment_status, data_completeness, last_enriched_at

-- ═══════════════════════════════════════════════════════
-- 1. foods 表：补充补全元数据字段
-- ═══════════════════════════════════════════════════════

ALTER TABLE "foods"
  ADD COLUMN IF NOT EXISTS "data_completeness"   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "enrichment_status"   VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "last_enriched_at"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "field_sources"       JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "field_confidence"    JSONB DEFAULT '{}';

COMMENT ON COLUMN "foods"."data_completeness"  IS 'V8.0: 数据完整度评分 0-100（加权计算，定期更新）';
COMMENT ON COLUMN "foods"."enrichment_status"  IS 'V8.0: 补全状态 pending/partial/completed/failed';
COMMENT ON COLUMN "foods"."last_enriched_at"   IS 'V8.0: 最后一次 AI 补全时间';
COMMENT ON COLUMN "foods"."field_sources"      IS 'V8.0: 字段级数据来源，如 {"protein":"ai_enrichment","fat":"manual","carbs":"usda"}';
COMMENT ON COLUMN "foods"."field_confidence"   IS 'V8.0: 字段级置信度，如 {"protein":0.85,"fat":0.92}';

-- ═══════════════════════════════════════════════════════
-- 2. 索引：加速筛选查询
-- ═══════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "idx_foods_enrichment_status"
  ON "foods"("enrichment_status");

CREATE INDEX IF NOT EXISTS "idx_foods_data_completeness"
  ON "foods"("data_completeness");

CREATE INDEX IF NOT EXISTS "idx_foods_last_enriched_at"
  ON "foods"("last_enriched_at");
