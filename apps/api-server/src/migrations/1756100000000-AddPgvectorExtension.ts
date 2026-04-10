import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V5 Phase 4.1: 安装 pgvector 扩展 + 添加 vector(96) 列 + HNSW 索引
 *
 * 前置条件：PostgreSQL 需安装 pgvector 扩展（Docker 用 pgvector/pgvector 镜像）
 *
 * 变更内容：
 * 1. CREATE EXTENSION IF NOT EXISTS vector
 * 2. ALTER TABLE foods ADD COLUMN embedding_v5 vector(96)
 * 3. 从现有 float4[] embedding 列回填到 embedding_v5
 * 4. 创建 HNSW 索引（余弦距离）
 */
export class AddPgvectorExtension1756100000000 implements MigrationInterface {
  name = 'AddPgvectorExtension1756100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 安装 pgvector 扩展（需要 superuser 或扩展已可用）
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS vector
    `);

    // 2. 添加或修复 pgvector 原生 vector(96) 列
    //
    // 历史原因：如果应用在迁移前以 synchronize=true 启动过，
    // TypeORM 会按照实体声明把 embedding_v5 错误建成 varchar。
    // 这里统一纠正列类型，确保后续 HNSW 索引能正常创建。
    const embeddingV5Column = await queryRunner.query(`
      SELECT udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'foods'
        AND column_name = 'embedding_v5'
    `);

    const embeddingV5Type = embeddingV5Column[0]?.udt_name as
      | string
      | undefined;

    if (!embeddingV5Type) {
      await queryRunner.query(`
        ALTER TABLE "foods"
        ADD COLUMN "embedding_v5" vector(96)
      `);
    } else if (embeddingV5Type !== 'vector') {
      await queryRunner.query(`
        ALTER TABLE "foods"
        DROP COLUMN "embedding_v5"
      `);
      await queryRunner.query(`
        ALTER TABLE "foods"
        ADD COLUMN "embedding_v5" vector(96)
      `);
    }

    // 3. 从现有 float4[] embedding 列回填到 embedding_v5
    //    仅回填维度恰好为 96 的记录，跳过旧 64 维数据（需重新计算）
    await queryRunner.query(`
      UPDATE "foods"
      SET "embedding_v5" = "embedding"::vector(96)
      WHERE "embedding" IS NOT NULL
        AND array_length("embedding", 1) = 96
        AND "embedding_v5" IS NULL
    `);

    // 4. 创建 HNSW 索引（余弦距离操作符 vector_cosine_ops）
    //    m=16: 每个节点最大连接数，平衡内存和召回率
    //    ef_construction=200: 构建时搜索范围，越大越精确但越慢
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_food_embedding_hnsw"
      ON "foods" USING hnsw ("embedding_v5" vector_cosine_ops)
      WITH (m = 16, ef_construction = 200)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_food_embedding_hnsw"`);
    await queryRunner.query(
      `ALTER TABLE "foods" DROP COLUMN IF EXISTS "embedding_v5"`,
    );
    // 注意：不删除 pgvector 扩展，可能被其他表使用
  }
}
