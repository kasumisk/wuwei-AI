-- Subscription hot-path indexes
--
-- 业务背景：
--   1. cron `processExpiredSubscriptions` 每分钟扫 status='active' AND expires_at < now()
--   2. RevenueCat webhook 查找用户当前订阅时按 (user_id, status, expires_at) 过滤
--   3. RC reconcile cron 按 status IN (...) ORDER BY updated_at DESC 拉最近订阅
--   4. webhook 反向查找时偶尔需要 platform_subscription_id 命中
--
-- 现有索引（schema.prisma 已声明）：
--   - idx_subscription_expires            (expires_at)
--   - idx_subscription_user               (user_id)
--   - idx_subscription_user_status        (user_id, status)
--
-- 本迁移补足的索引：
--   - idx_subscription_status_expires      (status, expires_at) —— cron 扫过期
--   - idx_subscription_user_status_expires (user_id, status, expires_at DESC) —— "取当前有效订阅"
--   - idx_subscription_status_updated      (status, updated_at DESC) —— RC reconcile cron
--   - idx_subscription_platform_sub        (platform_subscription_id) WHERE NOT NULL —— webhook 反查
--
-- 性能影响：
--   全部用 IF NOT EXISTS，幂等；
--   表数据量在百万级以内，CREATE INDEX 不加 CONCURRENTLY 也是秒级；
--   如部署时表已巨大，运维改用 prisma migrate resolve + 手工 CONCURRENTLY 创建。

CREATE INDEX IF NOT EXISTS "idx_subscription_status_expires"
  ON "subscription" ("status", "expires_at");

CREATE INDEX IF NOT EXISTS "idx_subscription_user_status_expires"
  ON "subscription" ("user_id", "status", "expires_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_subscription_status_updated"
  ON "subscription" ("status", "updated_at" DESC);

-- platform_subscription_id 为 nullable，多数行为 NULL，使用 partial index 节省体积
CREATE INDEX IF NOT EXISTS "idx_subscription_platform_sub"
  ON "subscription" ("platform_subscription_id")
  WHERE "platform_subscription_id" IS NOT NULL;

-- 旧索引 idx_subscription_user 已被 idx_subscription_user_status / *_user_status_expires 完全覆盖
-- 但保留它可避免 Prisma drift；将来确认安全后可在单独迁移里 DROP INDEX IF EXISTS。
