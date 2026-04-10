import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 食物库新增 tags / source / confidence 字段
 * 并根据已有营养数据自动回填 tags
 */
export class AddFoodLibraryTagsAndSource1751100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 添加新列
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'official',
        ADD COLUMN IF NOT EXISTS confidence DECIMAL(3,2) DEFAULT 1.00
    `);

    await queryRunner.query(
      `COMMENT ON COLUMN foods.tags IS '标签数组: 高蛋白/低热量/高饱腹/高脂肪/高碳水/均衡/天然/外卖 等'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN foods.source IS '数据来源: official/estimated/ai'`,
    );
    await queryRunner.query(
      `COMMENT ON COLUMN foods.confidence IS '营养数据置信度 0-1'`,
    );

    // 2. 基于营养数据自动回填 tags（兼容新旧 foods schema）
    const currentSchemaColumns = await queryRunner.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'foods'
        AND column_name IN ('calories', 'protein', 'fat', 'carbs')
    `);

    const useCurrentSchema = currentSchemaColumns.length === 4;
    const caloriesColumn = useCurrentSchema ? 'calories' : 'calories_per_100g';
    const proteinColumn = useCurrentSchema ? 'protein' : 'protein_per_100g';
    const fatColumn = useCurrentSchema ? 'fat' : 'fat_per_100g';
    const carbsColumn = useCurrentSchema ? 'carbs' : 'carbs_per_100g';

    await queryRunner.query(`
      UPDATE foods SET tags = (
        SELECT COALESCE(jsonb_agg(DISTINCT tag), '[]'::jsonb) FROM (
          SELECT category AS tag
          UNION ALL
          SELECT 'high_protein' WHERE COALESCE(${proteinColumn}, 0) >= 15
          UNION ALL
          SELECT 'low_calorie' WHERE COALESCE(${caloriesColumn}, 0) <= 80
          UNION ALL
          SELECT 'ultra_low_calorie' WHERE COALESCE(${caloriesColumn}, 0) <= 30
          UNION ALL
          SELECT 'high_fat' WHERE COALESCE(${fatColumn}, 0) >= 15
          UNION ALL
          SELECT 'high_carb' WHERE COALESCE(${carbsColumn}, 0) >= 30
          UNION ALL
          SELECT 'low_fat' WHERE COALESCE(${fatColumn}, 0) <= 3
          UNION ALL
          SELECT 'high_satiety' WHERE COALESCE(${proteinColumn}, 0) >= 10
            AND (COALESCE(${fatColumn}, 0) >= 5 OR COALESCE(${carbsColumn}, 0) >= 15)
          UNION ALL
          SELECT 'natural' WHERE category IN ('veggie', 'fruit', 'dairy', '蔬菜', '水果', '豆制品')
          UNION ALL
          SELECT 'balanced' WHERE COALESCE(${proteinColumn}, 0) BETWEEN 5 AND 25
            AND COALESCE(${fatColumn}, 0) BETWEEN 2 AND 15
            AND COALESCE(${carbsColumn}, 0) BETWEEN 5 AND 35
          UNION ALL
          SELECT 'takeout' WHERE category IN ('composite', '快餐')
        ) sub WHERE tag IS NOT NULL
      )
    `);

    // 3. 对已验证的数据设置高置信度
    await queryRunner.query(
      `UPDATE foods SET confidence = 0.95 WHERE is_verified = true`,
    );
    await queryRunner.query(
      `UPDATE foods SET confidence = 0.70 WHERE is_verified = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE foods
        DROP COLUMN IF EXISTS tags,
        DROP COLUMN IF EXISTS source,
        DROP COLUMN IF EXISTS confidence
    `);
  }
}
