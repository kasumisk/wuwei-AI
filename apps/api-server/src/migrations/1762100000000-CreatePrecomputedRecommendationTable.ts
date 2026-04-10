import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V6 Phase 1.10 — 创建预计算推荐表
 */
export class CreatePrecomputedRecommendationTable1762100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "precomputed_recommendations" (
        "id"                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "user_id"           UUID NOT NULL,
        "date"              VARCHAR(10) NOT NULL,
        "meal_type"         VARCHAR(20) NOT NULL,
        "result"            JSONB NOT NULL,
        "scenario_results"  JSONB,
        "strategy_version"  VARCHAR(50) NOT NULL,
        "computed_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "expires_at"        TIMESTAMPTZ NOT NULL,
        "is_used"           BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "uq_precomputed_user_date_meal"
          UNIQUE ("user_id", "date", "meal_type")
      );
    `);

    // 过期索引 — 定期清理过期记录
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_precomputed_expires"
        ON "precomputed_recommendations" ("expires_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "precomputed_recommendations";`,
    );
  }
}
