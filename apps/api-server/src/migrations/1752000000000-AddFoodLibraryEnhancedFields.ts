import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 食物库字段扩展 & 推荐反馈表
 * - foods: 新增营养维度字段 (fiber, sugar, sodium, GI) + 分类字段 (isProcessed, isFried, mealTypes, mainIngredient, subCategory) + 评分字段 (qualityScore, satietyScore)
 * - recommendation_feedbacks: 新增推荐反馈记录表
 */
export class AddFoodLibraryEnhancedFields1752000000000
  implements MigrationInterface
{
  name = 'AddFoodLibraryEnhancedFields1752000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. foods 表：新增营养维度字段 ──────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS fiber_per_100g    DECIMAL(5,1)  DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS sugar_per_100g    DECIMAL(5,1)  DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS sodium_per_100g   DECIMAL(6,1)  DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS glycemic_index    INT           DEFAULT NULL
    `);

    await queryRunner.query(`COMMENT ON COLUMN foods.fiber_per_100g  IS '膳食纤维 g/100g'`);
    await queryRunner.query(`COMMENT ON COLUMN foods.sugar_per_100g  IS '糖 g/100g'`);
    await queryRunner.query(`COMMENT ON COLUMN foods.sodium_per_100g IS '钠 mg/100g'`);
    await queryRunner.query(`COMMENT ON COLUMN foods.glycemic_index  IS 'GI血糖指数'`);

    // ── 2. foods 表：新增食物分类/属性字段 ─────────────────────────────
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS is_processed      BOOLEAN       NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS is_fried          BOOLEAN       NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS meal_types        JSONB         NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS main_ingredient   VARCHAR(50)   DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS sub_category      VARCHAR(50)   DEFAULT NULL
    `);

    await queryRunner.query(`COMMENT ON COLUMN foods.is_processed    IS '是否加工食品'`);
    await queryRunner.query(`COMMENT ON COLUMN foods.is_fried        IS '是否油炸食品'`);
    await queryRunner.query(`COMMENT ON COLUMN foods.meal_types      IS '适合餐次: breakfast/lunch/dinner/snack'`);
    await queryRunner.query(`COMMENT ON COLUMN foods.main_ingredient IS '主要食材 (如 猪肉/鸡蛋/大米 等)'`);
    await queryRunner.query(`COMMENT ON COLUMN foods.sub_category    IS '子分类 (如 红肉/白肉/粗粮 等)'`);

    // ── 3. foods 表：新增评分字段 ──────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE foods
        ADD COLUMN IF NOT EXISTS quality_score     INT           DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS satiety_score     INT           DEFAULT NULL
    `);

    await queryRunner.query(`COMMENT ON COLUMN foods.quality_score   IS '食物品质综合评分 1-10'`);
    await queryRunner.query(`COMMENT ON COLUMN foods.satiety_score   IS '饱腹感评分 1-10'`);

    // ── 4. foods: 根据已有数据回填部分字段 ────────────────────────────────
    // 根据分类默认设置 is_processed
    await queryRunner.query(`
      UPDATE foods
        SET is_processed = TRUE
      WHERE category IN ('快餐', '零食')
        AND is_processed = FALSE
    `);

    // 根据 tags 回填 is_fried（如果已有 '油炸' tag）
    await queryRunner.query(`
      UPDATE foods
        SET is_fried = TRUE
      WHERE tags @> '["油炸"]'::jsonb
        AND is_fried = FALSE
    `);

    // 根据分类回填默认 meal_types
    await queryRunner.query(`
      UPDATE foods
        SET meal_types = '["breakfast","lunch","dinner"]'::jsonb
      WHERE category IN ('主食') AND meal_types = '[]'::jsonb
    `);
    await queryRunner.query(`
      UPDATE foods
        SET meal_types = '["lunch","dinner"]'::jsonb
      WHERE category IN ('肉类', '蔬菜', '豆制品', '汤类') AND meal_types = '[]'::jsonb
    `);
    await queryRunner.query(`
      UPDATE foods
        SET meal_types = '["snack"]'::jsonb
      WHERE category IN ('水果', '零食', '饮品') AND meal_types = '[]'::jsonb
    `);
    await queryRunner.query(`
      UPDATE foods
        SET meal_types = '["breakfast","lunch","dinner","snack"]'::jsonb
      WHERE meal_types = '[]'::jsonb
    `);

    // ── 5. 创建推荐反馈表 recommendation_feedbacks ───────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS recommendation_feedbacks (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         VARCHAR     NOT NULL,
        meal_type       VARCHAR(20) NOT NULL,
        food_name       VARCHAR(100) NOT NULL,
        food_id         VARCHAR     DEFAULT NULL,
        action          VARCHAR(20) NOT NULL,
        replacement_food VARCHAR(100) DEFAULT NULL,
        recommendation_score DECIMAL(5,3) DEFAULT NULL,
        goal_type       VARCHAR(20) DEFAULT NULL,
        created_at      TIMESTAMP   NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rec_feedback_user_created"
        ON recommendation_feedbacks (user_id, created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rec_feedback_user_id"
        ON recommendation_feedbacks (user_id)
    `);

    await queryRunner.query(`COMMENT ON TABLE recommendation_feedbacks IS '用户对推荐食物的反馈记录，用于持续优化推荐模型'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 删除推荐反馈表
    await queryRunner.query(`DROP TABLE IF EXISTS recommendation_feedbacks`);

    // 回滚 foods 表扩展字段
    await queryRunner.query(`
      ALTER TABLE foods
        DROP COLUMN IF EXISTS fiber_per_100g,
        DROP COLUMN IF EXISTS sugar_per_100g,
        DROP COLUMN IF EXISTS sodium_per_100g,
        DROP COLUMN IF EXISTS glycemic_index,
        DROP COLUMN IF EXISTS is_processed,
        DROP COLUMN IF EXISTS is_fried,
        DROP COLUMN IF EXISTS meal_types,
        DROP COLUMN IF EXISTS main_ingredient,
        DROP COLUMN IF EXISTS sub_category,
        DROP COLUMN IF EXISTS quality_score,
        DROP COLUMN IF EXISTS satiety_score
    `);
  }
}
