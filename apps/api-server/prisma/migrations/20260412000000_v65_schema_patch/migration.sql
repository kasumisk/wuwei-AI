-- V6.5 Schema Patch Migration
-- Fixes schema/migration drift: 7 missing tables, 3 missing columns, 6 missing FK constraints,
-- duplicate index cleanup, timestamp unification, and pgvector HNSW index creation.
-- Safe to run on both empty and existing databases (all DDL uses IF NOT EXISTS / IF EXISTS).

-- =====================================================================
-- SECTION 1: New Tables (V6.5)
-- =====================================================================

-- 1A. recommendation_traces — 推荐管道链路追踪
CREATE TABLE IF NOT EXISTS "recommendation_traces" (
    "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"           UUID        NOT NULL,
    "meal_type"         VARCHAR(20) NOT NULL,
    "goal_type"         VARCHAR(30) NOT NULL,
    "channel"           VARCHAR(20) NOT NULL DEFAULT 'unknown',
    "strategy_id"       UUID,
    "strategy_version"  VARCHAR(50),
    "experiment_id"     UUID,
    "group_id"          VARCHAR(30),
    "pipeline_snapshot" JSONB,
    "top_foods"         JSONB,
    "score_stats"       JSONB,
    "food_pool_size"    INTEGER,
    "filters_applied"   JSONB,
    "duration_ms"       INTEGER,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "PK_recommendation_traces" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_rec_traces_user_created"  ON "recommendation_traces" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_rec_traces_strategy"      ON "recommendation_traces" ("strategy_id");
CREATE INDEX IF NOT EXISTS "idx_rec_traces_experiment"    ON "recommendation_traces" ("experiment_id");
CREATE INDEX IF NOT EXISTS "idx_rec_traces_channel"       ON "recommendation_traces" ("channel");
CREATE INDEX IF NOT EXISTS "idx_rec_traces_created"       ON "recommendation_traces" ("created_at");

-- 1B. recipe_translations — 菜谱多语言翻译
CREATE TABLE IF NOT EXISTS "recipe_translations" (
    "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
    "recipe_id"    UUID           NOT NULL,
    "locale"       VARCHAR(10)    NOT NULL,
    "name"         VARCHAR(200)   NOT NULL,
    "description"  TEXT,
    "instructions" JSONB,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "PK_recipe_translations" PRIMARY KEY ("id"),
    CONSTRAINT "uq_recipe_translation_recipe_locale" UNIQUE ("recipe_id", "locale"),
    CONSTRAINT "fk_recipe_translations_recipe"
        FOREIGN KEY ("recipe_id") REFERENCES "recipes" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_recipe_translations_locale" ON "recipe_translations" ("locale");

-- 1C. dead_letter_jobs — BullMQ 死信队列
CREATE TABLE IF NOT EXISTS "dead_letter_jobs" (
    "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
    "queue_name"    VARCHAR(50)    NOT NULL,
    "job_id"        VARCHAR(100)   NOT NULL,
    "job_data"      JSONB          NOT NULL,
    "error_message" TEXT           NOT NULL,
    "attempts_made" INTEGER        NOT NULL DEFAULT 0,
    "status"        VARCHAR(20)    NOT NULL DEFAULT 'pending',
    "failed_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "retried_at"    TIMESTAMPTZ(6),
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "PK_dead_letter_jobs" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_dlj_queue_status" ON "dead_letter_jobs" ("queue_name", "status");
CREATE INDEX IF NOT EXISTS "idx_dlj_failed_at"    ON "dead_letter_jobs" ("failed_at");

-- 1D. daily_plan_items — 每日计划食物明细
CREATE TABLE IF NOT EXISTS "daily_plan_items" (
    "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
    "daily_plan_id" UUID         NOT NULL,
    "meal_type"     VARCHAR(20)  NOT NULL,
    "role"          VARCHAR(20)  NOT NULL,
    "food_id"       UUID,
    "recipe_id"     UUID,
    "food_name"     VARCHAR(200) NOT NULL,
    "calories"      DOUBLE PRECISION,
    "protein"       DOUBLE PRECISION,
    "fat"           DOUBLE PRECISION,
    "carbs"         DOUBLE PRECISION,
    "score"         DOUBLE PRECISION,
    "sort_order"    INTEGER      NOT NULL DEFAULT 0,
    CONSTRAINT "PK_daily_plan_items" PRIMARY KEY ("id"),
    CONSTRAINT "fk_daily_plan_items_plan"
        FOREIGN KEY ("daily_plan_id") REFERENCES "daily_plans" ("id") ON DELETE CASCADE,
    CONSTRAINT "fk_daily_plan_items_food"
        FOREIGN KEY ("food_id") REFERENCES "foods" ("id") ON DELETE SET NULL,
    CONSTRAINT "fk_daily_plan_items_recipe"
        FOREIGN KEY ("recipe_id") REFERENCES "recipes" ("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_dpi_plan_meal" ON "daily_plan_items" ("daily_plan_id", "meal_type");
CREATE INDEX IF NOT EXISTS "idx_dpi_food"      ON "daily_plan_items" ("food_id");
CREATE INDEX IF NOT EXISTS "idx_dpi_recipe"    ON "daily_plan_items" ("recipe_id");

-- 1E. recipe_ratings — 菜谱用户评分
CREATE TABLE IF NOT EXISTS "recipe_ratings" (
    "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
    "recipe_id"  UUID           NOT NULL,
    "user_id"    UUID           NOT NULL,
    "rating"     SMALLINT       NOT NULL,
    "comment"    TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "PK_recipe_ratings" PRIMARY KEY ("id"),
    CONSTRAINT "uq_recipe_rating_recipe_user" UNIQUE ("recipe_id", "user_id"),
    CONSTRAINT "fk_recipe_ratings_recipe"
        FOREIGN KEY ("recipe_id") REFERENCES "recipes" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_recipe_ratings_user"   ON "recipe_ratings" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_recipe_ratings_recipe" ON "recipe_ratings" ("recipe_id");

-- 1F. strategy_tuning_log — 策略调优历史
CREATE TABLE IF NOT EXISTS "strategy_tuning_log" (
    "id"                UUID           NOT NULL DEFAULT gen_random_uuid(),
    "segment_name"      VARCHAR(50)    NOT NULL,
    "previous_strategy" VARCHAR(50)    NOT NULL,
    "new_strategy"      VARCHAR(50)    NOT NULL,
    "previous_rate"     DOUBLE PRECISION NOT NULL,
    "new_rate"          DOUBLE PRECISION NOT NULL,
    "improvement"       DOUBLE PRECISION NOT NULL,
    "auto_applied"      BOOLEAN        NOT NULL DEFAULT false,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "PK_strategy_tuning_log" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_stl_segment" ON "strategy_tuning_log" ("segment_name");
CREATE INDEX IF NOT EXISTS "idx_stl_created"  ON "strategy_tuning_log" ("created_at");

-- 1G. replacement_patterns — 替换模式聚合
CREATE TABLE IF NOT EXISTS "replacement_patterns" (
    "id"             UUID           NOT NULL DEFAULT gen_random_uuid(),
    "user_id"        UUID           NOT NULL,
    "from_food_id"   UUID           NOT NULL,
    "from_food_name" VARCHAR(200)   NOT NULL,
    "to_food_id"     UUID           NOT NULL,
    "to_food_name"   VARCHAR(200)   NOT NULL,
    "frequency"      INTEGER        NOT NULL DEFAULT 1,
    "last_occurred"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "PK_replacement_patterns" PRIMARY KEY ("id"),
    CONSTRAINT "uq_replacement_pattern" UNIQUE ("user_id", "from_food_id", "to_food_id")
);

CREATE INDEX IF NOT EXISTS "idx_rp_user"      ON "replacement_patterns" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_rp_from_food" ON "replacement_patterns" ("from_food_id");

-- =====================================================================
-- SECTION 2: New Columns on Existing Tables
-- =====================================================================

-- 2A. foods.commonality_score — 大众化评分 0-100
ALTER TABLE "foods"
    ADD COLUMN IF NOT EXISTS "commonality_score" INTEGER NOT NULL DEFAULT 50;

CREATE INDEX IF NOT EXISTS "idx_foods_commonality" ON "foods" ("commonality_score");

-- 2B. foods.available_channels — 可获取渠道 JSONB
ALTER TABLE "foods"
    ADD COLUMN IF NOT EXISTS "available_channels" JSONB NOT NULL DEFAULT '["home_cook","restaurant","delivery","convenience"]';

-- 2C. recommendation_feedbacks.trace_id — 关联 recommendation_traces.id
ALTER TABLE "recommendation_feedbacks"
    ADD COLUMN IF NOT EXISTS "trace_id" UUID;

CREATE INDEX IF NOT EXISTS "idx_rec_feedbacks_trace_id" ON "recommendation_feedbacks" ("trace_id");

-- =====================================================================
-- SECTION 3: FK Constraints on Existing Tables
-- Defensive pattern: clean orphan rows before adding each constraint.
-- =====================================================================

-- 3A. daily_plans.user_id → app_users.id
DELETE FROM "daily_plans"
WHERE "user_id" NOT IN (SELECT "id" FROM "app_users");

ALTER TABLE "daily_plans"
    DROP CONSTRAINT IF EXISTS "fk_daily_plans_user";
ALTER TABLE "daily_plans"
    ADD CONSTRAINT "fk_daily_plans_user"
        FOREIGN KEY ("user_id") REFERENCES "app_users" ("id") ON DELETE CASCADE;

-- 3B. strategy_assignment.user_id → app_users.id
DELETE FROM "strategy_assignment"
WHERE "user_id" NOT IN (SELECT "id" FROM "app_users");

ALTER TABLE "strategy_assignment"
    DROP CONSTRAINT IF EXISTS "fk_strategy_assignment_user";
ALTER TABLE "strategy_assignment"
    ADD CONSTRAINT "fk_strategy_assignment_user"
        FOREIGN KEY ("user_id") REFERENCES "app_users" ("id") ON DELETE CASCADE;

-- 3C. strategy_assignment.strategy_id → strategy.id
--     strategy_id is already nullable (String? in schema), just add the FK
UPDATE "strategy_assignment"
SET "strategy_id" = NULL
WHERE "strategy_id" IS NOT NULL
  AND "strategy_id" NOT IN (SELECT "id" FROM "strategy");

ALTER TABLE "strategy_assignment"
    DROP CONSTRAINT IF EXISTS "fk_strategy_assignment_strategy";
ALTER TABLE "strategy_assignment"
    ADD CONSTRAINT "fk_strategy_assignment_strategy"
        FOREIGN KEY ("strategy_id") REFERENCES "strategy" ("id") ON DELETE SET NULL;

-- 3D. notification.user_id → app_users.id  (table name is "notification", not "notifications")
DELETE FROM "notification"
WHERE "user_id" NOT IN (SELECT "id" FROM "app_users");

ALTER TABLE "notification"
    DROP CONSTRAINT IF EXISTS "fk_notification_user";
ALTER TABLE "notification"
    ADD CONSTRAINT "fk_notification_user"
        FOREIGN KEY ("user_id") REFERENCES "app_users" ("id") ON DELETE CASCADE;

-- 3E. weight_history.user_id → app_users.id
DELETE FROM "weight_history"
WHERE "user_id" NOT IN (SELECT "id" FROM "app_users");

ALTER TABLE "weight_history"
    DROP CONSTRAINT IF EXISTS "fk_weight_history_user";
ALTER TABLE "weight_history"
    ADD CONSTRAINT "fk_weight_history_user"
        FOREIGN KEY ("user_id") REFERENCES "app_users" ("id") ON DELETE CASCADE;

-- 3F. user_behavior_profiles.user_id → app_users.id
DELETE FROM "user_behavior_profiles"
WHERE "user_id" NOT IN (SELECT "id" FROM "app_users");

ALTER TABLE "user_behavior_profiles"
    DROP CONSTRAINT IF EXISTS "fk_behavior_profiles_user";
ALTER TABLE "user_behavior_profiles"
    ADD CONSTRAINT "fk_behavior_profiles_user"
        FOREIGN KEY ("user_id") REFERENCES "app_users" ("id") ON DELETE CASCADE;

-- =====================================================================
-- SECTION 4: Drop Duplicate Indexes
-- =====================================================================

DROP INDEX IF EXISTS "IDX_c147959a431fea61665d0e8bf4"; -- foods.category duplicate
DROP INDEX IF EXISTS "IDX_68aa1d0fe3ef6b57e4fd922033"; -- foods.status duplicate
DROP INDEX IF EXISTS "IDX_0e3bd85e37aa82a7ccdd76e135"; -- foods.primary_source duplicate
DROP INDEX IF EXISTS "IDX_94919a5b0af8952c73beb42fbc"; -- foods.barcode duplicate

-- =====================================================================
-- SECTION 5: Timestamp Unification (timestamp → timestamptz)
-- No-op on already-timestamptz columns; PostgreSQL preserves existing values.
-- =====================================================================

ALTER TABLE "foods"                    ALTER COLUMN "created_at"        TYPE TIMESTAMPTZ(6);
ALTER TABLE "foods"                    ALTER COLUMN "updated_at"        TYPE TIMESTAMPTZ(6);
ALTER TABLE "foods"                    ALTER COLUMN "verified_at"       TYPE TIMESTAMPTZ(6);
ALTER TABLE "foods"                    ALTER COLUMN "embedding_updated_at" TYPE TIMESTAMPTZ(6);

ALTER TABLE "daily_plans"              ALTER COLUMN "created_at"        TYPE TIMESTAMPTZ(6);
ALTER TABLE "daily_plans"              ALTER COLUMN "updated_at"        TYPE TIMESTAMPTZ(6);

ALTER TABLE "daily_summaries"          ALTER COLUMN "created_at"        TYPE TIMESTAMPTZ(6);

ALTER TABLE "food_records"             ALTER COLUMN "recorded_at"       TYPE TIMESTAMPTZ(6);
ALTER TABLE "food_records"             ALTER COLUMN "created_at"        TYPE TIMESTAMPTZ(6);
ALTER TABLE "food_records"             ALTER COLUMN "updated_at"        TYPE TIMESTAMPTZ(6);

ALTER TABLE "recommendation_feedbacks" ALTER COLUMN "created_at"        TYPE TIMESTAMPTZ(6);

ALTER TABLE "user_profiles"            ALTER COLUMN "created_at"        TYPE TIMESTAMPTZ(6);
ALTER TABLE "user_profiles"            ALTER COLUMN "updated_at"        TYPE TIMESTAMPTZ(6);

ALTER TABLE "user_behavior_profiles"   ALTER COLUMN "updated_at"        TYPE TIMESTAMPTZ(6);

ALTER TABLE "user_inferred_profiles"   ALTER COLUMN "last_computed_at"  TYPE TIMESTAMPTZ(6);
ALTER TABLE "user_inferred_profiles"   ALTER COLUMN "updated_at"        TYPE TIMESTAMPTZ(6);

ALTER TABLE "app_users"                ALTER COLUMN "last_login_at"     TYPE TIMESTAMPTZ(6);
ALTER TABLE "app_users"                ALTER COLUMN "created_at"        TYPE TIMESTAMPTZ(6);
ALTER TABLE "app_users"                ALTER COLUMN "updated_at"        TYPE TIMESTAMPTZ(6);

ALTER TABLE "weight_history"           ALTER COLUMN "recorded_at"       TYPE TIMESTAMPTZ(6);

ALTER TABLE "recipe_translations"      ALTER COLUMN "created_at"        TYPE TIMESTAMPTZ(6);
ALTER TABLE "recipe_translations"      ALTER COLUMN "updated_at"        TYPE TIMESTAMPTZ(6);

ALTER TABLE "profile_snapshots"        ALTER COLUMN "created_at"        TYPE TIMESTAMPTZ(6);

ALTER TABLE "coach_conversations"      ALTER COLUMN "created_at"        TYPE TIMESTAMPTZ(6);
ALTER TABLE "coach_conversations"      ALTER COLUMN "updated_at"        TYPE TIMESTAMPTZ(6);

-- =====================================================================
-- SECTION 6: pgvector HNSW Index on foods.embedding_v5
-- Runs only if pgvector extension is available; otherwise silently skipped
-- via DO block.
-- =====================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE tablename = 'foods'
              AND indexname = 'idx_foods_embedding_v5_hnsw'
        ) THEN
            EXECUTE 'CREATE INDEX idx_foods_embedding_v5_hnsw
                     ON foods USING hnsw (embedding_v5 vector_cosine_ops)
                     WITH (m = 16, ef_construction = 64)';
        END IF;
    END IF;
END
$$;

-- =====================================================================
-- SECTION 7: Seed replacement_patterns from existing feedback history
-- Only inserts where at least 2 replace→accept pairs exist within 10 min.
-- Uses ON CONFLICT to make this idempotent.
-- =====================================================================

INSERT INTO replacement_patterns (
    id, user_id, from_food_id, from_food_name,
    to_food_id, to_food_name, frequency, last_occurred, created_at, updated_at
)
SELECT
    gen_random_uuid(),
    f1.user_id::uuid,
    f1.food_id::uuid           AS from_food_id,
    f1.food_name               AS from_food_name,
    f2.food_id::uuid           AS to_food_id,
    f2.food_name               AS to_food_name,
    COUNT(*)                   AS frequency,
    MAX(f2.created_at)         AS last_occurred,
    NOW()                      AS created_at,
    NOW()                      AS updated_at
FROM recommendation_feedbacks f1
JOIN recommendation_feedbacks f2
    ON  f1.user_id   = f2.user_id
    AND f1.action    = 'replaced'
    AND f2.action    = 'accepted'
    AND f2.created_at BETWEEN f1.created_at AND f1.created_at + INTERVAL '10 minutes'
    AND f1.food_id  IS NOT NULL
    AND f2.food_id  IS NOT NULL
    AND f1.food_id  != f2.food_id
GROUP BY f1.user_id, f1.food_id, f1.food_name, f2.food_id, f2.food_name
HAVING COUNT(*) >= 2
ON CONFLICT (user_id, from_food_id, to_food_id) DO UPDATE
    SET frequency     = EXCLUDED.frequency,
        last_occurred = EXCLUDED.last_occurred,
        updated_at    = NOW();
