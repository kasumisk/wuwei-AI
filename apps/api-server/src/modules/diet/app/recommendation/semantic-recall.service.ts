import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import { VectorSearchService } from './vector-search.service';

/**
 * V6.5 Phase 3A: 语义召回服务
 *
 * 基于用户历史正向反馈食物的 embedding，
 * 构建用户语义画像向量，通过 ANN 搜索召回语义相似的食物。
 *
 * 底层复用 VectorSearchService（支持 pgvector + 内存回退两种模式）。
 *
 * 流程：
 * 1. 查 Redis 缓存获取用户语义画像向量（1h TTL）
 * 2. 缓存未命中 → 查询最近 30 天正向反馈的食物 embedding，加权平均生成画像
 * 3. 用画像向量通过 VectorSearchService.findSimilarByVector() 做 ANN 搜索
 * 4. 返回候选食物 ID 列表
 */
@Injectable()
export class SemanticRecallService {
  private readonly logger = new Logger(SemanticRecallService.name);

  /** 用户语义画像 Redis 缓存 TTL（1 小时） */
  private static readonly PROFILE_TTL_MS = 3600_000;

  /** 最少正向反馈数量（低于此值无法构建有意义的画像） */
  private static readonly MIN_POSITIVE_FEEDBACKS = 3;

  /** 反馈查询窗口（天） */
  private static readonly FEEDBACK_WINDOW_DAYS = 30;

  /** 最大反馈查询条数 */
  private static readonly MAX_FEEDBACKS = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly vectorSearch: VectorSearchService,
  ) {}

  /**
   * 基于用户语义画像，召回语义相似的食物 ID
   *
   * @param userId  用户 ID
   * @param limit   最多返回的食物数量
   * @param excludeIds  排除的食物 ID（已在规则召回中选中的）
   * @returns 语义相似食物 ID 列表
   */
  async recallSimilarFoods(
    userId: string,
    limit: number = 30,
    excludeIds: string[] = [],
  ): Promise<string[]> {
    try {
      // 1. 获取/构建用户语义画像向量
      const userVector = await this.getUserSemanticProfile(userId);
      if (!userVector) return [];

      // 2. 通过 VectorSearchService 做 ANN 搜索
      const results = await this.vectorSearch.findSimilarByVector(
        userVector,
        limit,
        {
          excludeIds,
          minSimilarity: 0.3, // 最低相似度阈值，过滤噪声
        },
      );

      return results.map((r) => r.foodId);
    } catch (err) {
      this.logger.warn(
        `语义召回失败 (userId=${userId}): ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 获取用户语义画像向量（优先从 Redis 缓存读取）
   */
  private async getUserSemanticProfile(
    userId: string,
  ): Promise<number[] | null> {
    const cacheKey = this.redis.buildKey('semantic_profile', userId);

    // 尝试从缓存读取
    const cached = await this.redis.get<number[]>(cacheKey);
    if (cached) return cached;

    // 缓存未命中，构建画像
    const profile = await this.buildUserSemanticProfile(userId);
    if (profile) {
      await this.redis.set(
        cacheKey,
        profile,
        SemanticRecallService.PROFILE_TTL_MS,
      );
    }

    return profile;
  }

  /**
   * 构建用户语义画像：正向反馈食物 embedding 的加权平均
   *
   * 权重策略：
   * - 时间衰减：exp(-0.03 * daysAgo)，30 天前权重约 0.4
   * - 反馈强度：loved = 1.5, accepted = 1.0
   */
  private async buildUserSemanticProfile(
    userId: string,
  ): Promise<number[] | null> {
    const windowStart = new Date(
      Date.now() - SemanticRecallService.FEEDBACK_WINDOW_DAYS * 86400_000,
    );

    // 查询正向反馈记录
    const feedbacks = await this.prisma.recommendation_feedbacks.findMany({
      where: {
        user_id: userId,
        action: { in: ['accepted', 'loved'] },
        created_at: { gte: windowStart },
      },
      select: { food_id: true, action: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: SemanticRecallService.MAX_FEEDBACKS,
    });

    if (feedbacks.length < SemanticRecallService.MIN_POSITIVE_FEEDBACKS) {
      return null;
    }

    // 获取这些食物的 embedding
    const foodIds = feedbacks
      .map((f) => f.food_id)
      .filter((id): id is string => id != null);

    if (foodIds.length === 0) return null;

    const foods = await this.prisma.foods.findMany({
      where: {
        id: { in: foodIds },
        embedding: { isEmpty: false },
      },
      select: { id: true, embedding: true },
    });

    if (foods.length < SemanticRecallService.MIN_POSITIVE_FEEDBACKS) {
      return null;
    }

    // 加权平均
    const dim = foods[0].embedding.length;
    if (dim === 0) return null;

    const avg = new Array<number>(dim).fill(0);
    let totalWeight = 0;

    for (const food of foods) {
      const fb = feedbacks.find((f) => f.food_id === food.id);
      if (!fb) continue;

      const daysAgo = (Date.now() - fb.created_at.getTime()) / 86400_000;
      const timeWeight = Math.exp(-0.03 * daysAgo);
      const actionWeight = fb.action === 'loved' ? 1.5 : 1.0;
      const weight = timeWeight * actionWeight;

      const emb = food.embedding;
      for (let i = 0; i < dim; i++) {
        avg[i] += emb[i] * weight;
      }
      totalWeight += weight;
    }

    if (totalWeight === 0) return null;

    return avg.map((v) => v / totalWeight);
  }

  /**
   * 强制刷新用户语义画像缓存（画像变更、反馈新增后可调用）
   */
  async invalidateProfile(userId: string): Promise<void> {
    const cacheKey = this.redis.buildKey('semantic_profile', userId);
    await this.redis.del(cacheKey);
  }
}
