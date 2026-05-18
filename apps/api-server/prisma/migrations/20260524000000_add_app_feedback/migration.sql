CREATE TABLE "app_feedbacks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "category" VARCHAR(30) NOT NULL DEFAULT 'general',
  "content" TEXT NOT NULL,
  "contact" VARCHAR(120),
  "status" VARCHAR(30) NOT NULL DEFAULT 'open',
  "metadata" JSONB DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_feedbacks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_app_feedbacks_user_created" ON "app_feedbacks"("user_id", "created_at" DESC);
CREATE INDEX "idx_app_feedbacks_status_created" ON "app_feedbacks"("status", "created_at" DESC);

ALTER TABLE "app_feedbacks"
  ADD CONSTRAINT "fk_app_feedbacks_user"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
