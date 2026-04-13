/**
 * V7.4 Phase 2-B: 推荐策略解析服务
 *
 * 根据用户画像（反馈次数、目标类型、健康状况）和当前场景，
 * 自动选择最合适的推荐策略（explore/exploit/strict_health/scene_first）。
 *
 * 选择逻辑（按优先级）：
 *   1. feedbackCount < 10           → explore（新用户需要广泛探索）
 *   2. goalType in [fat_loss, health] && healthConditions.length > 0
 *                                   → strict_health（有健康风险需严格管控）
 *   3. sceneType in [canteen_meal, convenience_meal]
 *                                   → scene_first（特定场景下获取便利性优先）
 *   4. 默认                          → exploit（成熟用户偏好驱动）
 *
 * 与 V6 StrategyAutoTuner 的关系：
 * - StrategyAutoTuner 负责 V6 ResolvedStrategy 的细粒度参数自动调优
 * - 本服务负责选择宏观推荐行为模式，两者可叠加
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  RECOMMENDATION_STRATEGIES,
  RecommendationStrategy,
  RecommendationStrategyName,
  ResolvedRecommendationStrategy,
  StrategyResolverInput,
} from '../types/recommendation-strategy.types';

/** 触发 scene_first 策略的场景列表 */
const SCENE_FIRST_TYPES: ReadonlySet<string> = new Set([
  'canteen_meal',
  'convenience_meal',
]);

/** 触发 strict_health 策略的目标类型 */
const STRICT_HEALTH_GOAL_TYPES: ReadonlySet<string> = new Set([
  'fat_loss',
  'health',
]);

/** 新用户探索阈值：反馈次数低于此值使用 explore 策略 */
const EXPLORE_FEEDBACK_THRESHOLD = 10;

@Injectable()
export class RecommendationStrategyResolverService {
  private readonly logger = new Logger(
    RecommendationStrategyResolverService.name,
  );

  /**
   * 根据用户上下文解析推荐策略
   *
   * @param input 策略解析输入（feedbackCount, goalType, healthConditions, sceneType）
   * @returns 解析后的推荐策略（含策略对象、选择原因、时间戳）
   */
  resolve(input: StrategyResolverInput): ResolvedRecommendationStrategy {
    const { feedbackCount, goalType, healthConditions, sceneType } = input;

    let strategyName: RecommendationStrategyName;
    let reason: string;

    // 规则 1: 新用户探索
    if (feedbackCount < EXPLORE_FEEDBACK_THRESHOLD) {
      strategyName = 'explore';
      reason = `feedbackCount=${feedbackCount} < ${EXPLORE_FEEDBACK_THRESHOLD}，新用户需要广泛探索`;
    }
    // 规则 2: 严格健康管控
    else if (
      STRICT_HEALTH_GOAL_TYPES.has(goalType) &&
      healthConditions.length > 0
    ) {
      strategyName = 'strict_health';
      reason = `goalType=${goalType} + healthConditions=[${healthConditions.join(',')}]，需严格营养管控`;
    }
    // 规则 3: 场景优先
    else if (sceneType && SCENE_FIRST_TYPES.has(sceneType)) {
      strategyName = 'scene_first';
      reason = `sceneType=${sceneType}，获取便利性优先`;
    }
    // 默认: 偏好利用
    else {
      strategyName = 'exploit';
      reason = `成熟用户(feedback=${feedbackCount})，偏好驱动推荐`;
    }

    const strategy = RECOMMENDATION_STRATEGIES[strategyName];

    this.logger.debug(`Strategy resolved: ${strategyName} — ${reason}`);

    return {
      strategy,
      reason,
      resolvedAt: Date.now(),
    };
  }

  /**
   * 按名称获取预设策略（供测试/调试/管理后台使用）
   */
  getByName(name: RecommendationStrategyName): RecommendationStrategy {
    return RECOMMENDATION_STRATEGIES[name];
  }

  /**
   * 获取所有预设策略列表
   */
  getAllStrategies(): RecommendationStrategy[] {
    return Object.values(RECOMMENDATION_STRATEGIES);
  }
}
