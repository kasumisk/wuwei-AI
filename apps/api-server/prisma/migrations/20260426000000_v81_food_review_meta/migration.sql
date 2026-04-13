-- V8.1: 食物审核元数据 + 补全失败字段追踪
-- 新增 reviewed_by / reviewed_at / failed_fields 字段

-- 审核者用户名
ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "reviewed_by" VARCHAR(100);

-- 审核时间
ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ;

-- 补全失败字段记录（JSONB，如 {"protein":{"reason":"AI返回null","at":"2026-04-13"}}）
ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "failed_fields" JSONB DEFAULT '{}';

-- 索引：加速按失败字段筛选（GIN 索引支持 JSONB 键查询）
CREATE INDEX IF NOT EXISTS "idx_foods_failed_fields" ON "foods" USING GIN ("failed_fields");
