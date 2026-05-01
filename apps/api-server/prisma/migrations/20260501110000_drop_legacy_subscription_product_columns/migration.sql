-- Product mappings are canonicalized into subscription_store_products.
ALTER TABLE "subscription_plan"
  DROP COLUMN IF EXISTS "apple_product_id",
  DROP COLUMN IF EXISTS "google_product_id",
  DROP COLUMN IF EXISTS "wechat_product_id";
