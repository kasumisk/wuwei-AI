/**
 * V6 Phase 2.1 — 策略解析器
 *
 * 职责: 给定 (userId, goalType)，解析出最终的 ResolvedStrategy。
 *
 * 合并优先级（从高到低）:
 *   1. 用户级分配（MANUAL / EXPERIMENT / SEGMENT）
 *   2. V7.0: 上下文策略（scope=CONTEXT，按时段/工作日/季节/生命周期匹配）
 *   3. 目标类型策略（scope=GOAL_TYPE, scopeTarget=goalType）
 *   4. 全局默认策略（scope=GLOBAL）
 *   5. 系统硬编码默认值（recommendation.types.ts 中的常量）
 *
 * 合并规则:
 * - 深度合并 StrategyConfig，高优先级的非空字段覆盖低优先级
 * - 基础权重数组如果提供则整体替换（不按维度合并）
 * - 嵌套对象字段按 key 合并
 *
 * 缓存: 整个解析结果缓存 30s（key = userId + goalType）
 */
import { Injectable, Logger } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import {
  StrategyConfig,
  StrategyScope,
  ResolvedStrategy,
  RankPolicyConfig,
  RecallPolicyConfig,
  BoostPolicyConfig,
  MealPolicyConfig,
  MultiObjectiveConfig,
  ExplorationPolicyConfig,
  AssemblyPolicyConfig,
  ExplainPolicyConfig,
  RealismConfig,
  ContextStrategyCondition,
  StrategyContextInput,
  StrategyEntity,
} from '../strategy.types';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';

/** 解析结果缓存 TTL（秒） */
const RESOLVE_CACHE_TTL = 30;
/** 缓存键前缀 */
const CACHE_PREFIX = 'strategy:resolved:';

@Injectable()
export class StrategyResolver {
  private readonly logger = new Logger(StrategyResolver.name);

  constructor(
    private readonly strategyService: StrategyService,
    private readonly redis: RedisCacheService,
  ) {}

  /**
   * 解析用户当前应使用的推荐策略
   *
   * @param userId 用户 ID
   * @param goalType 目标类型
   * @param contextInput V7.0: 可选的上下文输入（用于 CONTEXT scope 匹配）
   * @returns 合并后的 ResolvedStrategy
   */
  async resolve(
    userId: string,
    goalType: string,
    contextInput?: StrategyContextInput,
  ): Promise<ResolvedStrategy> {
    const cacheKey = `${CACHE_PREFIX}${userId}:${goalType}`;

    const cached = await this.redis.getOrSet<ResolvedStrategy>(
      cacheKey,
      RESOLVE_CACHE_TTL * 1000,
      () => this.doResolve(userId, goalType, contextInput),
    );

    return cached!;
  }

  /**
   * V6 2.4: 将额外的策略配置合并到已解析的策略中
   *
   * 用于 A/B 实验打通 — 在 StrategyResolver.resolve() 返回后，
   * 由推荐引擎调用以注入实验层配置。
   *
   * @param resolved 已解析的策略
   * @param override 需要叠加的策略配置（高优先级覆盖）
   * @param source 来源标识（如 "experiment:xxx/group_a"）
   * @returns 合并后的新 ResolvedStrategy（不修改原对象）
   */
  mergeConfigOverride(
    resolved: ResolvedStrategy,
    override: StrategyConfig,
    source: string,
  ): ResolvedStrategy {
    const mergedConfig = this.deepMergeStrategy(resolved.config, override);
    return {
      ...resolved,
      strategyId: `${resolved.strategyId}+${source}`,
      strategyName: `${resolved.strategyName}(+实验)`,
      sources: [...resolved.sources, source],
      config: mergedConfig,
    };
  }

  /**
   * 实际的策略解析逻辑（不带缓存）
   *
   * V7.0 合并优先级（从低到高）:
   *   GLOBAL → GOAL_TYPE → CONTEXT → EXPERIMENT/USER
   */
  private async doResolve(
    userId: string,
    goalType: string,
    contextInput?: StrategyContextInput,
  ): Promise<ResolvedStrategy> {
    const sources: string[] = [];
    const configs: StrategyConfig[] = [];

    // 1. 全局默认策略（最低优先级，先入栈）
    const globalStrategy = await this.strategyService.getGlobalStrategy();
    if (globalStrategy) {
      configs.push(globalStrategy.config);
      sources.push(`global:${globalStrategy.id}`);
    }

    // 2. 目标类型策略
    const goalStrategy = await this.strategyService.getActiveStrategy(
      StrategyScope.GOAL_TYPE,
      goalType,
    );
    if (goalStrategy) {
      configs.push(goalStrategy.config);
      sources.push(`goal:${goalStrategy.id}`);
    }

    // 3. V7.0: 上下文策略（CONTEXT scope）
    if (contextInput) {
      const contextStrategy = await this.matchContextStrategy(contextInput);
      if (contextStrategy) {
        configs.push(contextStrategy.config);
        sources.push(`context:${contextStrategy.id}`);
      }
    }

    // 4. 用户级分配策略（最高优先级）
    const assignment = await this.strategyService.getUserAssignment(userId);
    if (assignment && assignment.strategyId) {
      const userStrategy = await this.strategyService.findById(
        assignment.strategyId,
      );
      if (userStrategy) {
        configs.push(userStrategy.config);
        sources.push(`${assignment.assignmentType}:${userStrategy.id}`);
      }
    }

    // 合并所有策略配置（后面的覆盖前面的）
    const mergedConfig = this.mergeConfigs(configs);

    // 构建策略 ID（用所有来源 hash）
    const strategyId =
      sources.length > 0 ? sources.join('+') : 'system-default';

    return {
      strategyId,
      strategyName:
        sources.length > 0 ? `合并策略(${sources.length}层)` : '系统默认策略',
      sources,
      config: mergedConfig,
      resolvedAt: Date.now(),
    };
  }

  /**
   * V7.0: 从所有 CONTEXT scope 策略中找最佳匹配
   *
   * 匹配逻辑:
   * 1. 获取所有 active 的 CONTEXT 策略
   * 2. 逐个检查 context_condition — 所有指定的字段都必须匹配
   * 3. 选择匹配维度数最多的（最具体的）策略
   * 4. 全部不匹配返回 null（跳过此层）
   */
  private async matchContextStrategy(
    input: StrategyContextInput,
  ): Promise<StrategyEntity | null> {
    const strategies = await this.strategyService.getContextStrategies();
    if (!strategies.length) {
      return null;
    }

    let bestMatch: StrategyEntity | null = null;
    let bestScore = 0;

    for (const strategy of strategies) {
      const condition = strategy.contextCondition;
      if (!condition) continue;

      const { matches, score } = this.evaluateCondition(condition, input);
      if (matches && score > bestScore) {
        bestMatch = strategy;
        bestScore = score;
      }
    }

    if (bestMatch) {
      this.logger.debug(
        `Context strategy matched: ${bestMatch.name} (score=${bestScore})`,
      );
    }

    return bestMatch;
  }

  /**
   * V7.0: 评估单个上下文条件是否匹配
   *
   * 规则:
   * - 缺失字段视为"不限制"（通配，不增加 score）
   * - 所有指定的字段都必须匹配（AND 逻辑）
   * - score = 匹配的字段数（越多越具体）
   */
  private evaluateCondition(
    condition: ContextStrategyCondition,
    input: StrategyContextInput,
  ): { matches: boolean; score: number } {
    let score = 0;

    // 时段匹配
    if (condition.timeOfDay?.length) {
      if (!condition.timeOfDay.includes(input.timeOfDay)) {
        return { matches: false, score: 0 };
      }
      score++;
    }

    // 工作日/周末匹配
    if (condition.dayType?.length) {
      if (!condition.dayType.includes(input.dayType)) {
        return { matches: false, score: 0 };
      }
      score++;
    }

    // 季节匹配
    if (condition.season?.length) {
      if (!condition.season.includes(input.season)) {
        return { matches: false, score: 0 };
      }
      score++;
    }

    // 用户生命周期匹配
    if (condition.userLifecycle?.length) {
      if (!condition.userLifecycle.includes(input.lifecycle)) {
        return { matches: false, score: 0 };
      }
      score++;
    }

    // 目标阶段类型匹配
    if (condition.goalPhaseType?.length) {
      if (
        !input.goalPhaseType ||
        !condition.goalPhaseType.includes(input.goalPhaseType)
      ) {
        return { matches: false, score: 0 };
      }
      score++;
    }

    // 没有指定任何条件的策略不匹配（避免空条件通配所有）
    if (score === 0) {
      return { matches: false, score: 0 };
    }

    return { matches: true, score };
  }

  /**
   * 深度合并策略配置数组（后面的覆盖前面的）
   */
  private mergeConfigs(configs: StrategyConfig[]): StrategyConfig {
    if (configs.length === 0) return {};
    if (configs.length === 1) return { ...configs[0] };

    let result: StrategyConfig = {};
    for (const config of configs) {
      result = this.deepMergeStrategy(result, config);
    }
    return result;
  }

  /**
   * 两个 StrategyConfig 的深度合并
   * 规则:
   * - 数组字段: 后者整体替换（如 baseWeights 的 number[]）
   * - 对象字段: 递归合并
   * - 基础类型: 后者覆盖
   */
  private deepMergeStrategy(
    base: StrategyConfig,
    override: StrategyConfig,
  ): StrategyConfig {
    return {
      rank: this.mergeRank(base.rank, override.rank),
      recall: this.mergeRecall(base.recall, override.recall),
      boost: this.mergeBoost(base.boost, override.boost),
      meal: this.mergeMeal(base.meal, override.meal),
      multiObjective: this.mergeMultiObjective(
        base.multiObjective,
        override.multiObjective,
      ),
      exploration: this.mergeExploration(
        base.exploration,
        override.exploration,
      ),
      assembly: this.mergeAssembly(base.assembly, override.assembly),
      explain: this.mergeExplain(base.explain, override.explain),
      realism: this.mergeRealism(base.realism, override.realism),
    };
  }

  private mergeRank(
    base?: RankPolicyConfig,
    override?: RankPolicyConfig,
  ): RankPolicyConfig | undefined {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;

    return {
      baseWeights: override.baseWeights
        ? { ...base.baseWeights, ...override.baseWeights }
        : base.baseWeights,
      mealModifiers: override.mealModifiers
        ? { ...base.mealModifiers, ...override.mealModifiers }
        : base.mealModifiers,
      statusModifiers: override.statusModifiers
        ? { ...base.statusModifiers, ...override.statusModifiers }
        : base.statusModifiers,
    };
  }

  private mergeRecall(
    base?: RecallPolicyConfig,
    override?: RecallPolicyConfig,
  ): RecallPolicyConfig | undefined {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;

    return {
      sources: override.sources
        ? {
            ...base.sources,
            ...override.sources,
          }
        : base.sources,
      shortTermRejectThreshold:
        override.shortTermRejectThreshold ?? base.shortTermRejectThreshold,
    };
  }

  private mergeBoost(
    base?: BoostPolicyConfig,
    override?: BoostPolicyConfig,
  ): BoostPolicyConfig | undefined {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;

    return {
      preference: override.preference
        ? { ...base.preference, ...override.preference }
        : base.preference,
      cfBoostCap: override.cfBoostCap ?? base.cfBoostCap,
      shortTerm: override.shortTerm
        ? { ...base.shortTerm, ...override.shortTerm }
        : base.shortTerm,
      similarityPenaltyCoeff:
        override.similarityPenaltyCoeff ?? base.similarityPenaltyCoeff,
    };
  }

  private mergeMeal(
    base?: MealPolicyConfig,
    override?: MealPolicyConfig,
  ): MealPolicyConfig | undefined {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;

    return {
      mealRoles: override.mealRoles
        ? { ...base.mealRoles, ...override.mealRoles }
        : base.mealRoles,
      roleCategories: override.roleCategories
        ? { ...base.roleCategories, ...override.roleCategories }
        : base.roleCategories,
      mealRatios: override.mealRatios
        ? { ...base.mealRatios, ...override.mealRatios }
        : base.mealRatios,
      macroRanges: override.macroRanges
        ? { ...base.macroRanges, ...override.macroRanges }
        : base.macroRanges,
    };
  }

  private mergeMultiObjective(
    base?: MultiObjectiveConfig,
    override?: MultiObjectiveConfig,
  ): MultiObjectiveConfig | undefined {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;

    return {
      enabled: override.enabled ?? base.enabled,
      preferences: override.preferences
        ? { ...base.preferences, ...override.preferences }
        : base.preferences,
      paretoFrontLimit: override.paretoFrontLimit ?? base.paretoFrontLimit,
      tastePreference: override.tastePreference
        ? { ...base.tastePreference, ...override.tastePreference }
        : base.tastePreference,
      costSensitivity: override.costSensitivity ?? base.costSensitivity,
    };
  }

  private mergeExploration(
    base?: ExplorationPolicyConfig,
    override?: ExplorationPolicyConfig,
  ): ExplorationPolicyConfig | undefined {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;

    return {
      baseMin: override.baseMin ?? base.baseMin,
      baseMax: override.baseMax ?? base.baseMax,
      maturityShrink: override.maturityShrink ?? base.maturityShrink,
      matureThreshold: override.matureThreshold ?? base.matureThreshold,
    };
  }

  // ─── V6.3 P2-1: 新增合并方法 ───

  private mergeAssembly(
    base?: AssemblyPolicyConfig,
    override?: AssemblyPolicyConfig,
  ): AssemblyPolicyConfig | undefined {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;

    return {
      preferRecipe: override.preferRecipe ?? base.preferRecipe,
      diversityLevel: override.diversityLevel ?? base.diversityLevel,
    };
  }

  private mergeExplain(
    base?: ExplainPolicyConfig,
    override?: ExplainPolicyConfig,
  ): ExplainPolicyConfig | undefined {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;

    return {
      detailLevel: override.detailLevel ?? base.detailLevel,
      showNutritionRadar:
        override.showNutritionRadar ?? base.showNutritionRadar,
    };
  }

  // ─── V6.5: 新增合并方法 ───

  private mergeRealism(
    base?: RealismConfig,
    override?: RealismConfig,
  ): RealismConfig | undefined {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;

    return {
      enabled: override.enabled ?? base.enabled,
      commonalityThreshold:
        override.commonalityThreshold ?? base.commonalityThreshold,
      budgetFilterEnabled:
        override.budgetFilterEnabled ?? base.budgetFilterEnabled,
      cookTimeCapEnabled:
        override.cookTimeCapEnabled ?? base.cookTimeCapEnabled,
      weekdayCookTimeCap:
        override.weekdayCookTimeCap ?? base.weekdayCookTimeCap,
      weekendCookTimeCap:
        override.weekendCookTimeCap ?? base.weekendCookTimeCap,
      executabilityWeightMultiplier:
        override.executabilityWeightMultiplier ??
        base.executabilityWeightMultiplier,
    };
  }
}
