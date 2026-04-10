import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V6 Phase 1.5 — 创建功能开关表
 */
export class CreateFeatureFlagTable1762000000000 implements MigrationInterface {
  name = 'CreateFeatureFlagTable1762000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 创建功能开关类型枚举
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feature_flag_type_enum') THEN
          CREATE TYPE "feature_flag_type_enum" AS ENUM ('boolean', 'percentage', 'user_list', 'segment');
        END IF;
      END$$
    `);

    // 创建 feature_flag 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "feature_flag" (
        "id"          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
        "key"         VARCHAR(100)    NOT NULL UNIQUE,
        "name"        VARCHAR(200)    NOT NULL,
        "description" TEXT,
        "type"        "feature_flag_type_enum" NOT NULL DEFAULT 'boolean',
        "enabled"     BOOLEAN         NOT NULL DEFAULT false,
        "config"      JSONB           NOT NULL DEFAULT '{}'::jsonb,
        "created_at"  TIMESTAMP       NOT NULL DEFAULT NOW(),
        "updated_at"  TIMESTAMP       NOT NULL DEFAULT NOW()
      )
    `);

    // 创建索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feature_flag_key"
      ON "feature_flag" ("key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "feature_flag"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "feature_flag_type_enum"`);
  }
}
