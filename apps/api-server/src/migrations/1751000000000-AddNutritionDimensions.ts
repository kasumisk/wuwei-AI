import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNutritionDimensions1751000000000 implements MigrationInterface {
  name = 'AddNutritionDimensions1751000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // food_records: 餐食级营养汇总
    await queryRunner.query(`
      ALTER TABLE food_records
        ADD COLUMN IF NOT EXISTS total_protein DECIMAL(6,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_fat DECIMAL(6,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_carbs DECIMAL(6,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS avg_quality DECIMAL(3,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS avg_satiety DECIMAL(3,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS nutrition_score INT DEFAULT 0
    `);

    await queryRunner.query(`COMMENT ON COLUMN food_records.total_protein IS '本餐总蛋白质 g'`);
    await queryRunner.query(`COMMENT ON COLUMN food_records.total_fat IS '本餐总脂肪 g'`);
    await queryRunner.query(`COMMENT ON COLUMN food_records.total_carbs IS '本餐总碳水 g'`);
    await queryRunner.query(`COMMENT ON COLUMN food_records.avg_quality IS '本餐食物平均质量分 1-10'`);
    await queryRunner.query(`COMMENT ON COLUMN food_records.avg_satiety IS '本餐食物平均饱腹感 1-10'`);
    await queryRunner.query(`COMMENT ON COLUMN food_records.nutrition_score IS '本餐综合营养评分 0-100'`);

    // daily_summaries: 每日多维汇总
    await queryRunner.query(`
      ALTER TABLE daily_summaries
        ADD COLUMN IF NOT EXISTS total_protein DECIMAL(7,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_fat DECIMAL(7,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_carbs DECIMAL(7,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS avg_quality DECIMAL(3,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS avg_satiety DECIMAL(3,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS nutrition_score INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS protein_goal DECIMAL(6,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS fat_goal DECIMAL(6,1) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS carbs_goal DECIMAL(6,1) DEFAULT 0
    `);

    await queryRunner.query(`COMMENT ON COLUMN daily_summaries.total_protein IS '今日总蛋白质 g'`);
    await queryRunner.query(`COMMENT ON COLUMN daily_summaries.total_fat IS '今日总脂肪 g'`);
    await queryRunner.query(`COMMENT ON COLUMN daily_summaries.total_carbs IS '今日总碳水 g'`);
    await queryRunner.query(`COMMENT ON COLUMN daily_summaries.avg_quality IS '今日食物平均质量分'`);
    await queryRunner.query(`COMMENT ON COLUMN daily_summaries.avg_satiety IS '今日食物平均饱腹感'`);
    await queryRunner.query(`COMMENT ON COLUMN daily_summaries.nutrition_score IS '今日综合营养评分 0-100'`);
    await queryRunner.query(`COMMENT ON COLUMN daily_summaries.protein_goal IS '今日蛋白质目标 g'`);
    await queryRunner.query(`COMMENT ON COLUMN daily_summaries.fat_goal IS '今日脂肪目标 g'`);
    await queryRunner.query(`COMMENT ON COLUMN daily_summaries.carbs_goal IS '今日碳水目标 g'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE food_records
        DROP COLUMN IF EXISTS total_protein,
        DROP COLUMN IF EXISTS total_fat,
        DROP COLUMN IF EXISTS total_carbs,
        DROP COLUMN IF EXISTS avg_quality,
        DROP COLUMN IF EXISTS avg_satiety,
        DROP COLUMN IF EXISTS nutrition_score
    `);

    await queryRunner.query(`
      ALTER TABLE daily_summaries
        DROP COLUMN IF EXISTS total_protein,
        DROP COLUMN IF EXISTS total_fat,
        DROP COLUMN IF EXISTS total_carbs,
        DROP COLUMN IF EXISTS avg_quality,
        DROP COLUMN IF EXISTS avg_satiety,
        DROP COLUMN IF EXISTS nutrition_score,
        DROP COLUMN IF EXISTS protein_goal,
        DROP COLUMN IF EXISTS fat_goal,
        DROP COLUMN IF EXISTS carbs_goal
    `);
  }
}
