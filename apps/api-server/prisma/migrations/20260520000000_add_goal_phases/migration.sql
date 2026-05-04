-- goal_phases table was defined in Prisma schema but never had a migration.
-- Creating it here to resolve schema drift.

CREATE TABLE IF NOT EXISTS "goal_phases" (
  "id"                   UUID          NOT NULL DEFAULT gen_random_uuid(),
  "user_id"              UUID          NOT NULL,
  "goal_type"            VARCHAR(50)   NOT NULL,
  "name"                 VARCHAR(100)  NOT NULL,
  "duration_weeks"       INTEGER       NOT NULL,
  "calorie_multiplier"   DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "macro_ratio_override" JSONB,
  "phase_order"          INTEGER       NOT NULL,
  "is_active"            BOOLEAN       NOT NULL DEFAULT false,
  "started_at"           TIMESTAMPTZ(6),
  "completed_at"         TIMESTAMPTZ(6),
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "goal_phases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_goal_phases_user_active"
  ON "goal_phases" ("user_id", "is_active");

CREATE INDEX IF NOT EXISTS "idx_goal_phases_user_order"
  ON "goal_phases" ("user_id", "phase_order");
