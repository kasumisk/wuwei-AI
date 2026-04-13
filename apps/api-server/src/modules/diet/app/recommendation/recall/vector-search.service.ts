import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { FoodLibrary } from '../../../../food/food.types';
import {
  computeFoodEmbedding,
  cosineSimilarity,
  EMBEDDING_DIM,
} from './food-embedding';
/**
 * 向量搜索服务 (V5 4.1: pgvector 模式)
 *
 * 管理 FoodLibrary 的 96 维嵌入向量，提供高效的向量相似度搜索。
 *
 * 两种运行模式（启动时自动检测）：
 * 1. **pgvector 模式**（优先）— 使用 PostgreSQL pgvector 扩展
 *    通过 embedding_v5 vector(96) 列 + HNSW 索引进行 ANN 搜索
 *    性能：O(log N) 查询，1000 食物 ≤3ms
 *
 * 2. **应用层模式**（回退）— 从 DB 加载嵌入到内存，JS 计算余弦相似度
 *    当 pgvector 不可用时自动使用（如 DB 不支持 vector 扩展）
 *    性能：O(N) 暴力扫描，~15ms/1000 食物
 *
 * 核心功能：
 * - syncEmbeddings()     — 计算并持久化向量（同步写入 embedding + embedding_v5）
 * - findSimilarFoods()   — 查找最相似的 K 个食物
 * - findSimilarByVector() — 按嵌入向量直接搜索（pgvector 专用）
 * - getEmbedding()       — 获取指定食物的嵌入向量
 */

/** 相似食物搜索结果 */
export interface SimilarFoodResult {
  food: FoodLibrary;
  similarity: number;
}

@Injectable()
export class VectorSearchService implements OnModuleInit {
  private readonly logger = new Logger(VectorSearchService.name);

  /** pgvector 扩展是否可用 */
  private pgvectorAvailable = false;

  /** 内存中的嵌入向量索引（应用层模式回退用） */
  private embeddingIndex: Map<string, { food: any; vec: number[] }> = new Map();
  private indexBuiltAt = 0;

  /** 索引缓存 TTL（毫秒） */
  private static readonly INDEX_TTL = 30 * 60 * 1000; // 30 min

  /** pgvector 搜索的默认 ef_search 参数（精度/速度权衡） */
  private static readonly HNSW_EF_SEARCH = 100;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 模块初始化时检测 pgvector 是否可用
   */
  async onModuleInit(): Promise<void> {
    await this.detectPgvector();
  }

  /**
   * 检测 pgvector 扩展是否已安装且 embedding_v5 列存在
   */
  private async detectPgvector(): Promise<void> {
    try {
      // 检测 pgvector 扩展是否安装
      const result: Array<{ extname: string }> = await this.prisma.$queryRaw<
        Array<{ extname: string }>
      >`
          SELECT extname FROM pg_extension WHERE extname = 'vector'
        `;
      if (result.length === 0) {
        this.logger.log('pgvector 扩展未安装，使用应用层模式（内存暴力搜索）');
        this.pgvectorAvailable = false;
        return;
      }

      // 检测 embedding_v5 列是否存在
      const colCheck: Array<{ column_name: string }> = await this.prisma
        .$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'foods' AND column_name = 'embedding_v5'
        `;
      if (colCheck.length === 0) {
        this.logger.log(
          'embedding_v5 列不存在，使用应用层模式（内存暴力搜索）',
        );
        this.pgvectorAvailable = false;
        return;
      }

      this.pgvectorAvailable = true;
      this.logger.log('pgvector 模式已启用：使用 HNSW 索引进行 ANN 搜索');
    } catch (err) {
      this.logger.warn(`pgvector 检测失败，回退到应用层模式: ${err}`);
      this.pgvectorAvailable = false;
    }
  }

  /**
   * 同步嵌入向量 — 为所有缺失向量的食物计算并持久化
   *
   * V5 4.1: 同时写入 embedding (float4[]) 和 embedding_v5 (vector(96))。
   * 设计为幂等操作，可重复调用。
   *
   * @returns 新计算的嵌入数量
   */
  async syncEmbeddings(): Promise<{ synced: number; total: number }> {
    const startTime = Date.now();

    // 查找所有缺失嵌入的 active 食物
    const foods: any[] = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM "foods" WHERE "embedding" IS NULL AND "status" = 'active'
    `;

    if (foods.length === 0) {
      const countResult: Array<{ count: string }> = await this.prisma.$queryRaw<
        Array<{ count: string }>
      >`
          SELECT COUNT(*)::text AS "count" FROM "foods" WHERE "embedding" IS NOT NULL
        `;
      const total = Number(countResult[0]?.count ?? 0);
      return { synced: 0, total };
    }

    // 批量计算嵌入
    const BATCH_SIZE = 100;
    let synced = 0;

    for (let i = 0; i < foods.length; i += BATCH_SIZE) {
      const batch = foods.slice(i, i + BATCH_SIZE);

      // 预计算所有嵌入向量
      const embeddings = batch.map((food) => ({
        id: food.id as string,
        vec: computeFoodEmbedding(food as any),
      }));

      // 使用 $transaction 批量写入，减少 N 次独立 DB 往返为 1 次事务
      await this.prisma.$transaction(
        embeddings.map(({ id, vec }) =>
          this.prisma.foods.update({
            where: { id },
            data: {
              embedding: vec,
              embeddingUpdatedAt: new Date(),
            },
          }),
        ),
      );

      // V5 4.1: 如果 pgvector 可用，批量同步写入 embedding_v5
      if (this.pgvectorAvailable) {
        await this.prisma.$transaction(
          embeddings.map(
            ({ id, vec }) =>
              this.prisma.$queryRaw`
              UPDATE "foods" SET "embedding_v5" = ${`[${vec.join(',')}]`}::vector WHERE "id" = ${id}
            `,
          ),
        );
      }

      synced += batch.length;
    }

    // 清除内存索引强制重建
    this.embeddingIndex.clear();
    this.indexBuiltAt = 0;

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Synced ${synced} food embeddings in ${elapsed}ms (pgvector=${this.pgvectorAvailable})`,
    );

    const total: number = await this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS "count" FROM "foods" WHERE "embedding" IS NOT NULL
      `.then((rows: Array<{ count: number }>) => rows[0]?.count ?? 0);
    return { synced, total };
  }

  /**
   * 查找与目标食物最相似的 K 个食物
   *
   * V5 4.1: 优先使用 pgvector ANN 搜索，回退到应用层暴力扫描
   *
   * @param foodId 目标食物 ID
   * @param topK 返回数量
   * @param excludeIds 排除的食物 ID 集合
   * @param categoryFilter 可选的品类过滤
   */
  async findSimilarFoods(
    foodId: string,
    topK: number = 5,
    excludeIds?: Set<string>,
    categoryFilter?: string,
  ): Promise<SimilarFoodResult[]> {
    if (this.pgvectorAvailable) {
      return this.findSimilarFoodsPgvector(
        foodId,
        topK,
        excludeIds,
        categoryFilter,
      );
    }
    return this.findSimilarFoodsInMemory(
      foodId,
      topK,
      excludeIds,
      categoryFilter,
    );
  }

  /**
   * V5 4.1: 按嵌入向量直接搜索（pgvector 专用）
   *
   * 适用于：给定一个计算好的嵌入向量，找最相似的食物。
   * 场景：偏好嵌入搜索、多食物平均向量搜索等。
   *
   * @param targetEmbedding 目标嵌入向量 (96维)
   * @param topK 返回数量
   * @param options 过滤选项
   */
  async findSimilarByVector(
    targetEmbedding: number[],
    topK: number = 5,
    options?: {
      excludeIds?: string[];
      categoryFilter?: string[];
      minSimilarity?: number;
    },
  ): Promise<Array<{ foodId: string; similarity: number }>> {
    if (!this.pgvectorAvailable) {
      this.logger.warn('findSimilarByVector 需要 pgvector，当前不可用');
      return [];
    }

    const embeddingStr = `[${targetEmbedding.join(',')}]`;
    let sql = `
      SELECT f.id AS "foodId",
             1 - (f.embedding_v5 <=> $1::vector) AS "similarity"
      FROM "foods" f
      WHERE f.is_verified = true
        AND f.embedding_v5 IS NOT NULL
    `;
    const params: any[] = [embeddingStr];
    let paramIdx = 2;

    if (options?.excludeIds?.length) {
      sql += ` AND f.id NOT IN (${options.excludeIds
        .map(() => `$${paramIdx++}`)
        .join(',')})`;
      params.push(...options.excludeIds);
    }
    if (options?.categoryFilter?.length) {
      sql += ` AND f.category IN (${options.categoryFilter
        .map(() => `$${paramIdx++}`)
        .join(',')})`;
      params.push(...options.categoryFilter);
    }
    if (options?.minSimilarity != null) {
      sql += ` AND 1 - (f.embedding_v5 <=> $${paramIdx}::vector) >= $${paramIdx + 1}`;
      params.push(embeddingStr, options.minSimilarity);
      paramIdx += 2;
    }

    sql += ` ORDER BY f.embedding_v5 <=> $1::vector LIMIT $${paramIdx}`;
    params.push(topK);

    // SET LOCAL 必须与查询在同一事务中才生效
    const rows: Array<{ foodId: string; similarity: string }> =
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SET LOCAL hnsw.ef_search = ${VectorSearchService.HNSW_EF_SEARCH}`;
        return tx.$queryRawUnsafe(sql, ...params);
      });

    return rows.map((r) => ({
      foodId: r.foodId,
      similarity: Number(r.similarity),
    }));
  }

  /**
   * V5 4.1: pgvector 模式 — 使用 DB 层 ANN 搜索
   */
  private async findSimilarFoodsPgvector(
    foodId: string,
    topK: number,
    excludeIds?: Set<string>,
    categoryFilter?: string,
  ): Promise<SimilarFoodResult[]> {
    // 先获取目标食物的 embedding_v5
    const targetRows: Array<{ embeddingV5: string }> = await this.prisma
      .$queryRaw<Array<{ embeddingV5: string }>>`
        SELECT "embedding_v5" FROM "foods" WHERE "id" = ${foodId} AND "embedding_v5" IS NOT NULL
      `;

    if (targetRows.length === 0) {
      // 目标食物无 pgvector 嵌入，回退到内存模式
      return this.findSimilarFoodsInMemory(
        foodId,
        topK,
        excludeIds,
        categoryFilter,
      );
    }

    // 构建 pgvector 查询
    // 多取一些候选（排除列表可能过滤掉部分），最终截断到 topK
    const fetchLimit = topK + (excludeIds?.size ?? 0) + 5;

    let sql = `
      SELECT f.id,
             f.name,
             f.category,
             f.calories,
             f.protein,
             f.fat,
             f.carbs,
             f.fiber,
             1 - (f.embedding_v5 <=> (SELECT embedding_v5 FROM "foods" WHERE id = $1)) AS similarity
      FROM "foods" f
      WHERE f.id != $1
        AND f.embedding_v5 IS NOT NULL
    `;
    const params: any[] = [foodId];
    let paramIdx = 2;

    if (categoryFilter) {
      sql += ` AND f.category = $${paramIdx}`;
      params.push(categoryFilter);
      paramIdx++;
    }

    sql += ` ORDER BY f.embedding_v5 <=> (SELECT embedding_v5 FROM "foods" WHERE id = $1) LIMIT $${paramIdx}`;
    params.push(fetchLimit);

    const rows: Array<{
      id: string;
      name: string;
      category: string;
      calories: string;
      protein: string;
      fat: string;
      carbs: string;
      fiber: string;
      similarity: string;
    }> = await this.prisma.$queryRawUnsafe(sql, ...params);

    // 后置过滤排除列表 + 转换为 SimilarFoodResult
    const results: SimilarFoodResult[] = [];
    for (const row of rows) {
      if (excludeIds?.has(row.id)) continue;
      if (results.length >= topK) break;

      // 构造轻量 FoodLibrary 对象（核心字段）
      const food: FoodLibrary = {
        id: row.id,
        name: row.name,
        category: row.category,
        calories: Number(row.calories),
        protein: row.protein != null ? Number(row.protein) : undefined,
        fat: row.fat != null ? Number(row.fat) : undefined,
        carbs: row.carbs != null ? Number(row.carbs) : undefined,
        fiber: row.fiber != null ? Number(row.fiber) : undefined,
      } as FoodLibrary;

      results.push({ food, similarity: Number(row.similarity) });
    }

    return results;
  }

  /**
   * 应用层模式 — 内存暴力扫描（回退方案）
   */
  private async findSimilarFoodsInMemory(
    foodId: string,
    topK: number,
    excludeIds?: Set<string>,
    categoryFilter?: string,
  ): Promise<SimilarFoodResult[]> {
    const index = await this.getOrBuildIndex();

    const target = index.get(foodId);
    if (!target) return [];

    const results: SimilarFoodResult[] = [];

    for (const [id, entry] of index) {
      if (id === foodId) continue;
      if (excludeIds?.has(id)) continue;
      if (categoryFilter && entry.food.category !== categoryFilter) continue;

      const sim = cosineSimilarity(target.vec, entry.vec);
      results.push({ food: entry.food, similarity: sim });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * 为给定的食物列表批量查找相似食物
   * 适用于替代推荐场景
   *
   * V5 4.1: 支持 pgvector 模式（计算平均向量后用 findSimilarByVector）
   */
  async findSimilarToMultiple(
    foodIds: string[],
    topK: number = 5,
    excludeIds?: Set<string>,
  ): Promise<SimilarFoodResult[]> {
    if (this.pgvectorAvailable) {
      return this.findSimilarToMultiplePgvector(foodIds, topK, excludeIds);
    }
    return this.findSimilarToMultipleInMemory(foodIds, topK, excludeIds);
  }

  /**
   * V5 4.1: pgvector 模式批量相似搜索
   */
  private async findSimilarToMultiplePgvector(
    foodIds: string[],
    topK: number,
    excludeIds?: Set<string>,
  ): Promise<SimilarFoodResult[]> {
    if (foodIds.length === 0) return [];

    // 在 DB 中计算平均嵌入
    const avgResult: Array<{ avg_embedding: string }> = await this.prisma
      .$queryRaw<Array<{ avg_embedding: string }>>`
        SELECT avg(embedding_v5)::vector AS avg_embedding
        FROM "foods"
        WHERE id IN (${Prisma.join(foodIds)}) AND embedding_v5 IS NOT NULL
      `;

    if (!avgResult[0]?.avg_embedding) {
      // pgvector 无数据，回退到内存模式
      return this.findSimilarToMultipleInMemory(foodIds, topK, excludeIds);
    }

    // 解析平均向量
    const avgStr = avgResult[0].avg_embedding;
    const avgVec = avgStr
      .replace(/[\[\]]/g, '')
      .split(',')
      .map(Number);

    // 使用平均向量搜索
    const allExcludeIds = [...(excludeIds ?? []), ...foodIds];
    const fetchLimit = topK + allExcludeIds.length + 5;

    const embeddingParam = `[${avgVec.join(',')}]`;
    let sql = `
      SELECT f.id, f.name, f.category, f.calories, f.protein, f.fat, f.carbs, f.fiber,
             1 - (f.embedding_v5 <=> $1::vector) AS similarity
      FROM "foods" f
      WHERE f.embedding_v5 IS NOT NULL
    `;
    const params: any[] = [embeddingParam];
    let paramIdx = 2;

    if (allExcludeIds.length > 0) {
      sql += ` AND f.id NOT IN (${allExcludeIds.map(() => `$${paramIdx++}`).join(',')})`;
      params.push(...allExcludeIds);
    }

    sql += ` ORDER BY f.embedding_v5 <=> $1::vector LIMIT $${paramIdx}`;
    params.push(fetchLimit);

    const rows: Array<{
      id: string;
      name: string;
      category: string;
      calories: string;
      protein: string;
      fat: string;
      carbs: string;
      fiber: string;
      similarity: string;
    }> = await this.prisma.$queryRawUnsafe(sql, ...params);

    return rows.slice(0, topK).map((row) => {
      const food: FoodLibrary = {
        id: row.id,
        name: row.name,
        category: row.category,
        calories: Number(row.calories),
        protein: row.protein != null ? Number(row.protein) : undefined,
        fat: row.fat != null ? Number(row.fat) : undefined,
        carbs: row.carbs != null ? Number(row.carbs) : undefined,
        fiber: row.fiber != null ? Number(row.fiber) : undefined,
      } as FoodLibrary;
      return { food, similarity: Number(row.similarity) };
    });
  }

  /**
   * 应用层模式批量相似搜索（回退方案）
   */
  private async findSimilarToMultipleInMemory(
    foodIds: string[],
    topK: number,
    excludeIds?: Set<string>,
  ): Promise<SimilarFoodResult[]> {
    const index = await this.getOrBuildIndex();

    // 计算目标食物的平均嵌入向量
    const targetVecs: number[][] = [];
    for (const id of foodIds) {
      const entry = index.get(id);
      if (entry) targetVecs.push(entry.vec);
    }

    if (targetVecs.length === 0) return [];

    const avgVec = new Array(EMBEDDING_DIM).fill(0);
    for (const vec of targetVecs) {
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        avgVec[i] += vec[i] / targetVecs.length;
      }
    }

    // 查找最接近平均向量的食物
    const allExclude = new Set(excludeIds);
    for (const id of foodIds) allExclude.add(id);

    const results: SimilarFoodResult[] = [];
    for (const [id, entry] of index) {
      if (allExclude.has(id)) continue;
      const sim = cosineSimilarity(avgVec, entry.vec);
      results.push({ food: entry.food, similarity: sim });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * 获取指定食物的嵌入向量
   * 如果 DB 中没有或维度不匹配（V4→V5 过渡），实时计算并缓存
   */
  async getEmbedding(food: FoodLibrary): Promise<number[]> {
    if (food.embedding && food.embedding.length === EMBEDDING_DIM) {
      return food.embedding;
    }

    // 实时计算
    const vec = computeFoodEmbedding(food);

    // 异步持久化 float4[] embedding（不阻塞返回）
    this.prisma.foods
      .update({
        where: { id: food.id },
        data: { embedding: vec, embeddingUpdatedAt: new Date() },
      })
      .catch((err) =>
        this.logger.warn(
          `Failed to persist embedding for ${food.id}: ${err.message}`,
        ),
      );

    // V5 4.1: 同步写入 pgvector 列
    if (this.pgvectorAvailable) {
      this.prisma.$queryRaw`
          UPDATE "foods" SET "embedding_v5" = ${`[${vec.join(',')}]`}::vector WHERE "id" = ${food.id}
        `.catch((err) =>
        this.logger.warn(
          `Failed to persist embedding_v5 for ${food.id}: ${err.message}`,
        ),
      );
    }

    return vec;
  }

  /**
   * 获取或构建内存索引（应用层模式回退用）
   */
  private async getOrBuildIndex(): Promise<
    Map<string, { food: any; vec: number[] }>
  > {
    const now = Date.now();
    if (
      this.embeddingIndex.size > 0 &&
      now - this.indexBuiltAt < VectorSearchService.INDEX_TTL
    ) {
      return this.embeddingIndex;
    }

    const startTime = Date.now();

    // 加载所有有嵌入的食物
    const foods: any[] = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM "foods" WHERE "embedding" IS NOT NULL
    `;

    this.embeddingIndex.clear();
    for (const food of foods) {
      // V5 2.11: 兼容旧 64 维和新 96 维嵌入
      // cosineSimilarity 已支持不同长度向量比较
      if (food.embedding && food.embedding.length >= 1) {
        this.embeddingIndex.set(food.id, { food, vec: food.embedding });
      }
    }

    this.indexBuiltAt = now;

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Built vector index: ${this.embeddingIndex.size} foods, ${elapsed}ms`,
    );

    return this.embeddingIndex;
  }

  /**
   * 强制刷新索引（管理端调用）
   */
  async refreshIndex(): Promise<{ indexSize: number }> {
    this.indexBuiltAt = 0;
    const index = await this.getOrBuildIndex();
    return { indexSize: index.size };
  }

  /**
   * 获取索引状态（用于 admin dashboard）
   */
  getIndexStats(): {
    indexSize: number;
    builtAt: number;
    ageSeconds: number;
    pgvectorEnabled: boolean;
  } {
    return {
      indexSize: this.embeddingIndex.size,
      builtAt: this.indexBuiltAt,
      ageSeconds:
        this.indexBuiltAt > 0
          ? Math.round((Date.now() - this.indexBuiltAt) / 1000)
          : -1,
      pgvectorEnabled: this.pgvectorAvailable,
    };
  }

  /**
   * 当前是否使用 pgvector 模式
   */
  isPgvectorMode(): boolean {
    return this.pgvectorAvailable;
  }
}
