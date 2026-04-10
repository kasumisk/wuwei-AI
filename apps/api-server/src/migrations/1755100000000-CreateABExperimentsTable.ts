import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateABExperimentsTable1755100000000 implements MigrationInterface {
  name = 'CreateABExperimentsTable1755100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 创建实验状态枚举类型
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ab_experiments_status_enum') THEN
          CREATE TYPE "ab_experiments_status_enum" AS ENUM ('draft', 'running', 'paused', 'completed');
        END IF;
      END$$
    `);

    // 创建 ab_experiments 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ab_experiments" (
        "id"          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"        VARCHAR(100) NOT NULL,
        "description" TEXT,
        "goal_type"   VARCHAR(30)  NOT NULL DEFAULT '*',
        "status"      "ab_experiments_status_enum" NOT NULL DEFAULT 'draft',
        "groups"      JSONB        NOT NULL DEFAULT '[]'::jsonb,
        "start_date"  TIMESTAMP,
        "end_date"    TIMESTAMP,
        "created_at"  TIMESTAMP    NOT NULL DEFAULT NOW(),
        "updated_at"  TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `);

    // 创建索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ab_experiments_status"
      ON "ab_experiments" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ab_experiments_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ab_experiments"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ab_experiments_status_enum"`);
  }
}
