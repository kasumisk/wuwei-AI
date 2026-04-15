-- V7.9 P2-08: 为 strategy_tuning_log 表新增审核相关字段
-- 支持 AutoTuner 的 pending_review 模式：自动调优结果先写入待审核状态，Admin 批准后才应用

-- 新增审核状态字段（默认 auto_applied 兼容历史数据）
ALTER TABLE "strategy_tuning_log"
  ADD COLUMN "review_status" VARCHAR(20) NOT NULL DEFAULT 'auto_applied';

-- 新增审核人字段
ALTER TABLE "strategy_tuning_log"
  ADD COLUMN "reviewed_by" VARCHAR(100);

-- 新增审核时间字段
ALTER TABLE "strategy_tuning_log"
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(6);

-- 新增审核备注字段
ALTER TABLE "strategy_tuning_log"
  ADD COLUMN "review_note" TEXT;

-- 按审核状态查询的索引（支持 pending_review 列表查询）
CREATE INDEX "idx_stl_review_status" ON "strategy_tuning_log"("review_status");
