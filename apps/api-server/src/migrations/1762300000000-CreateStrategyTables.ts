import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V6 Phase 2.1 — 创建策略引擎表
 *
 * - strategy: 推荐策略配置（JSONB 存储策略参数）
 * - strategy_assignment: 用户→策略映射
 */
export class CreateStrategyTables1762300000000 implements MigrationInterface {
  name = 'CreateStrategyTables1762300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── strategy 表 ───
    await queryRunner.query(`
      CREATE TABLE "strategy" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(128) NOT NULL,
        "description" text,
        "scope" varchar(32) NOT NULL DEFAULT 'global',
        "scope_target" varchar(128),
        "config" jsonb NOT NULL DEFAULT '{}',
        "status" varchar(16) NOT NULL DEFAULT 'draft',
        "version" int NOT NULL DEFAULT 1,
        "priority" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_strategy" PRIMARY KEY ("id")
      )
    `);

    // 策略查找索引：按 scope + status
    await queryRunner.query(`
      CREATE INDEX "idx_strategy_scope_status"
      ON "strategy" ("scope", "status")
    `);

    // 策略查找索引：按 scope + scopeTarget + status
    await queryRunner.query(`
      CREATE INDEX "idx_strategy_scope_target"
      ON "strategy" ("scope", "scope_target", "status")
    `);

    // ─── strategy_assignment 表 ───
    await queryRunner.query(`
      CREATE TABLE "strategy_assignment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "strategy_id" uuid NOT NULL,
        "assignment_type" varchar(32) NOT NULL DEFAULT 'manual',
        "source" varchar(128),
        "is_active" boolean NOT NULL DEFAULT true,
        "active_from" timestamptz,
        "active_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_strategy_assignment" PRIMARY KEY ("id")
      )
    `);

    // 用户查找索引
    await queryRunner.query(`
      CREATE INDEX "idx_strategy_assignment_user"
      ON "strategy_assignment" ("user_id")
    `);

    // 用户+类型查找索引
    await queryRunner.query(`
      CREATE INDEX "idx_strategy_assignment_user_type"
      ON "strategy_assignment" ("user_id", "assignment_type")
    `);

    // 策略引用查找索引
    await queryRunner.query(`
      CREATE INDEX "idx_strategy_assignment_strategy"
      ON "strategy_assignment" ("strategy_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "strategy_assignment"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "strategy"`);
  }
}
