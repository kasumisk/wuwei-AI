import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsureFoodLibraryV4Columns1760100000000
  implements MigrationInterface
{
  name = 'EnsureFoodLibraryV4Columns1760100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "foods"
      ADD COLUMN IF NOT EXISTS "added_sugar" DECIMAL(5,1),
      ADD COLUMN IF NOT EXISTS "natural_sugar" DECIMAL(5,1),
      ADD COLUMN IF NOT EXISTS "purine" DECIMAL(7,1),
      ADD COLUMN IF NOT EXISTS "phosphorus" DECIMAL(7,1),
      ADD COLUMN IF NOT EXISTS "embedding" float4[],
      ADD COLUMN IF NOT EXISTS "embedding_updated_at" TIMESTAMP
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."added_sugar" IS '添加糖 g/100g（NRF 9.3 精度提升）'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."natural_sugar" IS '天然糖 g/100g（水果/乳糖等）'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."purine" IS '嘌呤 mg/100g（痛风约束）'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."phosphorus" IS '磷 mg/100g（肾病约束）'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."embedding" IS '64维特征向量（Phase 4.1），用于相似度搜索'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "foods"."embedding_updated_at" IS '嵌入向量最后更新时间'
    `);
  }

  public async down(): Promise<void> {
    // 这是一个 schema drift 修复迁移，回滚时不主动删除生产字段。
  }
}