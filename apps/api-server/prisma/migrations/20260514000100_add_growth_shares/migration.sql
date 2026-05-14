CREATE TABLE IF NOT EXISTS "growth_shares" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "token" VARCHAR(32) NOT NULL,
  "user_id" UUID,
  "share_type" VARCHAR(32) NOT NULL,
  "source_type" VARCHAR(32) NOT NULL,
  "source_id" UUID,
  "visibility" VARCHAR(20) NOT NULL DEFAULT 'unlisted',
  "snapshot" JSONB NOT NULL,
  "locale" VARCHAR(10),
  "title" VARCHAR(180),
  "description" VARCHAR(320),
  "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  "expires_at" TIMESTAMPTZ(6),
  "view_count" INTEGER NOT NULL DEFAULT 0,
  "click_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "growth_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "growth_shares_token_key" ON "growth_shares"("token");
CREATE INDEX IF NOT EXISTS "idx_growth_shares_user_created" ON "growth_shares"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_growth_shares_source" ON "growth_shares"("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "idx_growth_shares_status_visibility" ON "growth_shares"("status", "visibility");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_growth_shares_user'
  ) THEN
    ALTER TABLE "growth_shares"
      ADD CONSTRAINT "fk_growth_shares_user"
      FOREIGN KEY ("user_id") REFERENCES "app_users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
