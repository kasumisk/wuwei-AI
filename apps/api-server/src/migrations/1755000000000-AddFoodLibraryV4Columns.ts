import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFoodLibraryV4Columns1755000000000 implements MigrationInterface {
  name = 'AddFoodLibraryV4Columns1755000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Phase 4.7: 糖分细分（addedSugar / naturalSugar）
    await queryRunner.query(`
      ALTER TABLE "foods"
      ADD COLUMN IF NOT EXISTS "added_sugar" DECIMAL(5,1),
      ADD COLUMN IF NOT EXISTS "natural_sugar" DECIMAL(5,1)
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."added_sugar" IS '添加糖 g/100g（NRF 9.3 精度提升）'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."natural_sugar" IS '天然糖 g/100g（水果/乳糖等）'
    `);

    // Phase 4.6: 痛风/肾病量化字段（purine / phosphorus）
    await queryRunner.query(`
      ALTER TABLE "foods"
      ADD COLUMN IF NOT EXISTS "purine" DECIMAL(7,1),
      ADD COLUMN IF NOT EXISTS "phosphorus" DECIMAL(7,1)
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."purine" IS '嘌呤 mg/100g（痛风约束）'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."phosphorus" IS '磷 mg/100g（肾病约束）'
    `);

    // Phase 4.5: 食物嵌入向量（64维 float4 数组）
    await queryRunner.query(`
      ALTER TABLE "foods"
      ADD COLUMN IF NOT EXISTS "embedding" float4[],
      ADD COLUMN IF NOT EXISTS "embedding_updated_at" TIMESTAMP
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."embedding" IS '64维特征向量（Phase 4.1），用于相似度搜索'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."embedding_updated_at" IS '嵌入向量最后更新时间'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "foods"
      DROP COLUMN IF EXISTS "embedding_updated_at",
      DROP COLUMN IF EXISTS "embedding",
      DROP COLUMN IF EXISTS "phosphorus",
      DROP COLUMN IF EXISTS "purine",
      DROP COLUMN IF EXISTS "natural_sugar",
      DROP COLUMN IF EXISTS "added_sugar"
    `);
  }
}
