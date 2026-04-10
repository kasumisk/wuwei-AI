/**
 * V6.1 Phase 2.1 — 创建 food_candidate 表
 *
 * 候选食物表: 从分析链路沉淀的未入库食物，
 * 多次命中 + 质量达标后可推入审核队列，审核通过合并入 food_library。
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFoodCandidateTable1763000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS food_candidate (
        id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        canonical_name  VARCHAR(120)  NOT NULL,
        aliases         JSONB         DEFAULT '[]'::jsonb,
        category        VARCHAR(30)   DEFAULT NULL,
        estimated_nutrition JSONB     DEFAULT NULL,
        source_type     VARCHAR(20)   NOT NULL,
        source_count    INT           DEFAULT 1,
        avg_confidence  DECIMAL(5,2)  DEFAULT 0,
        quality_score   DECIMAL(5,2)  DEFAULT 0,
        review_status   VARCHAR(20)   DEFAULT 'pending',
        merged_food_id  UUID          DEFAULT NULL,
        first_seen_at   TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
        last_seen_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_food_candidate_canonical_name
      ON food_candidate (canonical_name)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_food_candidate_review_status
      ON food_candidate (review_status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_food_candidate_source_type
      ON food_candidate (source_type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_food_candidate_source_count
      ON food_candidate (source_count DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS food_candidate`);
  }
}
