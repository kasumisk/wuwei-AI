import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V6 Phase 1.11 — 创建通知相关表
 *
 * 3 张表:
 * - notification: 站内信/系统通知
 * - notification_preference: 用户通知偏好
 * - device_token: FCM 推送设备令牌
 */
export class CreateNotificationTables1762200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. notification 表（站内信）
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification" (
        "id"          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "user_id"     UUID NOT NULL,
        "type"        VARCHAR(30) NOT NULL,
        "title"       VARCHAR(200) NOT NULL,
        "body"        TEXT NOT NULL,
        "data"        JSONB,
        "is_read"     BOOLEAN NOT NULL DEFAULT FALSE,
        "read_at"     TIMESTAMPTZ,
        "is_pushed"   BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_user_unread"
        ON "notification" ("user_id", "is_read");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_user_created"
        ON "notification" ("user_id", "created_at");
    `);

    // 2. notification_preference 表（通知偏好）
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_preference" (
        "id"             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "user_id"        UUID NOT NULL UNIQUE,
        "push_enabled"   BOOLEAN NOT NULL DEFAULT TRUE,
        "enabled_types"  JSONB NOT NULL DEFAULT '[]',
        "quiet_start"    VARCHAR(5),
        "quiet_end"      VARCHAR(5),
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_notification_pref_user"
        ON "notification_preference" ("user_id");
    `);

    // 3. device_token 表（推送设备令牌）
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "device_token" (
        "id"          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "user_id"     UUID NOT NULL,
        "token"       VARCHAR(500) NOT NULL,
        "device_id"   VARCHAR(200) NOT NULL,
        "platform"    VARCHAR(10) NOT NULL,
        "is_active"   BOOLEAN NOT NULL DEFAULT TRUE,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_device_token_user"
        ON "device_token" ("user_id");
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_device_token_lookup"
        ON "device_token" ("user_id", "device_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "device_token";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_preference";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification";`);
  }
}
