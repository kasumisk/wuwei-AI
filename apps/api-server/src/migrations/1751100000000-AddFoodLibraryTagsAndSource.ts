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

    await queryRunner.query(`COMMENT ON COLUMN foods.tags IS '标签数组: 高蛋白/低热量/高饱腹/高脂肪/高碳水/均衡/天然/外卖 等'`);
    await queryRunner.query(`COMMENT ON COLUMN foods.source IS '数据来源: official/estimated/ai'`);
    await queryRunner.query(`COMMENT ON COLUMN foods.confidence IS '营养数据置信度 0-1'`);

    // 2. 基于营养数据自动回填 tags（纯 SQL，覆盖所有已有记录）
    //    规则：
    //    - 高蛋白: protein_per_100g >= 15
    //    - 低热量: calories_per_100g <= 80
    //    - 超低热量: calories_per_100g <= 30
    //    - 高脂肪: fat_per_100g >= 15
    //    - 高碳水: carbs_per_100g >= 30
    //    - 低脂: fat_per_100g <= 3
    //    - 高饱腹: protein_per_100g >= 10 AND (fat_per_100g >= 5 OR carbs_per_100g >= 15)
    //    - 天然: category IN (蔬菜, 水果)
    //    - 均衡: 10 <= protein <= 25 AND 3 <= fat <= 15 AND 10 <= carbs <= 35
    //    - 外卖: category = 快餐
    //    - category 本身也作为 tag
    await queryRunner.query(`
      UPDATE foods SET tags = (
        SELECT jsonb_agg(DISTINCT tag) FROM (
          -- 分类标签
          SELECT category AS tag
          UNION ALL
          -- 高蛋白
          SELECT '高蛋白' WHERE COALESCE(protein_per_100g, 0) >= 15
          UNION ALL
          -- 低热量
          SELECT '低热量' WHERE calories_per_100g <= 80
          UNION ALL
          -- 超低热量
          SELECT '超低热量' WHERE calories_per_100g <= 30
          UNION ALL
          -- 高脂肪
          SELECT '高脂肪' WHERE COALESCE(fat_per_100g, 0) >= 15
          UNION ALL
          -- 高碳水
          SELECT '高碳水' WHERE COALESCE(carbs_per_100g, 0) >= 30
          UNION ALL
          -- 低脂
          SELECT '低脂' WHERE COALESCE(fat_per_100g, 0) <= 3
          UNION ALL
          -- 高饱腹 (高蛋白 + 有一定脂肪或碳水)
          SELECT '高饱腹' WHERE COALESCE(protein_per_100g, 0) >= 10
            AND (COALESCE(fat_per_100g, 0) >= 5 OR COALESCE(carbs_per_100g, 0) >= 15)
          UNION ALL
          -- 天然
          SELECT '天然' WHERE category IN ('蔬菜', '水果', '豆制品')
          UNION ALL
          -- 均衡
          SELECT '均衡' WHERE COALESCE(protein_per_100g, 0) BETWEEN 5 AND 25
            AND COALESCE(fat_per_100g, 0) BETWEEN 2 AND 15
            AND COALESCE(carbs_per_100g, 0) BETWEEN 5 AND 35
          UNION ALL
          -- 外卖
          SELECT '外卖' WHERE category = '快餐'
        ) sub WHERE tag IS NOT NULL
      )
    `);

    // 3. 对已验证的数据设置高置信度
    await queryRunner.query(`UPDATE foods SET confidence = 0.95 WHERE is_verified = true`);
    await queryRunner.query(`UPDATE foods SET confidence = 0.70 WHERE is_verified = false`);
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
