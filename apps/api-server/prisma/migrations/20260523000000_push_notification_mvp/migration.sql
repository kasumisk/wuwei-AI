CREATE TYPE "push_region_enum" AS ENUM ('GLOBAL', 'CHINA_MAINLAND', 'EU', 'JAPAN', 'KOREA');
CREATE TYPE "push_provider_type_enum" AS ENUM ('FCM', 'JPUSH', 'HUAWEI', 'MOCK');
CREATE TYPE "push_platform_enum" AS ENUM ('IOS', 'ANDROID', 'WEB');
CREATE TYPE "push_notification_type_enum" AS ENUM ('DAILY_CHECK_IN', 'NO_ANALYSIS_TODAY', 'WEEKLY_REPORT_READY', 'ANALYSIS_FOLLOW_UP', 'PREMIUM_UPGRADE_HINT');
CREATE TYPE "push_delivery_status_enum" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "push_device_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token" VARCHAR(1024) NOT NULL,
  "device_id" VARCHAR(200) NOT NULL,
  "platform" "push_platform_enum" NOT NULL,
  "push_region" "push_region_enum" NOT NULL DEFAULT 'GLOBAL',
  "provider_type" "push_provider_type_enum" NOT NULL,
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "locale" VARCHAR(16) NOT NULL DEFAULT 'en',
  "app_version" VARCHAR(64),
  "device_brand" VARCHAR(64),
  "rom_type" VARCHAR(64),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "disabled_at" TIMESTAMPTZ(6),
  "invalidated_at" TIMESTAMPTZ(6),
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_device_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_notification_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "device_token_id" UUID,
  "notification_type" "push_notification_type_enum" NOT NULL,
  "provider_type" "push_provider_type_enum" NOT NULL,
  "push_region" "push_region_enum" NOT NULL DEFAULT 'GLOBAL',
  "status" "push_delivery_status_enum" NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "payload" JSONB,
  "provider_message_id" VARCHAR(255),
  "error_code" VARCHAR(100),
  "error_message" TEXT,
  "scheduled_for" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_notification_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_notification_preferences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "push_enabled" BOOLEAN NOT NULL DEFAULT true,
  "daily_check_in_enabled" BOOLEAN NOT NULL DEFAULT true,
  "no_analysis_today_enabled" BOOLEAN NOT NULL DEFAULT true,
  "weekly_report_enabled" BOOLEAN NOT NULL DEFAULT true,
  "analysis_follow_up_enabled" BOOLEAN NOT NULL DEFAULT true,
  "premium_upgrade_hint_enabled" BOOLEAN NOT NULL DEFAULT true,
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "locale" VARCHAR(16) NOT NULL DEFAULT 'en',
  "quiet_start" VARCHAR(5) NOT NULL DEFAULT '22:00',
  "quiet_end" VARCHAR(5) NOT NULL DEFAULT '08:00',
  "daily_reminder_time" VARCHAR(5) NOT NULL DEFAULT '09:00',
  "no_analysis_reminder_time" VARCHAR(5) NOT NULL DEFAULT '19:00',
  "weekly_report_day" INTEGER NOT NULL DEFAULT 1,
  "weekly_report_time" VARCHAR(5) NOT NULL DEFAULT '09:00',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_push_device_token_provider_token" ON "push_device_tokens"("provider_type", "token");
CREATE UNIQUE INDEX "uq_push_device_token_user_device_provider" ON "push_device_tokens"("user_id", "device_id", "provider_type");
CREATE INDEX "idx_push_device_token_user_active" ON "push_device_tokens"("user_id", "is_active");
CREATE INDEX "idx_push_device_token_provider_active" ON "push_device_tokens"("push_region", "provider_type", "is_active");
CREATE INDEX "idx_push_log_user_type_created" ON "push_notification_logs"("user_id", "notification_type", "created_at");
CREATE INDEX "idx_push_log_device_created" ON "push_notification_logs"("device_token_id", "created_at");
CREATE INDEX "idx_push_log_status_created" ON "push_notification_logs"("status", "created_at");
CREATE UNIQUE INDEX "uq_user_notification_preference_user" ON "user_notification_preferences"("user_id");

ALTER TABLE "push_device_tokens" ADD CONSTRAINT "fk_push_device_token_user" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_notification_logs" ADD CONSTRAINT "fk_push_notification_log_user" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_notification_logs" ADD CONSTRAINT "fk_push_notification_log_device_token" FOREIGN KEY ("device_token_id") REFERENCES "push_device_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "fk_user_notification_preference_user" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
