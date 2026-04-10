import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V6 Phase 2.17 — 创建画像变更日志表
 *
 * profile_change_log: 记录用户画像每次变更的前后值、变更原因和触发来源。
 * 用于画像回溯、变更审计、推荐调试、版本化追踪。
 */
export class CreateProfileChangeLogTable1762500000000 implements MigrationInterface {
  name = 'CreateProfileChangeLogTable1762500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "profile_change_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "version" int NOT NULL,
        "change_type" varchar(32) NOT NULL,
        "source" varchar(32) NOT NULL,
        "changed_fields" jsonb NOT NULL DEFAULT '[]',
        "before_values" jsonb NOT NULL DEFAULT '{}',
        "after_values" jsonb NOT NULL DEFAULT '{}',
        "trigger_event" varchar(128),
        "reason" text,
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_profile_change_log" PRIMARY KEY ("id")
      )
    `);

    // 按用户查询
    await queryRunner.query(`
      CREATE INDEX "idx_profile_change_log_user"
      ON "profile_change_log" ("user_id")
    `);

    // 按用户 + 类型查询
    await queryRunner.query(`
      CREATE INDEX "idx_profile_change_log_user_type"
      ON "profile_change_log" ("user_id", "change_type")
    `);

    // 按用户 + 版本查询（回溯用）
    await queryRunner.query(`
      CREATE INDEX "idx_profile_change_log_user_version"
      ON "profile_change_log" ("user_id", "version")
    `);

    // 按创建时间查询（时间范围过滤）
    await queryRunner.query(`
      CREATE INDEX "idx_profile_change_log_created"
      ON "profile_change_log" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_profile_change_log_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_profile_change_log_user_version"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_profile_change_log_user_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_profile_change_log_user"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_change_log"`);
  }
}
