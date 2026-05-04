-- ============================================================================
-- Migration: Idempotency + Task Execution Log
-- Purpose:
--   1) Replace Redis setNX-based idempotency for production-critical paths
--      (subscription / payment webhooks, Cloud Tasks taskId, Scheduler cron).
--   2) Provide a single observability table for Cloud Tasks / Cloud Run Jobs /
--      Cloud Scheduler executions, replacing visibility previously offered by
--      BullMQ's redis-backed job list.
-- Notes:
--   - Both tables are append/update-mostly. Older rows can be pruned by
--     a daily Scheduler cron (`task-execution-log-prune` / `idempotency-prune`).
--   - All indexes match the @@index/@@unique declarations in schema.prisma.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- IdempotencyKey
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
  "scope"          VARCHAR(64)  NOT NULL,
  "key"            VARCHAR(256) NOT NULL,
  "status"         VARCHAR(16)  NOT NULL DEFAULT 'pending',
  "result"         JSONB,
  "error_message"  VARCHAR(1000),
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "completed_at"   TIMESTAMPTZ(6),
  "expires_at"     TIMESTAMPTZ(6),
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_idempotency_keys_scope_key"
  ON "idempotency_keys" ("scope", "key");

CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_expires_at"
  ON "idempotency_keys" ("expires_at");

CREATE INDEX IF NOT EXISTS "idx_idempotency_keys_scope_status"
  ON "idempotency_keys" ("scope", "status");

-- ----------------------------------------------------------------------------
-- TaskExecutionLog
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "task_execution_log" (
  "id"              UUID          NOT NULL DEFAULT gen_random_uuid(),
  "backend"         VARCHAR(32)   NOT NULL,
  "task_name"       VARCHAR(128)  NOT NULL,
  "external_id"     VARCHAR(256),
  "status"          VARCHAR(16)   NOT NULL DEFAULT 'running',
  "attempt"         INTEGER       NOT NULL DEFAULT 0,
  "payload_digest"  JSONB,
  "error_message"   TEXT,
  "error_stack"     TEXT,
  "started_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "finished_at"     TIMESTAMPTZ(6),
  "duration_ms"     INTEGER,
  CONSTRAINT "task_execution_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_task_execution_log_task_started"
  ON "task_execution_log" ("task_name", "started_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_task_execution_log_status_started"
  ON "task_execution_log" ("status", "started_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_task_execution_log_external_id"
  ON "task_execution_log" ("external_id");
