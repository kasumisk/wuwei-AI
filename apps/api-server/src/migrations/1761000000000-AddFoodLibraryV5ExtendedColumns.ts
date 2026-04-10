import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V5 4.6: 为 foods 表新增菜系/口味/烹饪方式等扩展列
 *
 * 这些列在 V5 2.11 Phase 中已添加到 entity 定义，
 * 此迁移确保数据库表结构同步。
 * 用于 96 维食物嵌入生成和可解释性推荐。
 */
export class AddFoodLibraryV5ExtendedColumns1761000000000 implements MigrationInterface {
  name = 'AddFoodLibraryV5ExtendedColumns1761000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 菜系/口味/烹饪相关字段
    await queryRunner.query(`
      ALTER TABLE "foods"
      ADD COLUMN IF NOT EXISTS "cuisine" VARCHAR(30),
      ADD COLUMN IF NOT EXISTS "flavor_profile" JSONB,
      ADD COLUMN IF NOT EXISTS "cooking_method" VARCHAR(20),
      ADD COLUMN IF NOT EXISTS "prep_time_minutes" INT,
      ADD COLUMN IF NOT EXISTS "cook_time_minutes" INT,
      ADD COLUMN IF NOT EXISTS "skill_required" VARCHAR(10),
      ADD COLUMN IF NOT EXISTS "estimated_cost_level" INT,
      ADD COLUMN IF NOT EXISTS "shelf_life_days" INT,
      ADD COLUMN IF NOT EXISTS "fodmap_level" VARCHAR(10),
      ADD COLUMN IF NOT EXISTS "oxalate_level" VARCHAR(10)
    `);

    // 列注释
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."cuisine" IS '菜系分类: chinese/western/japanese_korean/southeast_asian/mediterranean/indian/middle_eastern/latin_american'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."flavor_profile" IS '口味特征 JSON: { spicy, sweet, salty, sour, umami, bitter } 各 0-1'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."cooking_method" IS '主要烹饪方式: steam/boil/stir_fry/roast/fry/raw'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."prep_time_minutes" IS '准备时间（分钟）'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."cook_time_minutes" IS '烹饪时间（分钟）'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."skill_required" IS '烹饪技能需求: easy/medium/hard'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."estimated_cost_level" IS '估计成本等级 1-5（1=便宜，5=昂贵）'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."shelf_life_days" IS '保质期（天）'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."fodmap_level" IS 'FODMAP 等级: low/moderate/high'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."oxalate_level" IS '草酸等级: low/moderate/high'
    `);

    // 菜系索引（用于按菜系筛选推荐）
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_food_library_cuisine
      ON "foods" ("cuisine")
      WHERE "cuisine" IS NOT NULL
    `);

    // 烹饪方式索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_food_library_cooking_method
      ON "foods" ("cooking_method")
      WHERE "cooking_method" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_food_library_cooking_method`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_food_library_cuisine`);
    await queryRunner.query(`
      ALTER TABLE "foods"
      DROP COLUMN IF EXISTS "oxalate_level",
      DROP COLUMN IF EXISTS "fodmap_level",
      DROP COLUMN IF EXISTS "shelf_life_days",
      DROP COLUMN IF EXISTS "estimated_cost_level",
      DROP COLUMN IF EXISTS "skill_required",
      DROP COLUMN IF EXISTS "cook_time_minutes",
      DROP COLUMN IF EXISTS "prep_time_minutes",
      DROP COLUMN IF EXISTS "cooking_method",
      DROP COLUMN IF EXISTS "flavor_profile",
      DROP COLUMN IF EXISTS "cuisine"
    `);
  }
}
