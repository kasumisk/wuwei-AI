/**
 * V6.9 Phase 2-C: ExecutionTrackerService — 推荐执行率追踪
 *
 * 追踪推荐→实际执行的闭环：
 * 1. recordRecommendation() — 推荐时记录推荐的食物列表
 * 2. recordExecution() — 食物分析/用户报告后回填实际执行的食物，计算执行率
 * 3. getUserExecutionRate() — 获取用户近 14 天平均执行率（Redis 缓存 1h）
 *
 * V7.1 Phase 2-A: 语义执行匹配
 * - matchExecutionSemantic() — 三级语义匹配（exact/same_ingredient/same_category/same_food_group/none）
 * - recordExecution() 升级为语义匹配，execution_rate 按匹配得分加权
 *
 * V7.1 Phase 2-B: 替换模式回馈
 * - getTopSubstitutions() — 获取用户高频替换对（供 FoodScorer boost）
 *
 * 执行率用于 WeightLearner 梯度加权：
 * - 高执行率 → 推荐被真正执行 → 正常学习信号
 * - 低执行率 → 推荐被接受但未执行 → 降低学习信号（避免过度强化不可执行的推荐）
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import {
  ExecutionMatchResult,
  EXECUTION_MATCH_SCORES,
} from './recommendation.types';

/** 执行率 Redis 缓存 TTL: 1 小时 */
const EXEC_RATE_TTL_MS = 60 * 60 * 1000;

/** 计算平均执行率的窗口: 14 天 */
const EXEC_RATE_WINDOW_DAYS = 14;

/** 默认执行率（无数据时的兜底值） */
const DEFAULT_EXEC_RATE = 0.5;

/** 替换模式查询最低频次门槛（频率 >= 此值才返回） */
const SUBSTITUTION_MIN_FREQUENCY = 2;

/** 替换模式查询最大返回数 */
const SUBSTITUTION_MAX_RESULTS = 20;

/** 替换模式 Redis 缓存 TTL: 2 小时 */
const SUBSTITUTION_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/** 偏差记录结构（V7.1 升级：增加语义匹配详情） */
interface DeviationNotes {
  matched: number;
  total_recommended: number;
  total_executed: number;
  substituted: string[];
  skipped: string[];
  /** V7.1: 语义匹配结果详情 */
  matchDetails?: ExecutionMatchResult[];
}

/** V7.1 P2-B: 替换模式结果 */
export interface SubstitutionPattern {
  /** 被替换的食物 ID */
  fromFoodId: string;
  /** 被替换的食物名 */
  fromFoodName: string;
  /** 替换为的食物 ID */
  toFoodId: string;
  /** 替换为的食物名 */
  toFoodName: string;
  /** 替换频次 */
  frequency: number;
}

@Injectable()
export class ExecutionTrackerService {
  private readonly logger = new Logger(ExecutionTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  /**
   * 记录推荐结果（推荐时调用）
   *
   * @param userId 用户 ID
   * @param mealType 餐次类型
   * @param recommendedFoods 推荐的食物 ID 列表
   * @param recommendationId 推荐请求 ID（可选，关联 trace）
   * @returns 执行记录 ID（用于后续 recordExecution 回填）
   */
  async recordRecommendation(
    userId: string,
    mealType: string,
    recommendedFoods: string[],
    recommendationId?: string,
  ): Promise<string> {
    try {
      const record = await this.prisma.recommendation_executions.create({
        data: {
          user_id: userId,
          meal_type: mealType,
          recommended_foods: recommendedFoods,
          recommendation_id: recommendationId ?? null,
        },
      });
      return record.id;
    } catch (err) {
      this.logger.warn(
        `recordRecommendation failed for user ${userId}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * 回填执行结果（食物分析/用户报告后调用）
   *
   * V7.1 升级：使用语义匹配替代精确 ID 匹配，
   * 支持三级匹配（exact/same_ingredient/same_category/same_food_group/none），
   * 执行率按匹配得分加权而非二值计数。
   *
   * @param executionId 执行记录 ID（由 recordRecommendation 返回）
   * @param executedFoods 实际执行的食物 ID 列表
   * @returns 执行率（加权语义匹配率）
   */
  async recordExecution(
    executionId: string,
    executedFoods: string[],
  ): Promise<{ executionRate: number }> {
    const record = await this.prisma.recommendation_executions.findUnique({
      where: { id: executionId },
    });
    if (!record) {
      throw new Error(`Execution record not found: ${executionId}`);
    }

    const recommended = (record.recommended_foods as string[]) || [];

    // V7.1 P2-A: 语义匹配替代精确 ID 匹配
    const matchResults = await this.matchExecutionSemantic(
      recommended,
      executedFoods,
    );

    // 加权执行率：匹配得分之和 / 推荐总数
    const totalScore = matchResults.reduce((s, r) => s + r.matchScore, 0);
    const executionRate =
      recommended.length > 0 ? totalScore / recommended.length : 0;

    // 兼容旧格式的 deviation notes（同时包含语义匹配详情）
    const exactMatched = matchResults.filter(
      (r) => r.matchLevel === 'exact',
    ).length;
    const substituted = executedFoods.filter((id) => !recommended.includes(id));
    const skipped = recommended.filter((id) => !executedFoods.includes(id));

    const deviationNotes: DeviationNotes = {
      matched: exactMatched,
      total_recommended: recommended.length,
      total_executed: executedFoods.length,
      substituted,
      skipped,
      matchDetails: matchResults,
    };

    await this.prisma.recommendation_executions.update({
      where: { id: executionId },
      data: {
        executed_foods: executedFoods,
        execution_rate: executionRate,
        executed_at: new Date(),
        deviation_notes: deviationNotes as object,
      },
    });

    // 清除缓存，下次查询重新计算
    await this.invalidateUserExecutionRate(record.user_id);

    this.logger.debug(
      `Execution recorded: ${executionId}, rate=${executionRate.toFixed(2)} ` +
        `(exact=${exactMatched}, semantic=${matchResults.filter((r) => r.matchLevel !== 'exact' && r.matchLevel !== 'none').length}/${recommended.length})`,
    );

    return { executionRate };
  }

  /**
   * V7.1 P2-A: 语义执行匹配
   *
   * 对每个推荐食物，贪心匹配执行食物列表，按 Level 优先级：
   *   1. exact（ID 相同）→ 1.0
   *   2. same_ingredient（主食材相同）→ 0.7
   *   3. same_category（同品类）→ 0.4
   *   4. same_food_group（同食物组）→ 0.2
   *   5. none → 0.0
   *
   * 使用贪心算法：优先匹配高分的 pair，每个 executed food 最多匹配一个 recommended food。
   *
   * @param recommendedIds 推荐食物 ID 列表
   * @param executedIds 实际执行食物 ID 列表
   * @returns 每个推荐食物的匹配结果
   */
  async matchExecutionSemantic(
    recommendedIds: string[],
    executedIds: string[],
  ): Promise<ExecutionMatchResult[]> {
    if (recommendedIds.length === 0) return [];

    // 批量查询推荐 + 执行的食物信息（仅需匹配字段）
    const allIds = [...new Set([...recommendedIds, ...executedIds])];
    const foods = await this.prisma.foods.findMany({
      where: { id: { in: allIds } },
      select: {
        id: true,
        main_ingredient: true,
        category: true,
        food_group: true,
      },
    });

    const foodMap = new Map(foods.map((f) => [f.id, f]));

    // 构建所有候选匹配对及其得分
    type MatchCandidate = {
      recIdx: number;
      execIdx: number;
      level: ExecutionMatchResult['matchLevel'];
      score: number;
    };

    const candidates: MatchCandidate[] = [];

    for (let ri = 0; ri < recommendedIds.length; ri++) {
      const recId = recommendedIds[ri];
      const recFood = foodMap.get(recId);

      for (let ei = 0; ei < executedIds.length; ei++) {
        const execId = executedIds[ei];
        const execFood = foodMap.get(execId);

        // 确定匹配级别
        let level: ExecutionMatchResult['matchLevel'] = 'none';

        if (recId === execId) {
          level = 'exact';
        } else if (
          recFood?.main_ingredient &&
          execFood?.main_ingredient &&
          recFood.main_ingredient === execFood.main_ingredient
        ) {
          level = 'same_ingredient';
        } else if (
          recFood?.category &&
          execFood?.category &&
          recFood.category === execFood.category
        ) {
          level = 'same_category';
        } else if (
          recFood?.food_group &&
          execFood?.food_group &&
          recFood.food_group === execFood.food_group
        ) {
          level = 'same_food_group';
        }

        if (level !== 'none') {
          candidates.push({
            recIdx: ri,
            execIdx: ei,
            level,
            score: EXECUTION_MATCH_SCORES[level],
          });
        }
      }
    }

    // 按得分降序排列（贪心：优先分配高分匹配）
    candidates.sort((a, b) => b.score - a.score);

    // 贪心分配：每个 recommended 和 executed 最多匹配一次
    const recMatched = new Set<number>();
    const execMatched = new Set<number>();
    const results: ExecutionMatchResult[] = recommendedIds.map((id) => ({
      recommendedFoodId: id,
      executedFoodId: null,
      matchLevel: 'none' as const,
      matchScore: 0,
    }));

    for (const c of candidates) {
      if (recMatched.has(c.recIdx) || execMatched.has(c.execIdx)) continue;
      recMatched.add(c.recIdx);
      execMatched.add(c.execIdx);

      results[c.recIdx] = {
        recommendedFoodId: recommendedIds[c.recIdx],
        executedFoodId: executedIds[c.execIdx],
        matchLevel: c.level,
        matchScore: c.score,
      };
    }

    return results;
  }

  /**
   * V7.1 P2-B: 获取用户高频替换模式
   *
   * 查询 replacement_patterns 表，返回频次 >= SUBSTITUTION_MIN_FREQUENCY 的替换对。
   * 用于 FoodScorer 对高频替换品进行 +5% boost。
   * 结果 Redis 缓存 2h。
   *
   * @param userId 用户 ID
   * @returns 高频替换模式列表
   */
  async getTopSubstitutions(userId: string): Promise<SubstitutionPattern[]> {
    const cacheKey = `execution:user:${userId}:top_substitutions`;
    const cached = await this.redis.get<SubstitutionPattern[]>(cacheKey);
    if (cached) return cached;

    try {
      const patterns = await this.prisma.replacement_patterns.findMany({
        where: {
          user_id: userId,
          frequency: { gte: SUBSTITUTION_MIN_FREQUENCY },
        },
        orderBy: { frequency: 'desc' },
        take: SUBSTITUTION_MAX_RESULTS,
        select: {
          from_food_id: true,
          from_food_name: true,
          to_food_id: true,
          to_food_name: true,
          frequency: true,
        },
      });

      const result: SubstitutionPattern[] = patterns.map((p) => ({
        fromFoodId: p.from_food_id,
        fromFoodName: p.from_food_name,
        toFoodId: p.to_food_id,
        toFoodName: p.to_food_name,
        frequency: p.frequency,
      }));

      await this.redis.set(cacheKey, result, SUBSTITUTION_CACHE_TTL_MS);

      this.logger.debug(
        `Top substitutions for user ${userId}: ${result.length} patterns`,
      );

      return result;
    } catch (err) {
      this.logger.warn(
        `getTopSubstitutions failed for user ${userId}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 获取用户近 14 天平均执行率
   *
   * 优先从 Redis 缓存读取，缓存 miss 时从 DB aggregate 计算。
   * 无数据时返回默认值 0.5（中性，不偏向强化也不偏向抑制）。
   *
   * @param userId 用户 ID
   * @returns 平均执行率 (0-1)
   */
  async getUserExecutionRate(userId: string): Promise<number> {
    const key = `execution:user:${userId}:avg_rate`;
    const cached = await this.redis.get<number>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    try {
      const since = new Date(Date.now() - EXEC_RATE_WINDOW_DAYS * 86400000);

      const result = await this.prisma.recommendation_executions.aggregate({
        where: {
          user_id: userId,
          execution_rate: { not: null },
          created_at: { gte: since },
        },
        _avg: { execution_rate: true },
      });

      const rate = result._avg.execution_rate ?? DEFAULT_EXEC_RATE;
      await this.redis.set(key, rate, EXEC_RATE_TTL_MS);
      return rate;
    } catch (err) {
      this.logger.warn(
        `getUserExecutionRate failed for user ${userId}: ${(err as Error).message}`,
      );
      return DEFAULT_EXEC_RATE;
    }
  }

  /**
   * 清除用户执行率缓存（执行记录更新后调用）
   */
  private async invalidateUserExecutionRate(userId: string): Promise<void> {
    const key = `execution:user:${userId}:avg_rate`;
    await this.redis.del(key);
  }
}
