-- Harden subscription event idempotency.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_subscription_txn_provider_transaction"
  ON "subscription_transactions" ("provider", "transaction_id")
  WHERE "transaction_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_subscription_txn_provider_event"
  ON "subscription_transactions" ("provider", "provider_event_id", "transaction_type")
  WHERE "provider_event_id" IS NOT NULL;
