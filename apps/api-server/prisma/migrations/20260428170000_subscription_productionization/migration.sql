-- Subscription productionization
-- Adds RevenueCat webhook events, transaction history, audit logs,
-- and Google Play product mapping.

ALTER TABLE "subscription_plan"
ADD COLUMN IF NOT EXISTS "google_product_id" VARCHAR(256);

CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" VARCHAR(32) NOT NULL,
  "provider_event_id" VARCHAR(128) NOT NULL,
  "event_type" VARCHAR(64),
  "app_user_id" VARCHAR(128),
  "original_app_user_id" VARCHAR(128),
  "aliases" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "store" VARCHAR(32),
  "environment" VARCHAR(16),
  "runtime_env" VARCHAR(32) NOT NULL DEFAULT 'unknown',
  "product_id" VARCHAR(256),
  "entitlement_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "transaction_id" VARCHAR(256),
  "original_transaction_id" VARCHAR(256),
  "event_timestamp" TIMESTAMPTZ(6),
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "processing_status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "processed_at" TIMESTAMPTZ(6),
  "raw_payload" JSONB NOT NULL,
  CONSTRAINT "PK_billing_webhook_events" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_billing_webhook_provider_event"
  ON "billing_webhook_events" ("provider", "provider_event_id");

CREATE INDEX IF NOT EXISTS "idx_billing_webhook_app_user_time"
  ON "billing_webhook_events" ("app_user_id", "event_timestamp" DESC);

CREATE INDEX IF NOT EXISTS "idx_billing_webhook_status_received"
  ON "billing_webhook_events" ("processing_status", "received_at");

CREATE INDEX IF NOT EXISTS "idx_billing_webhook_original_txn"
  ON "billing_webhook_events" ("original_transaction_id");

CREATE TABLE IF NOT EXISTS "subscription_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subscription_id" UUID,
  "user_id" UUID,
  "provider" VARCHAR(32) NOT NULL,
  "provider_event_id" VARCHAR(128),
  "transaction_type" VARCHAR(32) NOT NULL,
  "store" VARCHAR(32),
  "environment" VARCHAR(16),
  "runtime_env" VARCHAR(32) NOT NULL DEFAULT 'unknown',
  "store_product_id" VARCHAR(256),
  "transaction_id" VARCHAR(256),
  "original_transaction_id" VARCHAR(256),
  "purchase_token" VARCHAR(512),
  "purchased_at" TIMESTAMPTZ(6),
  "effective_from" TIMESTAMPTZ(6),
  "effective_to" TIMESTAMPTZ(6),
  "amount_cents" INTEGER,
  "currency" VARCHAR(8),
  "status" VARCHAR(32) NOT NULL DEFAULT 'success',
  "raw_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "PK_subscription_transactions" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_subscription_txn_subscription_time"
  ON "subscription_transactions" ("subscription_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_subscription_txn_user_time"
  ON "subscription_transactions" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_subscription_txn_transaction_id"
  ON "subscription_transactions" ("transaction_id");

CREATE INDEX IF NOT EXISTS "idx_subscription_txn_original_transaction_id"
  ON "subscription_transactions" ("original_transaction_id");

CREATE TABLE IF NOT EXISTS "subscription_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subscription_id" UUID,
  "user_id" UUID,
  "actor_type" VARCHAR(32) NOT NULL,
  "actor_id" VARCHAR(128),
  "action" VARCHAR(64) NOT NULL,
  "runtime_env" VARCHAR(32) NOT NULL DEFAULT 'unknown',
  "before_state" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "after_state" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "PK_subscription_audit_logs" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_subscription_audit_subscription_time"
  ON "subscription_audit_logs" ("subscription_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_subscription_audit_user_time"
  ON "subscription_audit_logs" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_subscription_audit_actor_time"
  ON "subscription_audit_logs" ("actor_type", "created_at" DESC);
