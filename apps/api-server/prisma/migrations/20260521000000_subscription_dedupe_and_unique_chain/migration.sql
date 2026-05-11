-- Deduplicate same-chain subscription rows and enforce one row per
-- (user_id, payment_channel, platform_subscription_id).
--
-- Why:
-- - RevenueCat client-triggered refresh and webhook sync could race and create
--   duplicate subscription rows for the same Apple/Google subscription chain.
-- - subscription_transactions / billing_webhook_events / audit_logs already
--   preserve history; subscription should keep one primary row per chain.

BEGIN;

-- Step 0: if a given (user_id, payment_channel, starts_at) already maps to
-- exactly one known provider chain, backfill null platform ids onto it first.
WITH singleton_chain AS (
  SELECT
    user_id,
    payment_channel,
    starts_at,
    MIN(platform_subscription_id) AS chain_id
  FROM subscription
  WHERE platform_subscription_id IS NOT NULL
  GROUP BY user_id, payment_channel, starts_at
  HAVING COUNT(DISTINCT platform_subscription_id) = 1
)
UPDATE subscription s
SET platform_subscription_id = sc.chain_id,
    updated_at = NOW()
FROM singleton_chain sc
WHERE s.user_id = sc.user_id
  AND s.payment_channel = sc.payment_channel
  AND s.starts_at = sc.starts_at
  AND s.platform_subscription_id IS NULL;

-- 1) Re-point all dependent records from duplicate rows to the keeper row.
WITH ranked AS (
  SELECT
    id,
    user_id,
    payment_channel,
    platform_subscription_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, payment_channel, platform_subscription_id
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'grace_period' THEN 1
          WHEN 'cancelled' THEN 2
          WHEN 'expired' THEN 3
          WHEN 'refunded' THEN 4
          WHEN 'revoked' THEN 5
          ELSE 9
        END,
        expires_at DESC,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM subscription
  WHERE platform_subscription_id IS NOT NULL
), dup_map AS (
  SELECT
    loser.id AS loser_id,
    keeper.id AS keeper_id
  FROM ranked loser
  JOIN ranked keeper
    ON keeper.user_id = loser.user_id
   AND keeper.payment_channel = loser.payment_channel
   AND keeper.platform_subscription_id = loser.platform_subscription_id
   AND keeper.rn = 1
  WHERE loser.rn > 1
)
UPDATE payment_records pr
SET subscription_id = dm.keeper_id,
    updated_at = NOW()
FROM dup_map dm
WHERE pr.subscription_id = dm.loser_id;

WITH ranked AS (
  SELECT
    id,
    user_id,
    payment_channel,
    platform_subscription_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, payment_channel, platform_subscription_id
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'grace_period' THEN 1
          WHEN 'cancelled' THEN 2
          WHEN 'expired' THEN 3
          WHEN 'refunded' THEN 4
          WHEN 'revoked' THEN 5
          ELSE 9
        END,
        expires_at DESC,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM subscription
  WHERE platform_subscription_id IS NOT NULL
), dup_map AS (
  SELECT
    loser.id AS loser_id,
    keeper.id AS keeper_id
  FROM ranked loser
  JOIN ranked keeper
    ON keeper.user_id = loser.user_id
   AND keeper.payment_channel = loser.payment_channel
   AND keeper.platform_subscription_id = loser.platform_subscription_id
   AND keeper.rn = 1
  WHERE loser.rn > 1
)
UPDATE subscription_transactions st
SET subscription_id = dm.keeper_id
FROM dup_map dm
WHERE st.subscription_id = dm.loser_id;

WITH ranked AS (
  SELECT
    id,
    user_id,
    payment_channel,
    platform_subscription_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, payment_channel, platform_subscription_id
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'grace_period' THEN 1
          WHEN 'cancelled' THEN 2
          WHEN 'expired' THEN 3
          WHEN 'refunded' THEN 4
          WHEN 'revoked' THEN 5
          ELSE 9
        END,
        expires_at DESC,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM subscription
  WHERE platform_subscription_id IS NOT NULL
), dup_map AS (
  SELECT
    loser.id AS loser_id,
    keeper.id AS keeper_id
  FROM ranked loser
  JOIN ranked keeper
    ON keeper.user_id = loser.user_id
   AND keeper.payment_channel = loser.payment_channel
   AND keeper.platform_subscription_id = loser.platform_subscription_id
   AND keeper.rn = 1
  WHERE loser.rn > 1
)
UPDATE subscription_audit_logs sal
SET subscription_id = dm.keeper_id
FROM dup_map dm
WHERE sal.subscription_id = dm.loser_id;

WITH ranked AS (
  SELECT
    id,
    user_id,
    payment_channel,
    platform_subscription_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, payment_channel, platform_subscription_id
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'grace_period' THEN 1
          WHEN 'cancelled' THEN 2
          WHEN 'expired' THEN 3
          WHEN 'refunded' THEN 4
          WHEN 'revoked' THEN 5
          ELSE 9
        END,
        expires_at DESC,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM subscription
  WHERE platform_subscription_id IS NOT NULL
), dup_map AS (
  SELECT
    loser.id AS loser_id,
    keeper.id AS keeper_id
  FROM ranked loser
  JOIN ranked keeper
    ON keeper.user_id = loser.user_id
   AND keeper.payment_channel = loser.payment_channel
   AND keeper.platform_subscription_id = loser.platform_subscription_id
   AND keeper.rn = 1
  WHERE loser.rn > 1
)
DELETE FROM user_entitlements ue
USING dup_map dm
WHERE ue.source_type = 'subscription'
  AND (
    ue.subscription_id = dm.loser_id
    OR ue.source_id = dm.loser_id
    OR ue.source_key = dm.loser_id::text
  )
  AND EXISTS (
    SELECT 1
    FROM user_entitlements kept
    WHERE kept.user_id = ue.user_id
      AND kept.entitlement_code = ue.entitlement_code
      AND kept.source_type = ue.source_type
      AND kept.source_key = dm.keeper_id::text
  );

WITH ranked AS (
  SELECT
    id,
    user_id,
    payment_channel,
    platform_subscription_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, payment_channel, platform_subscription_id
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'grace_period' THEN 1
          WHEN 'cancelled' THEN 2
          WHEN 'expired' THEN 3
          WHEN 'refunded' THEN 4
          WHEN 'revoked' THEN 5
          ELSE 9
        END,
        expires_at DESC,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM subscription
  WHERE platform_subscription_id IS NOT NULL
), dup_map AS (
  SELECT
    loser.id AS loser_id,
    keeper.id AS keeper_id
  FROM ranked loser
  JOIN ranked keeper
    ON keeper.user_id = loser.user_id
   AND keeper.payment_channel = loser.payment_channel
   AND keeper.platform_subscription_id = loser.platform_subscription_id
   AND keeper.rn = 1
  WHERE loser.rn > 1
)
UPDATE user_entitlements ue
SET subscription_id = dm.keeper_id,
    source_id = CASE WHEN ue.source_id = dm.loser_id THEN dm.keeper_id ELSE ue.source_id END,
    source_key = CASE WHEN ue.source_type = 'subscription' THEN dm.keeper_id::text ELSE ue.source_key END,
    updated_at = NOW()
FROM dup_map dm
WHERE ue.subscription_id = dm.loser_id
   OR (ue.source_type = 'subscription' AND (ue.source_id = dm.loser_id OR ue.source_key = dm.loser_id::text));

-- 2) Delete duplicate subscription rows after dependencies are repointed.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, payment_channel, platform_subscription_id
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'grace_period' THEN 1
          WHEN 'cancelled' THEN 2
          WHEN 'expired' THEN 3
          WHEN 'refunded' THEN 4
          WHEN 'revoked' THEN 5
          ELSE 9
        END,
        expires_at DESC,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS rn
  FROM subscription
  WHERE platform_subscription_id IS NOT NULL
)
DELETE FROM subscription s
USING ranked r
WHERE s.id = r.id
  AND r.rn > 1;

-- 3) Enforce uniqueness for future writes.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_subscription_user_channel_platform_sub"
  ON "subscription" ("user_id", "payment_channel", "platform_subscription_id");

COMMIT;
