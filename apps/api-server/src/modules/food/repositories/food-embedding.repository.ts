import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  EMBEDDING_MODELS,
  EmbeddingModelName,
  RECOMMENDATION_EMBEDDING_MODEL,
} from './embedding-model.constants';

/**
 * V8.2 FoodEmbedding 仓储
 *
 * 收口所有对 food_embeddings 表的读写。
 *
 * 写路径：
 *   - upsertVector()    → pgvector 列 (vector)，用于 FEATURE_V5 / OPENAI_V5
 *   - upsertVectorLegacy() → Float[] 列 (vector_legacy)，用于 LEGACY_V4 兼容
 *
 * 读路径：
 *   - findByFood()      → 通过 Prisma 客户端读元信息（不含 vector，需 raw 读）
 *   - readVector()      → 用 raw SQL 读 vector::text 反序列化为 number[]
 *   - searchByVector()  → pgvector ANN 召回 (使用 <=> 距离)
 */
@Injectable()
export class FoodEmbeddingRepository {
  private readonly logger = new Logger(FoodEmbeddingRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * UPSERT pgvector 向量（FEATURE_V5 / OPENAI_V5 使用此路径）
   * 失败抛异常，调用方决定是否吞掉。
   */
  async upsertVector(params: {
    foodId: string;
    modelName: EmbeddingModelName;
    modelVersion?: string;
    vector: number[];
  }): Promise<void> {
    const { foodId, modelName, modelVersion, vector } = params;
    const dimension = vector.length;
    const vectorLiteral = `[${vector.join(',')}]`;

    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO "food_embeddings"
        ("food_id", "model_name", "model_version", "vector", "dimension", "generated_at", "updated_at")
      VALUES ($1::uuid, $2, $3, $4::vector, $5, NOW(), NOW())
      ON CONFLICT ("food_id", "model_name")
      DO UPDATE SET "vector"        = EXCLUDED."vector",
                    "model_version" = EXCLUDED."model_version",
                    "dimension"     = EXCLUDED."dimension",
                    "updated_at"    = NOW()
      `,
      foodId,
      modelName,
      modelVersion ?? null,
      vectorLiteral,
      dimension,
    );
  }

  /**
   * UPSERT legacy Float[] 向量（LEGACY_V4 路径）
   */
  async upsertVectorLegacy(params: {
    foodId: string;
    vector: number[];
  }): Promise<void> {
    const { foodId, vector } = params;
    await this.prisma.$executeRaw`
      INSERT INTO "food_embeddings"
        ("food_id", "model_name", "vector_legacy", "dimension", "generated_at", "updated_at")
      VALUES (${foodId}::uuid, ${EMBEDDING_MODELS.LEGACY_V4}, ${vector}::real[], ${vector.length}, NOW(), NOW())
      ON CONFLICT ("food_id", "model_name")
      DO UPDATE SET "vector_legacy" = EXCLUDED."vector_legacy",
                    "dimension"     = EXCLUDED."dimension",
                    "updated_at"    = NOW()
    `;
  }

  /**
   * 元信息查询（vector 列因 Unsupported 类型不会返回，需用 readVector 单独读）
   */
  async findByFood(foodId: string, modelName: EmbeddingModelName) {
    return this.prisma.foodEmbedding.findUnique({
      where: { foodId_modelName: { foodId, modelName } },
    });
  }

  /**
   * 读出 vector 列的数值数组（需 pgvector，否则返回 null）
   */
  async readVector(
    foodId: string,
    modelName: EmbeddingModelName = RECOMMENDATION_EMBEDDING_MODEL,
  ): Promise<number[] | null> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ vec: string | null }>>`
        SELECT vector::text AS vec
          FROM "food_embeddings"
         WHERE food_id = ${foodId}::uuid
           AND model_name = ${modelName}
         LIMIT 1
      `;
      const text = rows[0]?.vec;
      if (!text) return null;
      // pgvector 文本格式：[1,2,3]
      return text
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => Number(s));
    } catch (err) {
      this.logger.debug(
        `readVector failed (pgvector may be unavailable): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * pgvector ANN 召回（vector <=> queryVector 距离升序）
   * @returns [{ foodId, distance }]
   */
  async searchByVector(params: {
    queryVector: number[];
    modelName?: EmbeddingModelName;
    limit?: number;
    foodIdFilter?: string[];
  }): Promise<Array<{ foodId: string; distance: number }>> {
    const {
      queryVector,
      modelName = RECOMMENDATION_EMBEDDING_MODEL,
      limit = 100,
      foodIdFilter,
    } = params;

    const queryLiteral = `[${queryVector.join(',')}]`;
    const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));

    if (foodIdFilter?.length) {
      return this.prisma.$queryRawUnsafe(
        `
        SELECT fe.food_id::text AS "foodId",
               fe.vector <=> $1::vector AS distance
          FROM "food_embeddings" fe
         WHERE fe.model_name = $2
           AND fe.vector IS NOT NULL
           AND fe.food_id = ANY($3::uuid[])
         ORDER BY fe.vector <=> $1::vector
         LIMIT ${safeLimit}
        `,
        queryLiteral,
        modelName,
        foodIdFilter,
      );
    }

    return this.prisma.$queryRawUnsafe(
      `
      SELECT fe.food_id::text AS "foodId",
             fe.vector <=> $1::vector AS distance
        FROM "food_embeddings" fe
       WHERE fe.model_name = $2
         AND fe.vector IS NOT NULL
       ORDER BY fe.vector <=> $1::vector
       LIMIT ${safeLimit}
      `,
      queryLiteral,
      modelName,
    );
  }

  async deleteByFood(foodId: string): Promise<void> {
    await this.prisma.foodEmbedding.deleteMany({ where: { foodId } });
  }
}
