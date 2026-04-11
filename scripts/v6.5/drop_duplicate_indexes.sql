-- V6.5 Phase 2K: 重复索引清除
-- 4 对重复索引，保留语义明确的命名版本

DROP INDEX IF EXISTS "IDX_c147959a431fea61665d0e8bf4"; -- foods.category 重复 (保留 idx_foods_category)
DROP INDEX IF EXISTS "IDX_68aa1d0fe3ef6b57e4fd922033"; -- foods.status 重复 (保留 IDX_foods_status)
DROP INDEX IF EXISTS "IDX_0e3bd85e37aa82a7ccdd76e135"; -- foods.primary_source 重复 (保留 IDX_foods_primary_source)
DROP INDEX IF EXISTS "IDX_94919a5b0af8952c73beb42fbc"; -- foods.barcode 重复 (保留 IDX_foods_barcode)
