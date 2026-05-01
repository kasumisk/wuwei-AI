-- Migration: usage_records — userId 字段、索引重建、GIN 索引、归档表
-- 生成时间: 2026-05-14
-- 背景:
--   1. 新增 user_id 列（可空），记录发起 LLM 调用的用户，支持配额报表和用户侧消费展示
--   2. 删除旧索引（命名混乱），按统一规范重建
--   3. 用 GIN 索引加速 usage / metadata JSONB 字段的 @> 包含查询
--   4. 新建 usage_records_archive 归档表（同结构 + archived_at）
--   5. 归档逻辑由应用层 UsageArchiveCronService 执行（每日凌晨，90天以前批量移入）

-- ─── 1. 新增 user_id 列 ────────────────────────────────────────────────────
ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS user_id UUID;

COMMENT ON COLUMN usage_records.user_id IS '发起调用的用户 ID（系统级任务为 NULL）';

-- ─── 2. 删除旧索引（名称不规范，重建统一命名） ────────────────────────────
DROP INDEX CONCURRENTLY IF EXISTS "IDX_0616a784ab63d9f654498cd84b"; -- capability_type, timestamp
DROP INDEX CONCURRENTLY IF EXISTS "IDX_1f7f090f5d081ae21593ab3844"; -- provider, timestamp
DROP INDEX CONCURRENTLY IF EXISTS "IDX_d397b87d28105b361b8f5a840d"; -- client_id, timestamp

-- ─── 3. 重建 BTree 索引（CONCURRENTLY 避免锁表）──────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_records_feature_ts
  ON usage_records (capability_type, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_records_provider_ts
  ON usage_records (provider, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_records_client_ts
  ON usage_records (client_id, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_records_user_ts
  ON usage_records (user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;          -- partial index：系统调用不占索引空间

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_records_timestamp
  ON usage_records (timestamp ASC);   -- 归档 cron range scan 专用

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_records_status_ts
  ON usage_records (status, timestamp DESC);

-- ─── 4. GIN 索引（JSONB 包含查询）────────────────────────────────────────
-- usage 字段：如 usage @> '{"total_tokens": 1000}' 按 token 过滤
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_records_usage_gin
  ON usage_records USING gin (usage jsonb_path_ops);

-- metadata 字段：如 metadata @> '{"feature": "CoachChat"}' 按特征过滤
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_records_metadata_gin
  ON usage_records USING gin (metadata jsonb_path_ops)
  WHERE metadata IS NOT NULL;         -- partial：空 metadata 不占索引

-- ─── 5. 创建归档表 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_records_archive (
  id               UUID        NOT NULL DEFAULT uuid_generate_v4(),
  client_id        UUID        NOT NULL,
  user_id          UUID,
  request_id       VARCHAR(255) NOT NULL,
  capability_type  VARCHAR(100) NOT NULL,
  provider         VARCHAR(50)  NOT NULL,
  model            VARCHAR(100) NOT NULL,
  status           VARCHAR(20)  NOT NULL,
  usage            JSONB        NOT NULL,
  cost             DECIMAL(10,6) NOT NULL,
  response_time    INTEGER      NOT NULL,
  metadata         JSONB,
  timestamp        TIMESTAMPTZ  NOT NULL,
  archived_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_usage_records_archive PRIMARY KEY (id)
);

COMMENT ON TABLE usage_records_archive IS
  'usage_records 冷归档表。90 天以上的记录由 UsageArchiveCronService 批量移入，保留用于历史报表。';

CREATE INDEX IF NOT EXISTS idx_usage_archive_timestamp
  ON usage_records_archive (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_usage_archive_user_ts
  ON usage_records_archive (user_id, timestamp DESC)
  WHERE user_id IS NOT NULL;
