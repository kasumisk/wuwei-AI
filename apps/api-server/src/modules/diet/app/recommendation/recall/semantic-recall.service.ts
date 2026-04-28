import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import { VectorSearchService } from './vector-search.service';
import { euclideanDistance } from './food-embedding';

// ==================== Types ====================

/**
 * V6.7 Phase 2-A: 语义召回选项
 */
export interface SemanticRecallOptions {
  /** 最多返回的食物数量（默认 30） */
  topK?: number;
  /** 排除的食物 ID（已在规则召回中选中的） */
  excludeIds?: string[];
  /** 每个品类最多返回数量（品类分散，默认 5） */
  maxPerCategory?: number;
  /** 最低相似度阈值（默认 0.3） */
  minSimilarity?: number;
}

/**
 * V6.7 Phase 2-A: 语义召回结果（携带元数据）
 */
export interface SemanticRecallResult {
  foodId: string;
  similarity: number;
  /** 来源兴趣簇索引（多兴趣建模时有意义） */
  clusterIndex: number;
}

/**
 * V6.7 Phase 2-A: k-means 聚类结果
 */
interface KMeansResult {
  centroids: number[][];
  assignments: number[];
}

/**
 * V6.7 Phase 2-A: 语义召回服务
 *
 * 基于用户历史反馈食物的 embedding，
 * 构建用户语义画像向量，通过 ANN 搜索召回语义相似的食物。
 *
 * V6.5 → V6.7 升级点：
 * 1. **负反馈排斥**：正向量 - 0.3 * 负向量 → 推离不喜欢的食物，L2 归一化
 * 2. **多兴趣建模**：对正向反馈 embeddings 做 k-means (k = min(3, ceil(n/5)))
 *    不足 6 条回退单向量，每个兴趣向量分别 ANN 召回后合并去重
 * 3. **品类分散**：每个 category 最多 N 个（maxPerCategory），防止单品类过度集中
 *
 * 底层复用 VectorSearchService（支持 pgvector + 内存回退两种模式）。
 *
 * 流程：
 * 1. 查 Redis 缓存获取用户多兴趣画像向量（1h TTL）
 * 2. 缓存未命中 → 查询最近 90 天正向+负向反馈的食物 embedding
 * 3. 正向反馈 k-means 聚类 → 多兴趣向量
 * 4. 每个兴趣向量应用负反馈排斥 → 调整后向量
 * 5. 分别 ANN 搜索 → 去重合并 → 品类分散 → 返回候选列表
 */
@Injectable()
export class SemanticRecallService {
  private readonly logger = new Logger(SemanticRecallService.name);

  /** 用户语义画像 Redis 缓存 TTL（1 小时） */
  private static readonly PROFILE_TTL_MS = 3600_000;

  /** 最少正向反馈数量（低于此值无法构建有意义的画像） */
  private static readonly MIN_POSITIVE_FEEDBACKS = 3;

  /** 多兴趣建模的最低反馈数量（低于此值回退单向量） */
  private static readonly MIN_MULTI_INTEREST_FEEDBACKS = 6;

  /** 反馈查询窗口（天）— V6.7: 从 30 天扩展到 90 天 */
  private static readonly FEEDBACK_WINDOW_DAYS = 90;

  /** 最大反馈查询条数 */
  private static readonly MAX_FEEDBACKS = 100;

  /** 负反馈排斥系数 */
  private static readonly REPULSION_FACTOR = 0.3;

  /** 负反馈最少数量（低于此值不做排斥） */
  private static readonly MIN_NEGATIVE_FOR_REPULSION = 2;

  /** k-means 最大迭代次数 */
  private static readonly KMEANS_MAX_ITER = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly vectorSearch: VectorSearchService,
  ) {}

  /**
   * V6.7 Phase 2-A: 基于用户多兴趣语义画像，召回语义相似的食物 ID
   *
   * 兼容旧接口签名（3 个位置参数），同时支持新的 options 对象。
   *
   * @param userId  用户 ID
   * @param limitOrOptions  最多返回数量 或 SemanticRecallOptions
   * @param excludeIds  排除的食物 ID（旧接口兼容）
   * @returns 语义相似食物 ID 列表
   */
  async recallSimilarFoods(
    userId: string,
    limitOrOptions: number | SemanticRecallOptions = 30,
    excludeIds: string[] = [],
  ): Promise<string[]> {
    // 规范化参数：支持旧签名 (userId, limit, excludeIds) 和新签名 (userId, options)
    const options: Required<SemanticRecallOptions> =
      typeof limitOrOptions === 'number'
        ? {
            topK: limitOrOptions,
            excludeIds,
            maxPerCategory: 5,
            minSimilarity: 0.3,
          }
        : {
            topK: limitOrOptions.topK ?? 30,
            excludeIds: limitOrOptions.excludeIds ?? excludeIds,
            maxPerCategory: limitOrOptions.maxPerCategory ?? 5,
            minSimilarity: limitOrOptions.minSimilarity ?? 0.3,
          };

    try {
      const results = await this.recallWithMetadata(userId, options);
      return results.map((r) => r.foodId);
    } catch (err) {
      this.logger.warn(
        `语义召回失败 (userId=${userId}): ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * V6.7 Phase 2-A: 带元数据的语义召回（供 Phase 2-B RecallMerger 使用）
   *
   * 流程：
   * 1. 获取多兴趣画像向量（含负反馈排斥）
   * 2. 每个向量分别 ANN 搜索
   * 3. 去重合并
   * 4. 品类分散
   */
  async recallWithMetadata(
    userId: string,
    options: Required<SemanticRecallOptions>,
  ): Promise<SemanticRecallResult[]> {
    // 1. 获取多兴趣画像向量（含缓存）
    const interestVectors = await this.getMultiInterestProfile(userId);
    if (!interestVectors || interestVectors.length === 0) return [];

    // 2. 每个兴趣向量分别 ANN 搜索，去重合并
    const allCandidates = new Map<string, SemanticRecallResult>();
    const perVectorLimit = Math.ceil(options.topK / interestVectors.length) * 2; // 多召回一些，后续去重+品类过滤会减少

    for (let idx = 0; idx < interestVectors.length; idx++) {
      const vector = interestVectors[idx];
      const results = await this.vectorSearch.findSimilarByVector(
        vector,
        perVectorLimit,
        {
          excludeIds: options.excludeIds,
          minSimilarity: options.minSimilarity,
        },
      );

      for (const r of results) {
        if (!allCandidates.has(r.foodId)) {
          allCandidates.set(r.foodId, {
            foodId: r.foodId,
            similarity: r.similarity,
            clusterIndex: idx,
          });
        } else {
          // 如果多个簇都召回了同一个食物，取更高的相似度
          const existing = allCandidates.get(r.foodId)!;
          if (r.similarity > existing.similarity) {
            existing.similarity = r.similarity;
            existing.clusterIndex = idx;
          }
        }
      }
    }

    if (allCandidates.size === 0) return [];

    // 3. 品类分散
    return this.enforceCategoryDiversity(
      Array.from(allCandidates.values()),
      options.topK,
      options.maxPerCategory,
    );
  }

  /**
   * 获取用户多兴趣画像向量（优先从 Redis 缓存读取）
   *
   * 缓存 key 从 single vector 升级为 vector array
   */
  private async getMultiInterestProfile(
    userId: string,
  ): Promise<number[][] | null> {
    const cacheKey = this.redis.buildKey('semantic_profile_v67', userId);

    // 尝试从缓存读取
    const cached = await this.redis.get<number[][]>(cacheKey);
    if (cached && cached.length > 0) return cached;

    // 缓存未命中，构建画像
    const profile = await this.buildMultiInterestProfile(userId);
    if (profile && profile.length > 0) {
      await this.redis.set(
        cacheKey,
        profile,
        SemanticRecallService.PROFILE_TTL_MS,
      );
    }

    return profile;
  }

  /**
   * V6.7 Phase 2-A: 构建多兴趣画像
   *
   * 步骤：
   * 1. 查询 90 天内全部反馈（正 + 负）
   * 2. 获取对应食物的 embedding
   * 3. 正向反馈 embedding → k-means 聚类 → 多兴趣向量
   * 4. 负向反馈 embedding → 加权平均 → 负向量
   * 5. 每个兴趣向量应用负反馈排斥（subtract + L2 归一化）
   */
  private async buildMultiInterestProfile(
    userId: string,
  ): Promise<number[][] | null> {
    const windowStart = new Date(
      Date.now() - SemanticRecallService.FEEDBACK_WINDOW_DAYS * 86400_000,
    );

    // 查询全部反馈记录（正 + 负）
    const feedbacks = await this.prisma.recommendationFeedbacks.findMany({
      where: {
        userId: userId,
        action: { in: ['accepted', 'loved', 'skipped', 'replaced'] },
        createdAt: { gte: windowStart },
      },
      select: { foodId: true, action: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: SemanticRecallService.MAX_FEEDBACKS,
    });

    // 分离正负反馈
    const positiveFeedbacks = feedbacks.filter((f) =>
      ['accepted', 'loved'].includes(f.action),
    );
    const negativeFeedbacks = feedbacks.filter((f) =>
      ['skipped', 'replaced'].includes(f.action),
    );

    if (
      positiveFeedbacks.length < SemanticRecallService.MIN_POSITIVE_FEEDBACKS
    ) {
      return null;
    }

    // 获取所有涉及食物的 embedding
    const allFoodIds = feedbacks
      .map((f) => f.foodId)
      .filter((id): id is string => id != null);
    const uniqueFoodIds = [...new Set(allFoodIds)];

    if (uniqueFoodIds.length === 0) return null;

    // V8.2: 从 food_embeddings 关联表读取 v5 嵌入（vector::text 解析）
    const foods: Array<{
      id: string;
      category: string;
      embedding_text: string | null;
    }> = await this.prisma.$queryRaw<
      Array<{ id: string; category: string; embedding_text: string | null }>
    >`
      SELECT f.id, f.category, fe.vector::text AS embedding_text
      FROM "foods" f
      INNER JOIN "food_embeddings" fe
        ON fe.food_id = f.id AND fe.model_name = 'feature_v5'
      WHERE f.id = ANY(${uniqueFoodIds}::uuid[])
    `;

    const foodEmbeddingMap = new Map<string, number[]>();
    for (const food of foods) {
      if (!food.embedding_text) continue;
      const vec = String(food.embedding_text)
        .replace(/[[\]]/g, '')
        .split(',')
        .map(Number);
      if (vec.length > 0 && !vec.some((v) => Number.isNaN(v))) {
        foodEmbeddingMap.set(food.id, vec);
      }
    }

    // 构建正向向量集合（含权重）
    const positiveEmbeddings: { embedding: number[]; weight: number }[] = [];
    for (const fb of positiveFeedbacks) {
      if (!fb.foodId) continue;
      const emb = foodEmbeddingMap.get(fb.foodId);
      if (!emb) continue;

      const daysAgo = (Date.now() - fb.createdAt.getTime()) / 86400_000;
      const timeWeight = Math.exp(-0.03 * daysAgo);
      const actionWeight = fb.action === 'loved' ? 1.5 : 1.0;
      positiveEmbeddings.push({
        embedding: emb,
        weight: timeWeight * actionWeight,
      });
    }

    if (
      positiveEmbeddings.length < SemanticRecallService.MIN_POSITIVE_FEEDBACKS
    ) {
      return null;
    }

    // 构建正向兴趣向量（单向量 or 多向量）
    let interestVectors: number[][];

    if (
      positiveEmbeddings.length <
      SemanticRecallService.MIN_MULTI_INTEREST_FEEDBACKS
    ) {
      // 不足 6 条 → 回退到单向量（加权平均）
      const singleVector = this.weightedAverage(positiveEmbeddings);
      if (!singleVector) return null;
      interestVectors = [singleVector];
    } else {
      // k-means 多兴趣建模
      const k = Math.min(3, Math.ceil(positiveEmbeddings.length / 5));
      const kmeansResult = this.kMeans(
        positiveEmbeddings.map((pe) => pe.embedding),
        k,
        SemanticRecallService.KMEANS_MAX_ITER,
      );
      interestVectors = kmeansResult.centroids;
    }

    // 构建负向量（如果有足够负反馈）
    if (
      negativeFeedbacks.length >=
      SemanticRecallService.MIN_NEGATIVE_FOR_REPULSION
    ) {
      const negativeEmbeddings: { embedding: number[]; weight: number }[] = [];
      for (const fb of negativeFeedbacks) {
        if (!fb.foodId) continue;
        const emb = foodEmbeddingMap.get(fb.foodId);
        if (!emb) continue;

        const daysAgo = (Date.now() - fb.createdAt.getTime()) / 86400_000;
        const timeWeight = Math.exp(-0.03 * daysAgo);
        const actionWeight = fb.action === 'replaced' ? 0.8 : 0.5; // replaced 权重更高
        negativeEmbeddings.push({
          embedding: emb,
          weight: timeWeight * actionWeight,
        });
      }

      const negativeVector = this.weightedAverage(negativeEmbeddings);

      if (negativeVector) {
        // 每个兴趣向量应用负反馈排斥
        interestVectors = interestVectors.map((posVec) =>
          this.subtractAndNormalize(
            posVec,
            negativeVector,
            SemanticRecallService.REPULSION_FACTOR,
          ),
        );
      }
    }

    return interestVectors;
  }

  // ==================== 品类分散 ====================

  /**
   * V6.7 Phase 2-A: 品类分散 — 每个 category 最多 maxPerCategory 个
   *
   * 按语义相似度降序遍历，限制每个品类的数量上限，
   * 防止单品类（如 protein）过度集中导致推荐单一。
   *
   * 品类信息需要从食物库查询（语义召回结果只有 foodId + similarity）
   */
  private async enforceCategoryDiversity(
    candidates: SemanticRecallResult[],
    topK: number,
    maxPerCategory: number,
  ): Promise<SemanticRecallResult[]> {
    if (candidates.length <= topK) {
      // 候选不超过 topK，不需要品类限制
      return candidates;
    }

    // 查询品类信息
    const foodIds = candidates.map((c) => c.foodId);
    const foods = await this.prisma.food.findMany({
      where: { id: { in: foodIds } },
      select: { id: true, category: true },
    });
    const categoryMap = new Map<string, string>();
    for (const f of foods) {
      categoryMap.set(f.id, f.category ?? 'unknown');
    }

    // 按相似度降序排序
    candidates.sort((a, b) => b.similarity - a.similarity);

    const categoryCount = new Map<string, number>();
    const result: SemanticRecallResult[] = [];

    for (const c of candidates) {
      if (result.length >= topK) break;
      const cat = categoryMap.get(c.foodId) ?? 'unknown';
      const count = categoryCount.get(cat) ?? 0;
      if (count < maxPerCategory) {
        result.push(c);
        categoryCount.set(cat, count + 1);
      }
    }

    return result;
  }

  // ==================== 向量运算 ====================

  /**
   * 加权平均向量
   */
  private weightedAverage(
    items: { embedding: number[]; weight: number }[],
  ): number[] | null {
    if (items.length === 0) return null;

    const dim = items[0].embedding.length;
    if (dim === 0) return null;

    const avg = new Array<number>(dim).fill(0);
    let totalWeight = 0;

    for (const item of items) {
      for (let i = 0; i < dim; i++) {
        avg[i] += item.embedding[i] * item.weight;
      }
      totalWeight += item.weight;
    }

    if (totalWeight === 0) return null;

    return avg.map((v) => v / totalWeight);
  }

  /**
   * 正向量减去负向量后 L2 归一化
   *
   * result = positive - factor * negative
   * result = result / ||result||₂
   */
  private subtractAndNormalize(
    positive: number[],
    negative: number[],
    factor: number,
  ): number[] {
    const result = positive.map((v, i) => v - factor * (negative[i] ?? 0));

    // L2 归一化
    const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
    return norm > 0 ? result.map((v) => v / norm) : result;
  }

  // ==================== k-means ====================

  /**
   * 轻量 k-means 聚类（内嵌 service，不引入外部依赖）
   *
   * 初始化策略：取前 k 个点（确定性，避免随机不稳定）
   * 收敛条件：分配不再变化 或 达到 maxIter
   *
   * @param points  数据点（n × dim）
   * @param k       簇数
   * @param maxIter 最大迭代次数
   */
  private kMeans(points: number[][], k: number, maxIter: number): KMeansResult {
    if (points.length === 0 || k <= 0) {
      return { centroids: [], assignments: [] };
    }

    // 确保 k 不超过数据点数
    const effectiveK = Math.min(k, points.length);
    const dim = points[0].length;

    // 初始化 centroids：取前 k 个点的副本
    const centroids = points.slice(0, effectiveK).map((p) => [...p]);
    const assignments = new Array<number>(points.length).fill(0);

    for (let iter = 0; iter < maxIter; iter++) {
      // Assign：每个点分配到最近的 centroid
      let changed = false;
      for (let i = 0; i < points.length; i++) {
        let bestDist = Infinity;
        let bestK = 0;
        for (let j = 0; j < effectiveK; j++) {
          const dist = euclideanDistance(points[i], centroids[j]);
          if (dist < bestDist) {
            bestDist = dist;
            bestK = j;
          }
        }
        if (assignments[i] !== bestK) {
          changed = true;
          assignments[i] = bestK;
        }
      }

      if (!changed) break; // 收敛

      // Update centroids：每个簇的成员均值
      for (let j = 0; j < effectiveK; j++) {
        const members = points.filter((_, i) => assignments[i] === j);
        if (members.length > 0) {
          centroids[j] = new Array(dim)
            .fill(0)
            .map(
              (_, d) => members.reduce((s, m) => s + m[d], 0) / members.length,
            );
        }
      }
    }

    return { centroids, assignments };
  }

  // ==================== 缓存管理 ====================

  /**
   * 强制刷新用户语义画像缓存（画像变更、反馈新增后可调用）
   *
   * V6.7: 同时清除旧格式（v6.5）和新格式（v6.7）缓存 key
   */
  async invalidateProfile(userId: string): Promise<void> {
    const oldCacheKey = this.redis.buildKey('semantic_profile', userId);
    const newCacheKey = this.redis.buildKey('semantic_profile_v67', userId);
    await Promise.all([
      this.redis.del(oldCacheKey),
      this.redis.del(newCacheKey),
    ]);
  }
}
