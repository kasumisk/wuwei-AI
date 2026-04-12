-- V7.0: strategy 表新增 context_condition 字段
-- 上下文策略匹配条件（scope=context 时使用）

ALTER TABLE "strategy"
  ADD COLUMN IF NOT EXISTS "context_condition" JSONB;

COMMENT ON COLUMN "strategy"."context_condition" IS 'V7.0: 上下文策略匹配条件（scope=context 时使用）{ timeOfDay?, dayType?, season?, userLifecycle?, goalPhaseType? }';
