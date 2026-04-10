/**
 * V6.1 Phase 2.2 — 创建 analysis_food_link 表
 *
 * 分析-食物关联表: 记录每次分析中识别出的食物与标准库/候选库的匹配关系。
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnalysisFoodLinkTable1763100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS analysis_food_link (
        id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        analysis_id         UUID          NOT NULL,
        food_library_id     UUID          DEFAULT NULL,
        food_candidate_id   UUID          DEFAULT NULL,
        food_name           VARCHAR(120)  NOT NULL,
        match_type          VARCHAR(20)   NOT NULL,
        confidence          DECIMAL(5,2)  DEFAULT 0,
        created_at          TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT fk_afl_analysis
          FOREIGN KEY (analysis_id)
          REFERENCES food_analysis_record(id) ON DELETE CASCADE,

        CONSTRAINT fk_afl_food_library
          FOREIGN KEY (food_library_id)
          REFERENCES foods(id) ON DELETE SET NULL,

        CONSTRAINT fk_afl_food_candidate
          FOREIGN KEY (food_candidate_id)
          REFERENCES food_candidate(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_analysis_food_link_analysis_id
      ON analysis_food_link (analysis_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_analysis_food_link_food_library_id
      ON analysis_food_link (food_library_id)
      WHERE food_library_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_analysis_food_link_food_candidate_id
      ON analysis_food_link (food_candidate_id)
      WHERE food_candidate_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS analysis_food_link`);
  }
}
