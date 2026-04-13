-- V8.0: 扩展 food_change_logs.action 列宽度
-- 原始 VarChar(20) 无法容纳 ai_enrichment_rollback(23字符) / ai_enrichment_rolled_back(26字符) 等新增操作类型
-- 扩展至 VarChar(50) 以支持所有补全相关的 action 枚举值

ALTER TABLE "food_change_logs"
  ALTER COLUMN "action" TYPE VARCHAR(50);
