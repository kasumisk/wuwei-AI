-- V8.0: 统一表名为复数形式
-- 将 payment_record / subscription_trigger_log / food_analysis_record 重命名为复数
-- 使 Prisma model 名、数据库表名、raw SQL 引用保持一致

-- 1. 重命名 payment_record → payment_records
ALTER TABLE "payment_record" RENAME TO "payment_records";

-- 2. 重命名 subscription_trigger_log → subscription_trigger_logs
ALTER TABLE "subscription_trigger_log" RENAME TO "subscription_trigger_logs";

-- 3. 重命名 food_analysis_record → food_analysis_records
ALTER TABLE "food_analysis_record" RENAME TO "food_analysis_records";

-- 外键约束和索引会自动跟随表名变更，无需额外处理
