-- Store product identity must include store. Apple and Google may share product ids.

DROP INDEX IF EXISTS "uq_subscription_store_product_provider_product";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_subscription_store_product_provider_store_product"
  ON "subscription_store_products" ("provider", "environment", "store", "product_id");
