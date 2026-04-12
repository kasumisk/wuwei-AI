-- V7.2 P1-E: 移除 foods 表的 3 个已废弃字段
-- 这些字段在 V6.5 标记为 @deprecated，数据已迁移至 fiber/sugar/sodium 字段。
-- 代码中无任何引用（已通过 grep 验证），可安全删除。

-- 先备份数据（防止意外），生产环境可跳过
-- CREATE TABLE IF NOT EXISTS _v72_deprecated_fields_backup AS
--   SELECT id, fiber_per_100g, sugar_per_100g, sodium_per_100g FROM foods
--   WHERE fiber_per_100g IS NOT NULL OR sugar_per_100g IS NOT NULL OR sodium_per_100g IS NOT NULL;

ALTER TABLE "foods" DROP COLUMN IF EXISTS "fiber_per_100g";
ALTER TABLE "foods" DROP COLUMN IF EXISTS "sugar_per_100g";
ALTER TABLE "foods" DROP COLUMN IF EXISTS "sodium_per_100g";
