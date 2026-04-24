-- V6.7 Phase 2-E: replacement_patterns 新增 meal_type 列 + 索引
-- Prisma schema 已声明此列，但 DB 实际缺失，导致 findMany 查询全局失败。

ALTER TABLE "replacement_patterns"
  ADD COLUMN IF NOT EXISTS "meal_type" TEXT;

CREATE INDEX IF NOT EXISTS "idx_rp_meal_type"
  ON "replacement_patterns" ("meal_type");
