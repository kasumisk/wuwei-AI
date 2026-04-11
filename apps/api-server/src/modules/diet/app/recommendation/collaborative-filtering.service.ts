import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import { SemanticRecallService } from './semantic-recall.service';

/**
 * 协同过滤服务 (V4 Phase 4.4, V5 2.9 时间衰减, V5 2.10 Cron, V5 4.2 Item-based CF)
 *
 * 双模式协同过滤：
 * 1. **User-based CF** — 基于用户相似度的推荐（保留）
 * 2. **Item-based CF** (V5 4.2) — 基于食物共现模式的推荐（新增）
 *    食物 A 和食物 B 被同一批用户消费 → A-B 相似度高
 *    优势：食物数量远少于用户数量，矩阵更稳定、更新频率更低
 *
 * 最终 CF 分数 = 0.4 × user-based + 0.6 × item-based（item-based 权重更高）
 * 当其中一种模式数据不足时，自动使用另一种模式的全部权重。
 *
 * V6.3 P2-10: 增量更新
 * - 定时全量重建改为：周日 01:00 全量重建 + 每日 01:00 增量更新
 * - 增量更新只重算有新交互的用户行 + 涉及食物的物品列
 * - O(n²) → O(k*n)，k = 有变化的用户/食物数
 *
 * 数据来源:
 * 1. food_records — 隐式正信号（V5 2.9 时间衰减）
 * 2. recommendation_feedbacks — 显式信号
 */

/** 单用户的交互向量（稀疏表示） */
export interface UserInteractionVector {
  userId: string;
  /** 食物名 → 交互信号强度 [-1, +∞) */
  interactions: Map<string, number>;
  /** 向量 L2 范数（预计算，加速余弦相似度） */
  norm: number;
}

/** CF 推荐结果 */
export interface CFScoreMap {
  /** 食物名 → CF 推荐分 (0~1，归一化后) */
  scores: Record<string, number>;
  /** 相似用户数量 */
  similarUserCount: number;
}

/** 反馈类型对应的信号权重 */
const FEEDBACK_SIGNAL: Record<string, number> = {
  accepted: 1.0,
  replaced: -0.3,
  skipped: -0.6,
};

/** 配置常量 */
const CF_CONFIG = {
  /** 最少交互记录数（低于此值不参与 CF） */
  MIN_INTERACTIONS: 5,
  /** 相似用户 Top-K */
  TOP_K_SIMILAR: 20,
  /** 矩阵内存缓存 TTL（秒）— V5 2.10: Cron 每日重建，TTL 延长到 25h 兜底 */
  MATRIX_CACHE_TTL: 90000,
  /** CF 分数缓存 TTL（秒） */
  SCORE_CACHE_TTL: 1800,
  /** 最低相似度阈值 */
  MIN_SIMILARITY: 0.05,
  /** 隐式信号衰减（天数） — 超过此天数的记录信号减半 */
  IMPLICIT_DECAY_DAYS: 30,
  /** V5 4.2: Item-based CF 相似食物 Top-K */
  ITEM_TOP_K_SIMILAR: 30,
  /** V5 4.2: Item-based 食物对最少共同用户数 */
  ITEM_MIN_COMMON_USERS: 3,
  /** V5 4.2: Item-based 最低食物相似度 */
  ITEM_MIN_SIMILARITY: 0.1,
  /** V5 4.2: 混合权重 — user-based 占比 */
  USER_BASED_WEIGHT: 0.4,
  /** V5 4.2: 混合权重 — item-based 占比 */
  ITEM_BASED_WEIGHT: 0.6,
};

@Injectable()
export class CollaborativeFilteringService {
  private readonly logger = new Logger(CollaborativeFilteringService.name);

  /** 内存缓存：完整交互矩阵 */
  private cachedMatrix: UserInteractionVector[] | null = null;
  private matrixBuiltAt = 0;

  /**
   * V5 4.2: 食物-食物相似矩阵（item-based CF）
   * 外层 key = foodName, 内层 Map = 相似 foodName → 相似度
   * 只保存相似度 > ITEM_MIN_SIMILARITY 的食物对
   */
  private itemSimilarity: Map<string, Map<string, number>> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisCache: RedisCacheService,
    private readonly semanticRecall: SemanticRecallService,
  ) {}

  // ================================================================
  //  V6.3 P2-10: 每日凌晨 1:00 增量更新，周日 01:00 全量重建
  // ================================================================

  /**
   * 每日增量更新 CF 矩阵（周一~周六）
   *
   * 只重算昨天有新交互的用户行 + 涉及食物的物品相似列
   * 复杂度: O(k*n)，k = 变化用户/食物数
   */
  @Cron('0 1 * * 1-6')
  async scheduledIncrementalUpdate(): Promise<void> {
    await this.redisCache.runWithLock('cf_matrix_rebuild', 10 * 60 * 1000, () =>
      this.doIncrementalUpdate(),
    );
  }

  /**
   * 每周日全量重建（保留原有逻辑兜底）
   */
  @Cron('0 1 * * 0')
  async scheduledFullRebuild(): Promise<void> {
    await this.redisCache.runWithLock('cf_matrix_rebuild', 10 * 60 * 1000, () =>
      this.doScheduledRebuild(),
    );
  }

  private async doScheduledRebuild(): Promise<void> {
    this.logger.log('开始定时全量重建 CF 交互矩阵...');
    const startTime = Date.now();

    try {
      const result = await this.rebuildMatrix();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `CF 矩阵全量重建完成: ${result.userCount} 用户, ${result.itemPairCount} 食物相似对, 耗时 ${elapsed}s`,
      );
    } catch (err) {
      this.logger.error(
        `CF 矩阵全量重建失败: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /**
   * V6.3 P2-10: 增量更新逻辑
   *
   * 1. 获取昨天有新交互的用户 ID 列表
   * 2. 只重算这些用户的交互向量行
   * 3. 获取涉及的食物列表，增量更新 item similarity
   * 4. 清除受影响用户的 CF 分数缓存
   */
  private async doIncrementalUpdate(): Promise<void> {
    this.logger.log('开始增量更新 CF 矩阵...');
    const startTime = Date.now();

    try {
      // 如果还没有基础矩阵，降级为全量重建
      if (!this.cachedMatrix || this.cachedMatrix.length === 0) {
        this.logger.log('增量更新: 无基础矩阵，降级为全量重建');
        await this.doScheduledRebuild();
        return;
      }

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // 1. 获取昨天有新交互的用户 ID
      const changedUsers = await this.getChangedUsersSince(yesterday);
      if (changedUsers.length === 0) {
        this.logger.log('增量更新: 无变化用户，跳过');
        return;
      }

      // 2. 重算变化用户的交互向量
      const now = Date.now();
      const sinceDate = new Date(
        now - CF_CONFIG.IMPLICIT_DECAY_DAYS * 86400000,
      );

      let updatedCount = 0;
      const affectedFoods = new Set<string>();

      for (const userId of changedUsers) {
        const newVec = await this.rebuildUserRow(userId, sinceDate, now);

        // 收集该用户涉及的食物
        if (newVec) {
          for (const foodName of newVec.interactions.keys()) {
            affectedFoods.add(foodName);
          }
        }

        // 更新矩阵中的用户向量
        const existingIdx = this.cachedMatrix.findIndex(
          (v) => v.userId === userId,
        );
        if (newVec && newVec.interactions.size >= CF_CONFIG.MIN_INTERACTIONS) {
          if (existingIdx >= 0) {
            // 收集旧向量涉及的食物
            for (const foodName of this.cachedMatrix[
              existingIdx
            ].interactions.keys()) {
              affectedFoods.add(foodName);
            }
            this.cachedMatrix[existingIdx] = newVec;
          } else {
            this.cachedMatrix.push(newVec);
          }
          updatedCount++;
        } else if (existingIdx >= 0) {
          // 用户交互数不足，从矩阵移除
          for (const foodName of this.cachedMatrix[
            existingIdx
          ].interactions.keys()) {
            affectedFoods.add(foodName);
          }
          this.cachedMatrix.splice(existingIdx, 1);
          updatedCount++;
        }
      }

      // 3. 增量更新涉及食物的 item similarity
      let itemPairsUpdated = 0;
      if (affectedFoods.size > 0) {
        itemPairsUpdated = this.incrementalItemSimilarityUpdate(
          this.cachedMatrix,
          affectedFoods,
        );
      }

      this.matrixBuiltAt = Date.now();

      // 4. 清除受影响用户的 CF 分数缓存
      for (const userId of changedUsers) {
        await this.redisCache.del(`cf:scores:${userId}`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `CF 增量更新完成: ${changedUsers.length} 变化用户, ${updatedCount} 向量更新, ` +
          `${affectedFoods.size} 食物涉及, ${itemPairsUpdated} item pairs 更新, 耗时 ${elapsed}s`,
      );
    } catch (err) {
      this.logger.error(
        `CF 增量更新失败，降级为全量重建: ${(err as Error).message}`,
        (err as Error).stack,
      );
      // 增量失败则降级全量
      await this.doScheduledRebuild();
    }
  }

  /**
   * V6.3 P2-10: 获取某时间点之后有新交互的用户 ID 列表
   */
  private async getChangedUsersSince(since: Date): Promise<string[]> {
    // 从 food_records 和 recommendation_feedbacks 中获取有新记录的用户
    const rows: Array<{ userId: string }> = await this.prisma.$queryRawUnsafe(
      `SELECT DISTINCT user_id AS "userId" FROM (
        SELECT user_id FROM food_records WHERE created_at >= $1
        UNION
        SELECT user_id::uuid FROM recommendation_feedbacks WHERE created_at >= $1
      ) AS changed_users`,
      since,
    );
    return rows.map((r) => r.userId);
  }

  /**
   * V6.3 P2-10: 重建单个用户的交互向量
   */
  private async rebuildUserRow(
    userId: string,
    sinceDate: Date,
    now: number,
  ): Promise<UserInteractionVector | null> {
    // 获取该用户的食物记录
    const recordRows: Array<{
      foodName: string;
      createdAt: Date | string;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT unnest_food.value->>'name' AS "foodName",
              r.created_at AS "createdAt"
       FROM food_records r
       INNER JOIN LATERAL jsonb_array_elements(r.foods) AS unnest_food ON TRUE
       WHERE r.user_id = $1::uuid
         AND unnest_food.value->>'name' IS NOT NULL
         AND r.created_at >= $2`,
      userId,
      sinceDate,
    );

    // 获取该用户的反馈
    const feedbacks: Array<{
      foodName: string;
      action: string;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT f.food_name AS "foodName", f.action AS "action"
       FROM recommendation_feedbacks f
       WHERE f.user_id = $1`,
      userId,
    );

    const interactions = new Map<string, number>();

    // 隐式信号 — 时间衰减
    for (const row of recordRows) {
      const { foodName } = row;
      if (!foodName) continue;
      const createdAt =
        row.createdAt instanceof Date
          ? row.createdAt.getTime()
          : new Date(row.createdAt).getTime();
      const daysSince = (now - createdAt) / 86400000;
      const decayWeight = Math.exp(-0.02 * daysSince);
      interactions.set(
        foodName,
        (interactions.get(foodName) ?? 0) + decayWeight,
      );
    }

    // 显式信号
    for (const row of feedbacks) {
      const { foodName, action } = row;
      if (!foodName) continue;
      const signal = FEEDBACK_SIGNAL[action] ?? 0;
      interactions.set(foodName, (interactions.get(foodName) ?? 0) + signal);
    }

    if (interactions.size === 0) return null;

    let normSq = 0;
    for (const val of interactions.values()) {
      normSq += val * val;
    }

    return {
      userId,
      interactions,
      norm: Math.sqrt(normSq),
    };
  }

  /**
   * V6.3 P2-10: 增量更新 item similarity — 只重算涉及的食物列
   *
   * @returns 更新的相似对数量
   */
  private incrementalItemSimilarityUpdate(
    matrix: UserInteractionVector[],
    affectedFoods: Set<string>,
  ): number {
    // 转置受影响食物的 用户向量
    const foodUsers = new Map<string, Map<string, number>>();
    for (const userVec of matrix) {
      for (const [foodName, score] of userVec.interactions) {
        if (score <= 0) continue;
        if (!foodUsers.has(foodName)) foodUsers.set(foodName, new Map());
        foodUsers.get(foodName)!.set(userVec.userId, score);
      }
    }

    // 准备所有可计算食物的 norm
    const foodNorms = new Map<string, number>();
    for (const [foodName, users] of foodUsers) {
      if (users.size < CF_CONFIG.ITEM_MIN_COMMON_USERS) continue;
      let normSq = 0;
      for (const val of users.values()) normSq += val * val;
      foodNorms.set(foodName, Math.sqrt(normSq));
    }

    let pairsUpdated = 0;

    // 只对 affectedFoods 中的食物重算其相似度行
    for (const targetFood of affectedFoods) {
      const targetUsers = foodUsers.get(targetFood);
      const targetNorm = foodNorms.get(targetFood);
      if (
        !targetUsers ||
        !targetNorm ||
        targetUsers.size < CF_CONFIG.ITEM_MIN_COMMON_USERS
      ) {
        this.itemSimilarity.delete(targetFood);
        continue;
      }

      const topSimilar: Array<{ name: string; sim: number }> = [];

      for (const [otherFood, otherNorm] of foodNorms) {
        if (otherFood === targetFood) continue;
        const otherUsers = foodUsers.get(otherFood)!;

        const [smaller, larger] =
          targetUsers.size <= otherUsers.size
            ? [targetUsers, otherUsers]
            : [otherUsers, targetUsers];

        let dotProduct = 0;
        let commonUsers = 0;
        for (const [userId, valA] of smaller) {
          const valB = larger.get(userId);
          if (valB !== undefined) {
            dotProduct += valA * valB;
            commonUsers++;
          }
        }

        if (commonUsers < CF_CONFIG.ITEM_MIN_COMMON_USERS) continue;
        const sim = dotProduct / (targetNorm * otherNorm);
        if (sim > CF_CONFIG.ITEM_MIN_SIMILARITY) {
          topSimilar.push({ name: otherFood, sim });
        }
      }

      if (topSimilar.length > 0) {
        topSimilar.sort((a, b) => b.sim - a.sim);
        const topK = topSimilar.slice(0, CF_CONFIG.ITEM_TOP_K_SIMILAR);
        const simMap = new Map<string, number>();
        for (const { name, sim } of topK) simMap.set(name, sim);
        this.itemSimilarity.set(targetFood, simMap);
        pairsUpdated += topK.length;
      } else {
        this.itemSimilarity.delete(targetFood);
      }
    }

    return pairsUpdated;
  }

  /**
   * 获取目标用户的 CF 推荐分（V5 4.2: 混合 user-based + item-based）
   *
   * 返回食物名 → 推荐分 (0~1) 映射
   * 混合策略: 0.4 × user-based + 0.6 × item-based
   * 当某一模式数据不足时自动退化为单模式
   */
  async getCFScores(userId: string): Promise<CFScoreMap> {
    // 1. 尝试缓存
    const cacheKey = `cf:scores:${userId}`;
    const cached = await this.redisCache.get<CFScoreMap>(cacheKey);
    if (cached) return cached;

    // 2. 获取交互矩阵
    const matrix = await this.getOrBuildMatrix();

    // 3. 找到目标用户的向量
    const targetVec = matrix.find((v) => v.userId === userId);
    if (
      !targetVec ||
      targetVec.interactions.size < CF_CONFIG.MIN_INTERACTIONS
    ) {
      // V6.5 Phase 3E: 冷启动 fallback — 用语义召回替代空白 CF
      const fallback = await this.semanticColdStartFallback(userId);
      await this.redisCache.set(cacheKey, fallback, CF_CONFIG.SCORE_CACHE_TTL);
      return fallback;
    }

    // 4. User-based CF 分数
    const userBasedResult = this.computeUserBasedScores(targetVec, matrix);

    // 5. V5 4.2: Item-based CF 分数
    const itemBasedResult = this.computeItemBasedScores(targetVec);

    // 6. 混合两种分数
    const hasUserBased = Object.keys(userBasedResult.scores).length > 0;
    const hasItemBased = Object.keys(itemBasedResult.scores).length > 0;

    let finalScores: Record<string, number>;
    let similarUserCount: number;

    if (hasUserBased && hasItemBased) {
      // 加权混合
      finalScores = this.blendScores(
        userBasedResult.scores,
        itemBasedResult.scores,
        CF_CONFIG.USER_BASED_WEIGHT,
        CF_CONFIG.ITEM_BASED_WEIGHT,
      );
      similarUserCount = userBasedResult.similarUserCount;
    } else if (hasUserBased) {
      finalScores = userBasedResult.scores;
      similarUserCount = userBasedResult.similarUserCount;
    } else if (hasItemBased) {
      finalScores = itemBasedResult.scores;
      similarUserCount = 0;
    } else {
      const empty: CFScoreMap = { scores: {}, similarUserCount: 0 };
      await this.redisCache.set(cacheKey, empty, CF_CONFIG.SCORE_CACHE_TTL);
      return empty;
    }

    const result: CFScoreMap = { scores: finalScores, similarUserCount };
    await this.redisCache.set(cacheKey, result, CF_CONFIG.SCORE_CACHE_TTL);
    return result;
  }

  /**
   * User-based CF: 计算相似用户加权推荐分
   */
  private computeUserBasedScores(
    targetVec: UserInteractionVector,
    matrix: UserInteractionVector[],
  ): { scores: Record<string, number>; similarUserCount: number } {
    // 计算与所有其他用户的余弦相似度
    const similarities: Array<{
      similarity: number;
      vec: UserInteractionVector;
    }> = [];

    for (const other of matrix) {
      if (other.userId === targetVec.userId) continue;
      if (other.interactions.size < CF_CONFIG.MIN_INTERACTIONS) continue;

      const sim = this.cosineSimilarity(targetVec, other);
      if (sim > CF_CONFIG.MIN_SIMILARITY) {
        similarities.push({ similarity: sim, vec: other });
      }
    }

    // 取 Top-K 相似用户
    similarities.sort((a, b) => b.similarity - a.similarity);
    const topK = similarities.slice(0, CF_CONFIG.TOP_K_SIMILAR);

    if (topK.length === 0) {
      return { scores: {}, similarUserCount: 0 };
    }

    // 加权聚合
    const targetFoods = targetVec.interactions;
    const aggregated = new Map<
      string,
      { weightedSum: number; simSum: number }
    >();

    for (const { similarity, vec } of topK) {
      for (const [foodName, signal] of vec.interactions) {
        const targetSignal = targetFoods.get(foodName) ?? 0;
        if (targetSignal > 0.5) continue;

        let agg = aggregated.get(foodName);
        if (!agg) {
          agg = { weightedSum: 0, simSum: 0 };
          aggregated.set(foodName, agg);
        }
        agg.weightedSum += similarity * signal;
        agg.simSum += similarity;
      }
    }

    // 归一化到 [0, 1]
    const scores = this.normalizeScores(aggregated);
    return { scores, similarUserCount: topK.length };
  }

  /**
   * V5 4.2: Item-based CF — 基于食物相似矩阵的推荐
   *
   * 对用户已交互的每个食物，查找相似食物，按 (用户对原食物的评分 × 食物间相似度) 加权
   */
  private computeItemBasedScores(targetVec: UserInteractionVector): {
    scores: Record<string, number>;
  } {
    if (this.itemSimilarity.size === 0) {
      return { scores: {} };
    }

    const aggregated = new Map<
      string,
      { weightedSum: number; simSum: number }
    >();

    // 遍历用户已交互的食物
    for (const [foodName, userScore] of targetVec.interactions) {
      if (userScore <= 0) continue; // 只使用正信号

      const similarFoods = this.itemSimilarity.get(foodName);
      if (!similarFoods) continue;

      // 遍历该食物的相似食物
      for (const [similarFood, itemSim] of similarFoods) {
        // 跳过用户已有强交互的食物
        const existingScore = targetVec.interactions.get(similarFood) ?? 0;
        if (existingScore > 0.5) continue;

        let agg = aggregated.get(similarFood);
        if (!agg) {
          agg = { weightedSum: 0, simSum: 0 };
          aggregated.set(similarFood, agg);
        }
        agg.weightedSum += userScore * itemSim;
        agg.simSum += itemSim;
      }
    }

    const scores = this.normalizeScores(aggregated);
    return { scores };
  }

  /**
   * V5 4.2: 混合两组分数
   * 对所有出现在任一组中的食物，计算加权平均
   */
  private blendScores(
    scoresA: Record<string, number>,
    scoresB: Record<string, number>,
    weightA: number,
    weightB: number,
  ): Record<string, number> {
    const allFoods = new Set([
      ...Object.keys(scoresA),
      ...Object.keys(scoresB),
    ]);

    const result: Record<string, number> = {};
    for (const food of allFoods) {
      const a = scoresA[food] ?? 0;
      const b = scoresB[food] ?? 0;

      // 如果只有一边有值，使用该边的全权重
      if (a > 0 && b > 0) {
        result[food] = a * weightA + b * weightB;
      } else if (a > 0) {
        result[food] = a;
      } else {
        result[food] = b;
      }
    }

    return result;
  }

  /**
   * 将聚合分数归一化到 [0, 1]
   */
  private normalizeScores(
    aggregated: Map<string, { weightedSum: number; simSum: number }>,
  ): Record<string, number> {
    const rawScores: Array<[string, number]> = [];
    let maxScore = 0;

    for (const [foodName, agg] of aggregated) {
      const score = agg.simSum > 0 ? agg.weightedSum / agg.simSum : 0;
      if (score > 0) {
        rawScores.push([foodName, score]);
        if (score > maxScore) maxScore = score;
      }
    }

    const scores: Record<string, number> = {};
    for (const [foodName, score] of rawScores) {
      scores[foodName] = maxScore > 0 ? score / maxScore : 0;
    }
    return scores;
  }

  /**
   * 获取或构建交互矩阵（带内存缓存）
   * V5 4.2: 同时构建 item similarity matrix
   */
  private async getOrBuildMatrix(): Promise<UserInteractionVector[]> {
    const now = Date.now();
    if (
      this.cachedMatrix &&
      now - this.matrixBuiltAt < CF_CONFIG.MATRIX_CACHE_TTL * 1000
    ) {
      return this.cachedMatrix;
    }

    this.cachedMatrix = await this.buildInteractionMatrix();
    this.matrixBuiltAt = now;

    // V5 4.2: 同步构建食物相似矩阵
    this.buildItemSimilarityMatrix(this.cachedMatrix);

    return this.cachedMatrix;
  }

  /**
   * 构建用户-食物交互矩阵
   *
   * 来源1: food_records — 隐式正信号（V5 2.9: 带时间衰减）
   *   对每条记录应用 e^(-0.02 * daysSince) 指数衰减权重
   *   只取最近 IMPLICIT_DECAY_DAYS 天的记录
   *   衰减后的信号逐条累加（替代原来的 log2(count + 1)）
   *
   * 来源2: recommendation_feedbacks — 显式信号
   *   accepted = +1.0, replaced = -0.3, skipped = -0.6
   *   与隐式信号相加
   */
  private async buildInteractionMatrix(): Promise<UserInteractionVector[]> {
    const startTime = Date.now();
    const now = Date.now();

    // V5 2.9: 只获取最近 N 天的食物记录，逐条带 created_at 以计算衰减权重
    const sinceDate = new Date(now - CF_CONFIG.IMPLICIT_DECAY_DAYS * 86400000);

    // 1. 获取每条记录的 userId, foodName, createdAt（非聚合）
    const recordRows: Array<{
      userId: string;
      foodName: string;
      createdAt: Date | string;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT r.user_id AS "userId",
              unnest_food.value->>'name' AS "foodName",
              r.created_at AS "createdAt"
       FROM food_records r
       INNER JOIN LATERAL jsonb_array_elements(r.foods) AS unnest_food ON TRUE
       WHERE unnest_food.value->>'name' IS NOT NULL
         AND r.created_at >= $1`,
      sinceDate,
    );

    // 2. 获取所有反馈记录（反馈不设时间窗口，因为显式反馈始终有价值）
    const feedbacks: Array<{
      userId: string;
      foodName: string;
      action: string;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT f.user_id AS "userId",
              f.food_name AS "foodName",
              f.action AS "action"
       FROM recommendation_feedbacks f`,
    );

    // 3. 构建用户向量
    const userMap = new Map<string, Map<string, number>>();

    // V5 2.9: 处理隐式信号 — 逐条应用时间衰减
    for (const row of recordRows) {
      const { userId, foodName } = row;
      if (!foodName) continue;

      const createdAt =
        row.createdAt instanceof Date
          ? row.createdAt.getTime()
          : new Date(row.createdAt).getTime();
      const daysSince = (now - createdAt) / 86400000;
      // 指数衰减: e^(-0.02 * days)
      // day=0 → 1.0, day=30 → 0.549, day=60 → 0.301
      const decayWeight = Math.exp(-0.02 * daysSince);

      if (!userMap.has(userId)) userMap.set(userId, new Map());
      const interactions = userMap.get(userId)!;
      interactions.set(
        foodName,
        (interactions.get(foodName) ?? 0) + decayWeight,
      );
    }

    // 处理显式信号（不衰减）
    for (const row of feedbacks) {
      const { userId, foodName, action } = row;
      if (!foodName) continue;
      const signal = FEEDBACK_SIGNAL[action] ?? 0;
      if (!userMap.has(userId)) userMap.set(userId, new Map());
      const interactions = userMap.get(userId)!;
      interactions.set(foodName, (interactions.get(foodName) ?? 0) + signal);
    }

    // 4. 转换为 UserInteractionVector 数组并预计算 L2 范数
    const matrix: UserInteractionVector[] = [];
    for (const [userId, interactions] of userMap) {
      if (interactions.size < CF_CONFIG.MIN_INTERACTIONS) continue;

      let normSq = 0;
      for (const val of interactions.values()) {
        normSq += val * val;
      }
      matrix.push({
        userId,
        interactions,
        norm: Math.sqrt(normSq),
      });
    }

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Built CF interaction matrix: ${matrix.length} users, ${recordRows.length} records (${CF_CONFIG.IMPLICIT_DECAY_DAYS}d window), ${elapsed}ms`,
    );

    return matrix;
  }

  /**
   * 稀疏余弦相似度
   * 只遍历两个用户共有的食物维度
   */
  private cosineSimilarity(
    a: UserInteractionVector,
    b: UserInteractionVector,
  ): number {
    if (a.norm === 0 || b.norm === 0) return 0;

    // 遍历较小的向量，查找交集
    const [smaller, larger] =
      a.interactions.size <= b.interactions.size
        ? [a.interactions, b.interactions]
        : [b.interactions, a.interactions];

    let dotProduct = 0;
    for (const [key, val] of smaller) {
      const otherVal = larger.get(key);
      if (otherVal !== undefined) {
        dotProduct += val * otherVal;
      }
    }

    return dotProduct / (a.norm * b.norm);
  }

  /**
   * 清除指定用户的 CF 缓存（在用户提交新反馈时调用）
   */
  async invalidateUserCache(userId: string): Promise<void> {
    await this.redisCache.del(`cf:scores:${userId}`);
  }

  // ================================================================
  //  V6.5 Phase 3E: 语义冷启动 fallback
  // ================================================================

  /**
   * 冷启动用户（<5 交互）的 CF fallback：
   * 使用 SemanticRecallService 基于少量正向反馈构建语义画像，
   * 召回语义相似食物并转换为合成 CF 分数。
   *
   * 合成分数按相似度排名线性递减（rank 1 → 0.8, rank N → 0.3），
   * 让冷启动用户也能获得有意义的 CF boost，而非空白。
   *
   * @returns CFScoreMap — 如果语义召回也无结果则返回空 scores
   */
  private async semanticColdStartFallback(userId: string): Promise<CFScoreMap> {
    try {
      // 召回最多 30 个语义相似食物
      const foodIds = await this.semanticRecall.recallSimilarFoods(
        userId,
        30,
        [],
      );

      if (foodIds.length === 0) {
        return { scores: {}, similarUserCount: 0 };
      }

      // 查询食物名称（CF 分数以 food name 为 key）
      const foods = await this.prisma.foods.findMany({
        where: { id: { in: foodIds } },
        select: { id: true, name: true },
      });

      if (foods.length === 0) {
        return { scores: {}, similarUserCount: 0 };
      }

      // 保持召回顺序（相似度从高到低），生成线性递减的合成分数
      // rank 0 → 0.8, 末位 → 0.3
      const idToName = new Map(foods.map((f) => [f.id, f.name]));
      const orderedNames: string[] = [];
      for (const id of foodIds) {
        const name = idToName.get(id);
        if (name) orderedNames.push(name);
      }

      const scores: Record<string, number> = {};
      const count = orderedNames.length;
      for (let i = 0; i < count; i++) {
        // 线性插值: 0.8 → 0.3
        scores[orderedNames[i]] = 0.8 - (0.5 * i) / Math.max(count - 1, 1);
      }

      this.logger.log(
        `CF 冷启动 fallback: userId=${userId}, 语义召回 ${count} 个食物`,
      );

      return { scores, similarUserCount: 0 };
    } catch (err) {
      this.logger.warn(
        `CF 冷启动 semantic fallback 失败 (userId=${userId}): ${(err as Error).message}`,
      );
      return { scores: {}, similarUserCount: 0 };
    }
  }

  /**
   * 强制重建交互矩阵 + 食物相似矩阵（管理端调用或定时任务）
   */
  async rebuildMatrix(): Promise<{ userCount: number; itemPairCount: number }> {
    this.cachedMatrix = await this.buildInteractionMatrix();
    this.matrixBuiltAt = Date.now();

    // V5 4.2: 构建食物-食物相似矩阵
    const itemPairCount = this.buildItemSimilarityMatrix(this.cachedMatrix);

    // 清除所有用户的 CF 分数缓存
    await this.redisCache.delByPrefix('cf:scores:');

    return { userCount: this.cachedMatrix.length, itemPairCount };
  }

  // ================================================================
  //  V5 4.2: Item-based CF 食物相似矩阵构建
  // ================================================================

  /**
   * 构建食物-食物相似矩阵
   *
   * 算法：
   * 1. 转置 用户-食物 矩阵为 食物-用户 矩阵
   * 2. 对每对食物，计算基于共同用户的余弦相似度
   * 3. 只保留 共同用户数 >= 3 且 相似度 > 0.1 的食物对
   *
   * 性能优化：
   * - 只对有足够用户交互的食物计算（≥3 个用户）
   * - 对称矩阵只计算上三角，双向存储
   * - 每个食物只保留 Top-K 相似食物
   *
   * @returns 相似食物对总数
   */
  private buildItemSimilarityMatrix(matrix: UserInteractionVector[]): number {
    const startTime = Date.now();

    // 1. 转置：食物名 → { userId → score }
    const foodUsers = new Map<string, Map<string, number>>();

    for (const userVec of matrix) {
      for (const [foodName, score] of userVec.interactions) {
        if (score <= 0) continue; // 只使用正信号
        if (!foodUsers.has(foodName)) foodUsers.set(foodName, new Map());
        foodUsers.get(foodName)!.set(userVec.userId, score);
      }
    }

    // 2. 过滤掉用户数太少的食物
    const eligibleFoods: Array<{
      name: string;
      users: Map<string, number>;
      norm: number;
    }> = [];

    for (const [foodName, users] of foodUsers) {
      if (users.size < CF_CONFIG.ITEM_MIN_COMMON_USERS) continue;

      // 预计算 L2 范数
      let normSq = 0;
      for (const val of users.values()) {
        normSq += val * val;
      }
      eligibleFoods.push({
        name: foodName,
        users,
        norm: Math.sqrt(normSq),
      });
    }

    // 3. 计算食物间余弦相似度（上三角）
    this.itemSimilarity.clear();
    let pairCount = 0;

    for (let i = 0; i < eligibleFoods.length; i++) {
      const foodA = eligibleFoods[i];
      const topSimilar: Array<{ name: string; sim: number }> = [];

      for (let j = 0; j < eligibleFoods.length; j++) {
        if (i === j) continue;
        const foodB = eligibleFoods[j];

        // 计算稀疏余弦相似度（遍历较小的用户集）
        const [smaller, larger] =
          foodA.users.size <= foodB.users.size
            ? [foodA.users, foodB.users]
            : [foodB.users, foodA.users];

        let dotProduct = 0;
        let commonUsers = 0;
        for (const [userId, valA] of smaller) {
          const valB = larger.get(userId);
          if (valB !== undefined) {
            dotProduct += valA * valB;
            commonUsers++;
          }
        }

        // 共同用户数过少 → 跳过
        if (commonUsers < CF_CONFIG.ITEM_MIN_COMMON_USERS) continue;

        const sim = dotProduct / (foodA.norm * foodB.norm);
        if (sim > CF_CONFIG.ITEM_MIN_SIMILARITY) {
          topSimilar.push({ name: foodB.name, sim });
        }
      }

      // 只保留 Top-K 相似食物
      if (topSimilar.length > 0) {
        topSimilar.sort((a, b) => b.sim - a.sim);
        const topK = topSimilar.slice(0, CF_CONFIG.ITEM_TOP_K_SIMILAR);

        const simMap = new Map<string, number>();
        for (const { name, sim } of topK) {
          simMap.set(name, sim);
        }
        this.itemSimilarity.set(foodA.name, simMap);
        pairCount += topK.length;
      }
    }

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Built item similarity matrix: ${eligibleFoods.length} foods, ${pairCount} pairs, ${elapsed}ms`,
    );

    return pairCount;
  }
}
