import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFoodLibraryTable1744000000000 implements MigrationInterface {
  name = 'AddFoodLibraryTable1744000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 开启 pg_trgm 扩展（中文模糊搜索用）
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    // 创建 foods 表
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "foods" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" VARCHAR(100) NOT NULL UNIQUE,
        "aliases" VARCHAR(300),
        "category" VARCHAR(50) NOT NULL,
        "calories_per_100g" INT NOT NULL,
        "protein_per_100g" DECIMAL(5,1),
        "fat_per_100g" DECIMAL(5,1),
        "carbs_per_100g" DECIMAL(5,1),
        "standard_serving_g" INT DEFAULT 100,
        "standard_serving_desc" VARCHAR(50),
        "search_weight" INT DEFAULT 100,
        "is_verified" BOOLEAN DEFAULT true,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // pg_trgm 模糊搜索索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_foods_name_trgm"
        ON "foods" USING gin(name gin_trgm_ops);
    `);

    // 分类索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_foods_category"
        ON "foods"(category);
    `);

    // 权重排序索引
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_foods_weight"
        ON "foods"(search_weight DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "foods";`);
  }
}
