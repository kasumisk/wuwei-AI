-- V8: Food Log Unified Source
-- Food Log 成为唯一真实数据源：
--   1. food_records_source_enum 新增 recommend / decision 枚举值
--   2. food_records 新增 recommendation_trace_id、is_executed 字段及复合索引
--   3. daily_summaries 新增 source_breakdown、recommend_execution_count 字段

-- 1. 扩展枚举
ALTER TYPE "food_records_source_enum" ADD VALUE IF NOT EXISTS 'recommend';
ALTER TYPE "food_records_source_enum" ADD VALUE IF NOT EXISTS 'decision';

-- 2. food_records 新字段
ALTER TABLE "food_records"
  ADD COLUMN IF NOT EXISTS "recommendation_trace_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "is_executed"             BOOLEAN NOT NULL DEFAULT TRUE;

-- 复合索引：支持按用户+来源+时间查询
CREATE INDEX IF NOT EXISTS "IDX_food_records_user_source_date"
  ON "food_records"("user_id", "source", "recorded_at");

-- 3. daily_summaries 新字段
ALTER TABLE "daily_summaries"
  ADD COLUMN IF NOT EXISTS "source_breakdown"          JSONB,
  ADD COLUMN IF NOT EXISTS "recommend_execution_count" INTEGER NOT NULL DEFAULT 0;
