/**
 * V6.1 Phase 1.8 — food_records 表新增 analysis_id 列和来源枚举值
 *
 * 变更:
 * 1. 新增 analysis_id 可空 UUID 列，关联 food_analysis_record
 * 2. 新增 RecordSource 枚举值: text_analysis, image_analysis
 * 3. 新增 analysis_id 索引（查询分析关联记录）
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalysisIdToFoodRecord1762900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 新增 analysis_id 列
    await queryRunner.query(`
      ALTER TABLE food_records
      ADD COLUMN IF NOT EXISTS analysis_id UUID DEFAULT NULL
    `);

    // 2. 添加注释
    await queryRunner.query(`
      COMMENT ON COLUMN food_records.analysis_id IS '关联分析记录 ID（food_analysis_record.id）'
    `);

    // 3. 创建索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_food_record_analysis_id
      ON food_records (analysis_id)
      WHERE analysis_id IS NOT NULL
    `);

    // 4. 扩展 source 枚举类型（PostgreSQL 枚举需要 ALTER TYPE）
    // 先检查枚举值是否已存在再添加
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'text_analysis'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'food_records_source_enum')
        ) THEN
          ALTER TYPE food_records_source_enum ADD VALUE 'text_analysis';
        END IF;
      END$$
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'image_analysis'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'food_records_source_enum')
        ) THEN
          ALTER TYPE food_records_source_enum ADD VALUE 'image_analysis';
        END IF;
      END$$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 删除索引
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_food_record_analysis_id
    `);

    // 删除列
    await queryRunner.query(`
      ALTER TABLE food_records DROP COLUMN IF EXISTS analysis_id
    `);

    // 注意: PostgreSQL 不支持直接删除枚举值，回滚时不处理枚举变更
  }
}
