-- Mature subscription domain model:
-- provider customer mapping, store product mapping, entitlement catalog,
-- plan entitlements, and current user entitlements.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_subscription_plan_tier_cycle"
  ON "subscription_plan" ("tier", "billing_cycle");

CREATE TABLE IF NOT EXISTS "subscription_provider_customers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "provider_customer_id" VARCHAR(256) NOT NULL,
  "original_provider_customer_id" VARCHAR(256),
  "aliases" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "environment" VARCHAR(32) NOT NULL DEFAULT 'production',
  "status" VARCHAR(32) NOT NULL DEFAULT 'active',
  "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_synced_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "PK_subscription_provider_customers" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_subscription_provider_customer"
  ON "subscription_provider_customers" ("provider", "environment", "provider_customer_id");

CREATE INDEX IF NOT EXISTS "idx_subscription_provider_customer_user_provider"
  ON "subscription_provider_customers" ("user_id", "provider");

CREATE TABLE IF NOT EXISTS "subscription_store_products" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "store" VARCHAR(32),
  "product_id" VARCHAR(256) NOT NULL,
  "environment" VARCHAR(32) NOT NULL DEFAULT 'production',
  "offering_id" VARCHAR(128),
  "package_id" VARCHAR(128),
  "billing_cycle" VARCHAR(32) NOT NULL,
  "currency" VARCHAR(8),
  "price_cents" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "PK_subscription_store_products" PRIMARY KEY ("id"),
  CONSTRAINT "fk_subscription_store_product_plan"
    FOREIGN KEY ("plan_id") REFERENCES "subscription_plan"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_subscription_store_product_provider_product"
  ON "subscription_store_products" ("provider", "environment", "product_id");

CREATE INDEX IF NOT EXISTS "idx_subscription_store_product_plan_active"
  ON "subscription_store_products" ("plan_id", "is_active");

CREATE INDEX IF NOT EXISTS "idx_subscription_store_product_provider_store"
  ON "subscription_store_products" ("provider", "store");

CREATE TABLE IF NOT EXISTS "subscription_entitlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "display_name" VARCHAR(128),
  "description" TEXT,
  "value_type" VARCHAR(32) NOT NULL DEFAULT 'json',
  "default_value" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" VARCHAR(32) NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "PK_subscription_entitlements" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_subscription_entitlement_code"
  ON "subscription_entitlements" ("code");

CREATE TABLE IF NOT EXISTS "subscription_plan_entitlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "entitlement_code" VARCHAR(64) NOT NULL,
  "value" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "PK_subscription_plan_entitlements" PRIMARY KEY ("id"),
  CONSTRAINT "fk_subscription_plan_entitlement_plan"
    FOREIGN KEY ("plan_id") REFERENCES "subscription_plan"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_subscription_plan_entitlement_entitlement"
    FOREIGN KEY ("entitlement_code") REFERENCES "subscription_entitlements"("code") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_subscription_plan_entitlement"
  ON "subscription_plan_entitlements" ("plan_id", "entitlement_code");

CREATE INDEX IF NOT EXISTS "idx_subscription_plan_entitlement_code_active"
  ON "subscription_plan_entitlements" ("entitlement_code", "is_active");

CREATE TABLE IF NOT EXISTS "user_entitlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "entitlement_code" VARCHAR(64) NOT NULL,
  "source_type" VARCHAR(32) NOT NULL,
  "source_key" VARCHAR(128) NOT NULL,
  "source_id" UUID,
  "subscription_id" UUID,
  "provider" VARCHAR(32),
  "provider_customer_id" VARCHAR(256),
  "status" VARCHAR(32) NOT NULL DEFAULT 'active',
  "value" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "effective_to" TIMESTAMPTZ(6),
  "last_event_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "PK_user_entitlements" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_entitlement_source"
  ON "user_entitlements" ("user_id", "entitlement_code", "source_type", "source_key");

CREATE INDEX IF NOT EXISTS "idx_user_entitlement_user_status"
  ON "user_entitlements" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "idx_user_entitlement_code_status"
  ON "user_entitlements" ("entitlement_code", "status");

CREATE INDEX IF NOT EXISTS "idx_user_entitlement_subscription"
  ON "user_entitlements" ("subscription_id");

-- Backfill store product mapping from legacy columns.
INSERT INTO "subscription_store_products"
  ("plan_id", "provider", "store", "product_id", "environment", "billing_cycle", "currency", "price_cents", "is_active", "metadata")
SELECT "id", 'revenuecat', 'app_store', "apple_product_id", 'production', "billing_cycle", "currency", "price_cents", "is_active",
       jsonb_build_object('legacyColumn', 'appleProductId')
FROM "subscription_plan"
WHERE "apple_product_id" IS NOT NULL AND "apple_product_id" <> ''
ON CONFLICT ("provider", "environment", "product_id") DO UPDATE
SET "plan_id" = EXCLUDED."plan_id",
    "billing_cycle" = EXCLUDED."billing_cycle",
    "currency" = EXCLUDED."currency",
    "price_cents" = EXCLUDED."price_cents",
    "is_active" = EXCLUDED."is_active",
    "updated_at" = now();

INSERT INTO "subscription_store_products"
  ("plan_id", "provider", "store", "product_id", "environment", "billing_cycle", "currency", "price_cents", "is_active", "metadata")
SELECT "id", 'revenuecat', 'play_store', "google_product_id", 'production', "billing_cycle", "currency", "price_cents", "is_active",
       jsonb_build_object('legacyColumn', 'googleProductId')
FROM "subscription_plan"
WHERE "google_product_id" IS NOT NULL AND "google_product_id" <> ''
ON CONFLICT ("provider", "environment", "product_id") DO UPDATE
SET "plan_id" = EXCLUDED."plan_id",
    "billing_cycle" = EXCLUDED."billing_cycle",
    "currency" = EXCLUDED."currency",
    "price_cents" = EXCLUDED."price_cents",
    "is_active" = EXCLUDED."is_active",
    "updated_at" = now();

INSERT INTO "subscription_store_products"
  ("plan_id", "provider", "store", "product_id", "environment", "billing_cycle", "currency", "price_cents", "is_active", "metadata")
SELECT "id", 'wechat_pay', 'wechat', "wechat_product_id", 'production', "billing_cycle", "currency", "price_cents", "is_active",
       jsonb_build_object('legacyColumn', 'wechatProductId')
FROM "subscription_plan"
WHERE "wechat_product_id" IS NOT NULL AND "wechat_product_id" <> ''
ON CONFLICT ("provider", "environment", "product_id") DO UPDATE
SET "plan_id" = EXCLUDED."plan_id",
    "billing_cycle" = EXCLUDED."billing_cycle",
    "currency" = EXCLUDED."currency",
    "price_cents" = EXCLUDED."price_cents",
    "is_active" = EXCLUDED."is_active",
    "updated_at" = now();

-- Backfill entitlement catalog and plan entitlement values from plan JSON.
INSERT INTO "subscription_entitlements" ("code", "display_name", "value_type")
SELECT DISTINCT e.key, replace(initcap(replace(e.key, '_', ' ')), 'Ai', 'AI'), 'json'
FROM "subscription_plan" p
CROSS JOIN LATERAL jsonb_each(p."entitlements"::jsonb) AS e(key, value)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "subscription_plan_entitlements" ("plan_id", "entitlement_code", "value", "is_active")
SELECT p."id", e.key, e.value, p."is_active"
FROM "subscription_plan" p
CROSS JOIN LATERAL jsonb_each(p."entitlements"::jsonb) AS e(key, value)
ON CONFLICT ("plan_id", "entitlement_code") DO UPDATE
SET "value" = EXCLUDED."value",
    "is_active" = EXCLUDED."is_active",
    "updated_at" = now();
