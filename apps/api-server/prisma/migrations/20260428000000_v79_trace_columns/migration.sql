-- V7.9: 推荐管道可观测性 — 扩展 recommendation_traces 表

-- 新增追踪相关列
ALTER TABLE "recommendation_traces"
  ADD COLUMN IF NOT EXISTS "trace_data"        JSONB,
  ADD COLUMN IF NOT EXISTS "strategy_name"     VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "scene_name"        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "realism_level"     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "candidate_flow"    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "total_duration_ms" INTEGER,
  ADD COLUMN IF NOT EXISTS "cache_hit"         BOOLEAN,
  ADD COLUMN IF NOT EXISTS "degradations"      JSONB;

-- 场景名称索引（便于按场景查询追踪记录）
CREATE INDEX IF NOT EXISTS "idx_rec_traces_scene" ON "recommendation_traces" ("scene_name");
