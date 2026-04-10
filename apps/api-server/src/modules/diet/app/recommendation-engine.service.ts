import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../food/entities/food-library.entity';
import { FoodRegionalInfo } from '../../food/entities/food-regional-info.entity';
import { FoodRecord } from '../entities/food-record.entity';
import { RecommendationFeedback } from '../entities/recommendation-feedback.entity';
import { GoalType } from './nutrition-score.service';
import { ConstraintGeneratorService } from './recommendation/constraint-generator.service';
import { FoodFilterService } from './recommendation/food-filter.service';
import { FoodScorerService } from './recommendation/food-scorer.service';
import { MealAssemblerService } from './recommendation/meal-assembler.service';
import {
  MealTarget,
  Constraint,
  ScoredFood,
  MealRecommendation,
  UserProfileConstraints,
  UserPreferenceProfile,
  FoodFeedbackStats,
  PipelineContext,
  MEAL_ROLES,
  ROLE_CATEGORIES,
} from './recommendation/recommendation.types';
import { HealthModifierContext } from './recommendation/health-modifier-engine.service';
import { FoodPoolCacheService } from './recommendation/food-pool-cache.service';
import { RecommendationFeedbackService } from './recommendation/feedback.service';
import { PreferenceProfileService } from './recommendation/preference-profile.service';
import {
  SubstitutionService,
  SubstituteCandidate,
} from './recommendation/substitution.service';
import {
  filterByAllergens,
  hasAllergenConflict,
  matchAllergens,
} from './recommendation/allergen-filter.util';
import { ExplanationGeneratorService } from './recommendation/explanation-generator.service';
import { t } from './recommendation/i18n-messages';
import { WeightLearnerService } from './recommendation/weight-learner.service';
import {
  RealtimeProfileService,
  ShortTermProfile,
} from '../../user/app/realtime-profile.service';
import { ContextualProfile } from '../../user/app/contextual-profile.service';
import { StrategyResolver } from '../../strategy/app/strategy-resolver.service';
import {
  ResolvedStrategy,
  StrategyConfig,
} from '../../strategy/strategy.types';
import { ABTestingService } from './recommendation/ab-testing.service';
import {
  multiObjectiveOptimize,
  extractRankedFoods,
} from './recommendation/multi-objective-optimizer';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';
import { AnalysisShortTermProfile } from '../../food/app/analysis-event.listener';

// 向后兼容：re-export SubstituteCandidate 和所有类型
export type { SubstituteCandidate } from './recommendation/substitution.service';
export type {
  MealTarget,
  Constraint,
  ScoredFood,
  MealRecommendation,
} from './recommendation/recommendation.types';
export type {
  ScoringExplanation,
  DimensionScore,
} from './recommendation/scoring-explanation.interface';

/** V6 2.8: 反向解释 API 返回结构 */
export interface WhyNotResult {
  /** 食物名 */
  foodName: string;
  /** 是否在食物库中找到 */
  found: boolean;
  /** 该食物的综合评分（0 = 被过滤/否决） */
  score: number;
  /** 不推荐的原因（用户可读，中文） */
  reason: string;
  /** 推荐的替代食物（同餐次、同角色的 Top-5） */
  alternatives: Array<{
    foodId: string;
    name: string;
    category: string;
    score: number;
    servingCalories: number;
    servingProtein: number;
  }>;
}

/** V5 2.1: 每个角色最多保留的候选数量，供全局优化器替换用 */
const OPTIMIZER_CANDIDATE_LIMIT = 8;

@Injectable()
export class RecommendationEngineService {
  private readonly logger = new Logger(RecommendationEngineService.name);

  constructor(
    @InjectRepository(FoodLibrary)
    private readonly foodLibraryRepo: Repository<FoodLibrary>,
    @InjectRepository(FoodRecord)
    private readonly foodRecordRepo: Repository<FoodRecord>,
    @InjectRepository(RecommendationFeedback)
    private readonly feedbackRepo: Repository<RecommendationFeedback>,
    @InjectRepository(FoodRegionalInfo)
    private readonly regionalInfoRepo: Repository<FoodRegionalInfo>,
    private readonly constraintGenerator: ConstraintGeneratorService,
    private readonly foodFilter: FoodFilterService,
    private readonly foodScorer: FoodScorerService,
    private readonly mealAssembler: MealAssemblerService,
    private readonly foodPoolCache: FoodPoolCacheService,
    private readonly feedbackService: RecommendationFeedbackService,
    private readonly preferenceProfileService: PreferenceProfileService,
    private readonly substitutionService: SubstitutionService,
    private readonly weightLearner: WeightLearnerService,
    private readonly realtimeProfile: RealtimeProfileService,
    /** V6 2.2: 策略解析器（来自全局 StrategyModule） */
    private readonly strategyResolver: StrategyResolver,
    /** V6 2.4: A/B 实验服务（策略 ↔ 实验打通） */
    private readonly abTestingService: ABTestingService,
    /** V6 2.8: 推荐解释生成器（反向解释 API） */
    private readonly explanationGenerator: ExplanationGeneratorService,
    /** V6.1 Phase 3.5: Redis — 直接读取分析画像，避免 FoodModule 循环依赖 */
    private readonly redis: RedisCacheService,
  ) {}

  // ─── 向后兼容：委托到子服务 ───

  generateConstraints(
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    mealType?: string,
    userProfile?: UserProfileConstraints,
    timezone?: string,
  ): Constraint {
    return this.constraintGenerator.generateConstraints(
      goalType,
      consumed,
      target,
      dailyTarget,
      mealType,
      userProfile,
      timezone,
    );
  }

  filterFoods(
    foods: FoodLibrary[],
    constraint: Constraint,
    mealType?: string,
    userAllergens?: string[],
  ): FoodLibrary[] {
    return this.foodFilter.filterFoods(
      foods,
      constraint,
      mealType,
      userAllergens,
    );
  }

  scoreFood(food: FoodLibrary, goalType: string, target?: MealTarget): number {
    return this.foodScorer.scoreFood(food, goalType, target);
  }

  diversify(
    foods: ScoredFood[],
    recentFoodNames: string[],
    limit: number = 3,
  ): ScoredFood[] {
    return this.mealAssembler.diversify(foods, recentFoodNames, limit);
  }

  diversifyWithPenalty(
    scored: ScoredFood[],
    excludeNames: string[],
    limit: number = 3,
  ): ScoredFood[] {
    return this.mealAssembler.diversifyWithPenalty(scored, excludeNames, limit);
  }

  // ─── 核心推荐函数 ───

  async recommendMeal(
    userId: string,
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    userProfile?: UserProfileConstraints,
  ): Promise<MealRecommendation> {
    const [
      allFoods,
      recentFoodNames,
      feedbackStats,
      preferenceProfile,
      regionalBoostMap,
      shortTermProfile,
      // V6 2.2: 并行解析策略
      resolvedStrategy,
      // V6.1 Phase 3.5: 并行获取分析画像
      analysisProfile,
    ] = await Promise.all([
      this.getAllFoods(),
      this.getRecentFoodNames(userId, 3),
      this.getUserFeedbackStats(userId),
      this.getUserPreferenceProfile(userId),
      this.getRegionalBoostMap(userProfile?.regionCode || 'CN'),
      // V6 1.9: 并行获取短期画像
      this.realtimeProfile.getShortTermProfile(userId),
      // V6 2.2: 并行解析用户策略
      this.resolveStrategyForUser(userId, goalType),
      // V6.1 Phase 3.5: 直接读 Redis（避免 FoodModule 循环依赖）
      this.getAnalysisProfile(userId),
    ]);

    return this.recommendMealFromPool(
      allFoods,
      mealType,
      goalType,
      consumed,
      target,
      dailyTarget,
      recentFoodNames,
      undefined,
      feedbackStats,
      userProfile,
      preferenceProfile,
      regionalBoostMap,
      undefined, // cfScores
      undefined, // weightOverrides
      undefined, // mealWeightOverrides
      shortTermProfile, // V6 1.9: 短期画像
      resolvedStrategy, // V6 2.2: 解析后的策略配置
      undefined, // contextualProfile（由 recommendMeal 不传，场景化推荐单独处理）
      analysisProfile, // V6.1 Phase 3.5: 分析画像
    );
  }

  // ─── 场景化推荐 ───

  /**
   * 场景推荐 — 外卖 / 便利店 / 在家做
   *
   * V4 修复: 改用结构化过滤（category + processingLevel + isProcessed）
   * 替代之前的 tag 过滤，因为 takeout/fast_food 等标签在食物库中不存在，
   * 导致三个场景全部回退到无过滤池，返回相同结果。
   *
   * 每个场景使用独立的 `ScenarioFilter` 对食物做硬过滤，
   * 然后叠加场景特定的评分偏移，最后用 stochastic top-K 保证差异性。
   */
  async recommendByScenario(
    userId: string,
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    userProfile?: UserProfileConstraints,
  ): Promise<{
    takeout: MealRecommendation;
    convenience: MealRecommendation;
    homeCook: MealRecommendation;
  }> {
    const allFoods = await this.getAllFoods();
    const recentFoodNames = await this.getRecentFoodNames(userId, 3);
    const baseConstraints = this.constraintGenerator.generateConstraints(
      goalType,
      consumed,
      target,
      dailyTarget,
      mealType,
      userProfile,
      userProfile?.timezone,
    );

    const userAllergens = userProfile?.allergens;

    /**
     * 场景过滤器：基于食物的结构化字段而非标签
     * 每个场景返回一个 predicate 函数 + 评分偏移策略
     */
    type ScenarioFilter = {
      /** 硬过滤: 该场景下食物是否可用 */
      filter: (food: FoodLibrary) => boolean;
      /** 软偏移: 场景内评分乘数 (0.5~1.5) */
      scoreBoost: (food: FoodLibrary) => number;
    };

    const SCENARIO_FILTERS: Record<string, ScenarioFilter> = {
      /**
       * 外卖场景 — 偏好加工/复合类食物，适合外卖点餐
       * 筛选: composite 类 OR processingLevel >= 2 OR 含 meal_prep_friendly 标签
       * 偏移: composite +20%, 高加工 +10%
       */
      takeout: {
        filter: (f) => {
          if (f.category === 'composite') return true;
          if (f.processingLevel >= 2) return true;
          if (
            (f.tags || []).some((t) =>
              ['meal_prep_friendly', 'quick_prep'].includes(t),
            )
          )
            return true;
          // 蛋白 + 主食类也常见于外卖
          if (
            ['protein', 'grain'].includes(f.category) &&
            f.processingLevel >= 1
          )
            return true;
          return false;
        },
        scoreBoost: (f) => {
          let boost = 1.0;
          if (f.category === 'composite') boost *= 1.2;
          if (f.processingLevel >= 2) boost *= 1.1;
          return boost;
        },
      },
      /**
       * 便利店场景 — 即食/预包装/低加工小份量
       * 筛选: snack/beverage/fruit/dairy 类，或 standardServingG <= 200
       * 偏移: 小份量 +15%, fruit/dairy +10%
       */
      convenience: {
        filter: (f) => {
          if (['snack', 'beverage', 'fruit', 'dairy'].includes(f.category))
            return true;
          if (f.standardServingG <= 200 && f.processingLevel >= 1) return true;
          // 蛋白小包装（如即食鸡胸肉、茶叶蛋）
          if (f.category === 'protein' && f.standardServingG <= 150)
            return true;
          return false;
        },
        scoreBoost: (f) => {
          let boost = 1.0;
          if (['fruit', 'dairy'].includes(f.category)) boost *= 1.1;
          if (f.standardServingG <= 150) boost *= 1.15;
          if ((f.tags || []).includes('low_calorie')) boost *= 1.1;
          return boost;
        },
      },
      /**
       * 在家做场景 — 天然/低加工/可烹饪的原材料
       * 筛选: processingLevel <= 2 AND !isProcessed，或天然食材类
       * 偏移: 天然蔬菜/蛋白 +15%, processingLevel=1 +10%
       */
      homeCook: {
        filter: (f) => {
          if (!f.isProcessed && f.processingLevel <= 2) return true;
          if (
            ['veggie', 'protein', 'grain', 'fruit'].includes(f.category) &&
            f.processingLevel <= 2
          )
            return true;
          return false;
        },
        scoreBoost: (f) => {
          let boost = 1.0;
          if (['veggie', 'protein'].includes(f.category)) boost *= 1.15;
          if (f.processingLevel === 1) boost *= 1.1;
          if ((f.tags || []).includes('natural')) boost *= 1.05;
          return boost;
        },
      },
    };

    const scenarioLabels: Record<string, string> = {
      takeout: t('scenario.takeout'),
      convenience: t('scenario.convenience'),
      homeCook: t('scenario.homeCook'),
    };

    // 使用不同的 excludeNames 种子确保三个场景有差异性
    const usedAcrossScenarios = new Set<string>();

    const buildForScenario = (scenarioKey: string): MealRecommendation => {
      const scenario = SCENARIO_FILTERS[scenarioKey];
      const scenarioName = scenarioLabels[scenarioKey];

      // Step 1: 结构化场景过滤
      let candidates = allFoods.filter((f) => {
        // 基础过滤: mealType + 过敏原 + excludeTags
        const foodMealTypes: string[] = f.mealTypes || [];
        if (foodMealTypes.length > 0 && !foodMealTypes.includes(mealType))
          return false;
        if (userAllergens?.length && hasAllergenConflict(f, userAllergens))
          return false;
        if (baseConstraints.excludeTags.length > 0) {
          const tags = f.tags || [];
          if (baseConstraints.excludeTags.some((et) => tags.includes(et)))
            return false;
        }
        // 热量上限
        const servingCal = (f.calories * f.standardServingG) / 100;
        if (servingCal > baseConstraints.maxCalories) return false;
        // 场景硬过滤
        return scenario.filter(f);
      });

      // V5 2.12: 渐进放宽 — 从 3→2→1 逐步降低最低候选数
      // 而非直接回退到全池，保持场景特色
      if (candidates.length < 3) {
        // 放宽 Level 1: 保留场景过滤，放宽 excludeTags + 热量上限
        candidates = allFoods.filter((f) => {
          const foodMealTypes: string[] = f.mealTypes || [];
          if (foodMealTypes.length > 0 && !foodMealTypes.includes(mealType))
            return false;
          if (userAllergens?.length && hasAllergenConflict(f, userAllergens))
            return false;
          return scenario.filter(f);
        });
      }

      if (candidates.length < 2) {
        // 放宽 Level 2: 去掉场景过滤，仅保留 mealType + 过敏原
        candidates = allFoods.filter((f) => {
          const foodMealTypes: string[] = f.mealTypes || [];
          if (foodMealTypes.length > 0 && !foodMealTypes.includes(mealType))
            return false;
          if (userAllergens?.length && hasAllergenConflict(f, userAllergens))
            return false;
          return true;
        });
      }

      if (candidates.length < 1) {
        // 放宽 Level 3: 仅保留过敏原过滤（终极兜底）
        candidates = allFoods.filter(
          (f) =>
            !userAllergens?.length || !hasAllergenConflict(f, userAllergens),
        );
      }

      // Step 2: 评分 — 基础 9 维评分 × 场景偏移
      const scored = this.foodScorer
        .scoreFoodsWithServing(
          candidates,
          goalType,
          target,
          { allergens: userAllergens, goalType },
          mealType,
        )
        .map((sf) => ({
          ...sf,
          score: sf.score * scenario.scoreBoost(sf.food),
        }));

      // Step 3: 去重 — 排除最近食物 + 其他场景已选食物
      const excludeNames = [...recentFoodNames, ...usedAcrossScenarios];
      const picks = this.mealAssembler.diversify(scored, excludeNames, 2);

      // 记录本场景选出的食物，让下一个场景避开
      for (const p of picks) {
        usedAcrossScenarios.add(p.food.name);
      }

      return this.mealAssembler.aggregateMealResult(
        picks,
        t('scenario.tip', {
          scenarioName,
          calories: picks.reduce((s, p) => s + p.servingCalories, 0),
        }),
      );
    };

    return {
      takeout: buildForScenario('takeout'),
      convenience: buildForScenario('convenience'),
      homeCook: buildForScenario('homeCook'),
    };
  }

  // ─── 从食物池推荐（三阶段 Pipeline: Recall → Rank → Rerank） ───

  recommendMealFromPool(
    allFoods: FoodLibrary[],
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    excludeNames: string[],
    userPreferences?: { loves?: string[]; avoids?: string[] },
    feedbackStats?: Record<string, FoodFeedbackStats>,
    userProfile?: UserProfileConstraints,
    preferenceProfile?: UserPreferenceProfile,
    regionalBoostMap?: Record<string, number>,
    cfScores?: Record<string, number>,
    /** V5 4.7: 在线学习后的权重覆盖 */
    weightOverrides?: number[] | null,
    /** V5 4.8: A/B 实验组覆盖的餐次权重修正 */
    mealWeightOverrides?: Record<string, Record<string, number>> | null,
    /** V6 1.9: 短期画像上下文（近 7 天行为） */
    shortTermProfile?: ShortTermProfile | null,
    /** V6 2.2: 解析后的策略配置 */
    resolvedStrategy?: ResolvedStrategy | null,
    /** V6 2.18: 上下文画像（场景检测结果） */
    contextualProfile?: ContextualProfile | null,
    /** V6.1 Phase 3.5: 分析画像（近期分析的食物分类、风险食物等） */
    analysisProfile?: AnalysisShortTermProfile | null,
  ): MealRecommendation {
    const constraints = this.constraintGenerator.generateConstraints(
      goalType,
      consumed,
      target,
      dailyTarget,
      mealType,
      userProfile,
      userProfile?.timezone,
    );

    // V6 2.3: MealPolicy 覆盖餐次角色模板
    const mealPolicy = resolvedStrategy?.config?.meal;
    const roles = mealPolicy?.mealRoles?.[mealType] ??
      MEAL_ROLES[mealType] ?? ['carb', 'protein', 'veggie'];
    const picks: ScoredFood[] = [];
    const usedNames = new Set(excludeNames);
    // V5 2.1: 收集候选池，供全局优化器在跨餐替换时使用
    const allCandidates: ScoredFood[] = [];

    // 构建 Pipeline 共享上下文
    const ctx: PipelineContext = {
      allFoods,
      mealType,
      goalType,
      target,
      constraints,
      usedNames,
      picks,
      userPreferences,
      feedbackStats,
      userProfile,
      preferenceProfile,
      regionalBoostMap,
      cfScores,
      weightOverrides, // V5 4.7: 在线学习权重
      mealWeightOverrides, // V5 4.8: A/B 实验组餐次权重覆盖
      shortTermProfile, // V6 1.9: 短期画像上下文
      resolvedStrategy, // V6 2.2: 策略引擎解析结果
      contextualProfile, // V6 2.18: 上下文画像（场景检测）
      analysisProfile, // V6.1 Phase 3.5: 分析画像
    };

    for (const role of roles) {
      // Stage 1: Recall — 粗筛候选
      const recalled = this.recallCandidates(ctx, role);

      // Stage 2: Rank — 精排评分
      const ranked = this.rankCandidates(ctx, recalled);

      // V6 2.5: 多目标优化（可选） — 在 Rank 后、Rerank 前对候选重排序
      const moConfig = ctx.resolvedStrategy?.config?.multiObjective;
      const finalRanked =
        moConfig?.enabled && ranked.length > 0
          ? extractRankedFoods(
              multiObjectiveOptimize(ranked, moConfig),
              ranked.length,
            )
          : ranked;

      // V5 2.1: 收集每个角色的 Top 候选（供全局优化器替换用）
      allCandidates.push(...finalRanked.slice(0, OPTIMIZER_CANDIDATE_LIMIT));

      // Stage 3: Rerank — 探索+去重 → 选出 Top-1
      const selected = this.rerankAndSelect(ctx, finalRanked);

      if (selected) {
        picks.push(selected);
        usedNames.add(selected.food.name);
      }
    }

    const adjustedPicks = this.mealAssembler.adjustPortions(
      picks,
      target.calories,
    );
    const tip = this.mealAssembler.buildTip(
      mealType,
      goalType,
      target,
      adjustedPicks.reduce((s, p) => s + p.servingCalories, 0),
    );
    const result = this.mealAssembler.aggregateMealResult(adjustedPicks, tip);
    // V5 2.1: 附带候选池供全局优化器使用
    result.candidates = allCandidates;
    return result;
  }

  // ─── Stage 1: Recall（候选召回） ───

  /**
   * 召回阶段 — 基于角色类别 + 硬约束过滤
   *
   * 过滤链路:
   * 1. 角色类别匹配 (ROLE_CATEGORIES)
   * 2. 已选食物排除 (usedNames)
   * 3. 餐次适配 (mealTypes)
   * 4. 排除标签 (excludeTags)
   * 5. 过敏原过滤 (allergens)
   * 6. 短期画像拒绝过滤 (rejectedFoods)
   * 7. V6.1: 分析画像风险食物过滤 (recentRiskFoods)
   * 8. 兜底: 如果过滤后为空，回退到全集
   */
  private recallCandidates(ctx: PipelineContext, role: string): FoodLibrary[] {
    // V6 2.3: MealPolicy 覆盖角色→品类映射
    const mealPolicy = ctx.resolvedStrategy?.config?.meal;
    const roleCategories =
      mealPolicy?.roleCategories?.[role] ?? ROLE_CATEGORIES[role] ?? [];
    let candidates = ctx.allFoods.filter(
      (f) => roleCategories.includes(f.category) && !ctx.usedNames.has(f.name),
    );

    // mealType 过滤
    candidates = candidates.filter((f) => {
      const foodMealTypes: string[] = f.mealTypes || [];
      return foodMealTypes.length === 0 || foodMealTypes.includes(ctx.mealType);
    });

    // exclude tag 过滤
    if (ctx.constraints.excludeTags.length > 0) {
      candidates = candidates.filter((f) => {
        const tags = f.tags || [];
        return !ctx.constraints.excludeTags.some((t) => tags.includes(t));
      });
    }

    // 过敏原过滤 — 统一使用 allergen-filter.util (V4 A6)
    if (ctx.userProfile?.allergens?.length) {
      candidates = filterByAllergens(candidates, ctx.userProfile.allergens);
    }

    // V6 1.9: 短期画像 — 过滤近 7 天频繁拒绝的食物
    // V6 2.3: 拒绝阈值可通过 RecallPolicy 配置（默认 2 次）
    if (ctx.shortTermProfile?.rejectedFoods) {
      const recallConfig = ctx.resolvedStrategy?.config?.recall;
      const rejectThreshold = recallConfig?.shortTermRejectThreshold ?? 2;
      const frequentlyRejected = new Set(
        Object.entries(ctx.shortTermProfile.rejectedFoods)
          .filter(([, count]) => count >= rejectThreshold)
          .map(([food]) => food),
      );
      if (frequentlyRejected.size > 0) {
        const beforeCount = candidates.length;
        candidates = candidates.filter((f) => !frequentlyRejected.has(f.name));
        // 确保不会过滤掉所有候选（至少保留 3 个）
        if (candidates.length < 3 && beforeCount >= 3) {
          candidates = ctx.allFoods
            .filter(
              (f) =>
                roleCategories.includes(f.category) &&
                !ctx.usedNames.has(f.name),
            )
            .slice(0, 10);
        }
      }
    }

    // V6.1 Phase 3.5: 分析画像 — 过滤近期被标记为 caution/avoid 的风险食物
    // 与短期画像拒绝过滤类似，但数据来源是食物分析模块（非推荐反馈）
    if (ctx.analysisProfile?.recentRiskFoods?.length) {
      const riskFoodSet = new Set(ctx.analysisProfile.recentRiskFoods);
      const beforeCount = candidates.length;
      candidates = candidates.filter((f) => !riskFoodSet.has(f.name));
      // 安全兜底：不能因风险过滤把所有候选清空（至少保留 3 个）
      if (candidates.length < 3 && beforeCount >= 3) {
        candidates = ctx.allFoods
          .filter(
            (f) =>
              roleCategories.includes(f.category) && !ctx.usedNames.has(f.name),
          )
          .slice(0, 10);
      }
    }

    // 兜底: 无候选时回退到全集（排除已选）
    if (candidates.length === 0) {
      candidates = ctx.allFoods.filter((f) => !ctx.usedNames.has(f.name));
    }

    return candidates;
  }

  // ─── Stage 2: Rank（精排评分） ───

  /**
   * 精排阶段 — 多维评分 + 偏好加权
   *
   * 评分链路:
   * 1. 9维营养评分 (food-scorer) + 评分解释骨架
   * 2. 用户偏好加权 (loves +12% / avoids -70%)
   * 3. 偏好画像四维加权 (category/ingredient/foodGroup/foodName)
   * 4. 地区感知偏移 (0.85~1.08)
   * 5. 按分数降序排序
   */
  private rankCandidates(
    ctx: PipelineContext,
    candidates: FoodLibrary[],
  ): ScoredFood[] {
    const penaltyCtx: HealthModifierContext = {
      allergens: ctx.userProfile?.allergens,
      healthConditions: ctx.userProfile?.healthConditions,
      goalType: ctx.goalType,
    };

    const scored: ScoredFood[] = candidates
      .map((food) => {
        const detailed = this.foodScorer.scoreFoodDetailed(
          food,
          ctx.goalType,
          ctx.target,
          penaltyCtx,
          ctx.mealType,
          undefined, // statusFlags
          ctx.weightOverrides, // V5 4.7: 在线学习权重
          ctx.mealWeightOverrides, // V5 4.8: A/B 实验组餐次权重覆盖
          ctx.resolvedStrategy?.config?.rank, // V6 2.2: 策略引擎排序配置
        );
        let score = detailed.score;
        const explanation = detailed.explanation;

        // V6 2.2: 从策略配置读取 boost 参数（缺失则使用系统默认值）
        const boostConfig = ctx.resolvedStrategy?.config?.boost;

        // 用户偏好加权
        let preferenceBoost = 1.0;
        if (ctx.userPreferences) {
          const name = food.name;
          const mainIng = food.mainIngredient || '';
          const lovesMultiplier =
            boostConfig?.preference?.lovesMultiplier ?? 1.12;
          const avoidsMultiplier =
            boostConfig?.preference?.avoidsMultiplier ?? 0.3;
          if (
            ctx.userPreferences.loves?.some(
              (l) => name.includes(l) || mainIng.includes(l),
            )
          ) {
            preferenceBoost = lovesMultiplier;
          }
          if (
            ctx.userPreferences.avoids?.some(
              (a) => name.includes(a) || mainIng.includes(a),
            )
          ) {
            preferenceBoost = avoidsMultiplier;
          }
        }
        score *= preferenceBoost;
        explanation.preferenceBoost = preferenceBoost;

        // 偏好画像四维加权
        let profileBoost = 1.0;
        if (ctx.preferenceProfile) {
          const catW = ctx.preferenceProfile.categoryWeights[food.category];
          if (catW !== undefined) {
            profileBoost *= catW;
          }

          const ingW = food.mainIngredient
            ? ctx.preferenceProfile.ingredientWeights[food.mainIngredient]
            : undefined;
          if (ingW !== undefined) {
            profileBoost *= ingW;
          }

          const grpW = food.foodGroup
            ? ctx.preferenceProfile.foodGroupWeights[food.foodGroup]
            : undefined;
          if (grpW !== undefined) {
            profileBoost *= grpW;
          }

          // 食物名偏好（指数衰减加权，0.7~1.2）
          const nameW = ctx.preferenceProfile.foodNameWeights[food.name];
          if (nameW !== undefined) {
            profileBoost *= nameW;
          }
        }
        score *= profileBoost;
        explanation.profileBoost = profileBoost;

        // 地区感知偏移（0.85~1.08）
        let regionalBoost = 1.0;
        if (ctx.regionalBoostMap) {
          const regionW = ctx.regionalBoostMap[food.id];
          if (regionW !== undefined) {
            regionalBoost = regionW;
          }
        }
        score *= regionalBoost;
        explanation.regionalBoost = regionalBoost;

        // V4 Phase 4.4: 协同过滤加成 — V6 2.2: 上限可配置
        const cfBoostCap = boostConfig?.cfBoostCap ?? 0.15;
        let cfBoost = 0;
        if (ctx.cfScores) {
          const cfScore = ctx.cfScores[food.name];
          if (cfScore !== undefined && cfScore > 0) {
            cfBoost = cfScore * cfBoostCap; // 映射 0~1 → 0~cfBoostCap
            score *= 1 + cfBoost;
          }
        }
        explanation.cfBoost = cfBoost;

        // V6 1.9: 短期画像偏好调整 — V6 2.2: 参数可配置
        const shortTermBoostRange = boostConfig?.shortTerm?.boostRange ?? [
          0.9, 1.1,
        ];
        const singleRejectPenalty =
          boostConfig?.shortTerm?.singleRejectPenalty ?? 0.85;
        let shortTermBoost = 1.0;
        if (ctx.shortTermProfile?.categoryPreferences) {
          const mealPref =
            ctx.shortTermProfile.categoryPreferences[ctx.mealType];
          if (mealPref) {
            const total =
              mealPref.accepted + mealPref.rejected + mealPref.replaced;
            if (total >= 3) {
              // 接受率越高 → 微调越正向
              const acceptRate = mealPref.accepted / total;
              const [minBoost, maxBoost] = shortTermBoostRange;
              shortTermBoost = minBoost + acceptRate * (maxBoost - minBoost);
            }
          }
          // 如果该食物近期被拒绝过（但次数不够召回阶段过滤），适度降权
          const rejCount = ctx.shortTermProfile.rejectedFoods?.[food.name] || 0;
          if (rejCount === 1) {
            shortTermBoost *= singleRejectPenalty;
          }
        }
        score *= shortTermBoost;
        explanation.shortTermBoost = shortTermBoost;

        // V6 2.18: 上下文场景加权 — 根据场景修正系数微调分数
        let sceneBoost = 1.0;
        if (ctx.contextualProfile?.sceneWeightModifiers) {
          // 场景修正通过品类匹配施加差异化影响:
          // - 深夜场景: 低卡食物加分、高卡食物减分
          // - 周末早午餐: 品质高的食物加分
          const mods = ctx.contextualProfile.sceneWeightModifiers;
          // 使用场景修正系数的平均值作为综合加权乘数
          // （精细的维度级修正在 computeWeights 的 mealType 层已处理，
          //   这里做食物粒度的场景适配）
          const modValues = Object.values(mods).filter(
            (v) => v !== undefined,
          ) as number[];
          if (modValues.length > 0) {
            // 场景 boost = 所有修正系数的几何平均
            const product = modValues.reduce((p, v) => p * v, 1.0);
            sceneBoost = Math.pow(product, 1 / modValues.length);
            // 限制范围 [0.8, 1.2] 避免过度影响
            sceneBoost = Math.max(0.8, Math.min(1.2, sceneBoost));
          }
        }
        score *= sceneBoost;
        explanation.sceneBoost = sceneBoost;

        // V6.1 Phase 3.5: 分析画像加权 — 近期分析分类兴趣加成 + 风险食物惩罚
        // 设计逻辑:
        //   - 用户近期频繁分析某分类的食物 → 表示对该分类有兴趣 → 轻微加成（1.0~1.08）
        //   - 食物出现在 recentRiskFoods 中（虽然 Recall 已过滤，但若兜底回来的仍给惩罚）
        let analysisBoost = 1.0;
        if (ctx.analysisProfile) {
          // 分类兴趣加成：根据近期分析频次给予轻微正向偏移
          const analyzedCategories =
            ctx.analysisProfile.recentAnalyzedCategories;
          const categoryCount = analyzedCategories[food.category] ?? 0;
          if (categoryCount > 0) {
            // 分析次数 → 加成: 1次=+2%, 2次=+4%, ... 封顶 +8%
            const categoryInterestBoost = Math.min(categoryCount * 0.02, 0.08);
            analysisBoost *= 1 + categoryInterestBoost;
          }

          // 风险食物惩罚：若该食物在 Recall 兜底后仍进入候选，施加惩罚
          if (ctx.analysisProfile.recentRiskFoods?.includes(food.name)) {
            analysisBoost *= 0.7; // 30% 惩罚
          }
        }
        score *= analysisBoost;
        explanation.analysisBoost = analysisBoost;

        // 更新 explanation 的 finalScore（尚不含 exploration/similarity）
        explanation.finalScore = score;

        return {
          food,
          score,
          ...this.foodScorer.calcServingNutrition(food),
          explanation,
        };
      })
      .sort((a, b) => b.score - a.score);

    return scored;
  }

  // ─── Stage 3: Rerank（重排 + 探索 + 选择） ───

  /**
   * 重排阶段 — Thompson Sampling 探索 + 多样性惩罚 → 选出 Top-1
   *
   * 处理链路:
   * 1. Thompson Sampling (Beta 分布采样，平衡探索-利用)
   * 2. 相似度惩罚 (已选食物的相似度 × 0.3)
   * 3. 重新排序 → 取 Top-1
   * 4. 更新 explanation 中的 explorationMultiplier / similarityPenalty / finalScore
   */
  private rerankAndSelect(
    ctx: PipelineContext,
    ranked: ScoredFood[],
  ): ScoredFood | null {
    if (ranked.length === 0) return null;

    // V6 2.2: 从策略配置读取相似度惩罚系数
    const similarityCoeff =
      ctx.resolvedStrategy?.config?.boost?.similarityPenaltyCoeff ?? 0.3;

    // 记录探索前的分数，用于推导 explorationMultiplier
    const preExploreScores = new Map<string, number>();
    for (const sf of ranked) {
      preExploreScores.set(sf.food.id, sf.score);
    }

    // V6 2.6: 自适应探索率 — 新用户高探索、老用户低探索
    // 从策略配置读取探索策略参数（缺失时使用系统默认值）
    const explorationConfig = ctx.resolvedStrategy?.config?.exploration;
    const baseMin = explorationConfig?.baseMin ?? 0.3;
    const baseMax = explorationConfig?.baseMax ?? 1.7;
    const maturityShrink = explorationConfig?.maturityShrink ?? 0.4;
    const matureThreshold = explorationConfig?.matureThreshold ?? 50;

    // 从 feedbackStats 计算用户累计交互总量（所有食物的 accepted + rejected 之和）
    let totalInteractions = 0;
    if (ctx.feedbackStats) {
      for (const stats of Object.values(ctx.feedbackStats)) {
        totalInteractions += (stats.accepted ?? 0) + (stats.rejected ?? 0);
      }
    }

    // 计算成熟度: 0（全新用户）→ 1（成熟用户）
    const maturity = Math.min(1, totalInteractions / matureThreshold);

    // 计算自适应探索范围:
    //   新用户(maturity≈0): [baseMin, baseMax] = [0.3, 1.7] — 宽范围，高探索
    //   成熟用户(maturity≈1): [baseMin + shrink, baseMax - shrink] = [0.7, 1.3] — 窄范围，高利用
    const adaptiveRange: [number, number] = [
      baseMin + maturityShrink * maturity,
      baseMax - maturityShrink * maturity,
    ];

    // Thompson Sampling 探索（使用自适应范围）
    let reranked = this.mealAssembler.addExploration(
      ranked,
      ctx.feedbackStats,
      adaptiveRange,
    );

    // 食物搭配关系加分/减分 (V4 E5: goodWith/badWith)
    if (ctx.picks.length > 0) {
      reranked = reranked.map((sf) => {
        const compat = this.mealAssembler.compatibilityBonus(
          sf.food,
          ctx.picks.map((p) => p.food),
        );
        return { ...sf, score: sf.score + compat };
      });
    }

    // 相似度去重惩罚: 已选食物越相似，惩罚越大
    if (ctx.picks.length > 0) {
      reranked = reranked
        .map((sf) => {
          const penalty = ctx.picks.reduce(
            (sum, p) =>
              sum +
              this.mealAssembler.similarity(sf.food, p.food) * similarityCoeff,
            0,
          );
          return { ...sf, score: sf.score - penalty };
        })
        .sort((a, b) => b.score - a.score);
    }

    const selected = reranked[0] || null;

    // 填充 explanation 中的 exploration / similarity / compatibility 信息
    if (selected?.explanation) {
      const preScore = preExploreScores.get(selected.food.id) || selected.score;
      const postExploreScore =
        selected.score +
        (ctx.picks.length > 0
          ? ctx.picks.reduce(
              (sum, p) =>
                sum +
                this.mealAssembler.similarity(selected.food, p.food) *
                  similarityCoeff,
              0,
            )
          : 0);
      selected.explanation.explorationMultiplier =
        preScore > 0 ? postExploreScore / preScore : 1.0;
      selected.explanation.similarityPenalty =
        ctx.picks.length > 0
          ? ctx.picks.reduce(
              (sum, p) =>
                sum +
                this.mealAssembler.similarity(selected.food, p.food) *
                  similarityCoeff,
              0,
            )
          : 0;
      selected.explanation.compatibilityBonus =
        ctx.picks.length > 0
          ? this.mealAssembler.compatibilityBonus(
              selected.food,
              ctx.picks.map((p) => p.food),
            )
          : 0;
      selected.explanation.finalScore = selected.score;
    }

    return selected;
  }

  // ─── V6 2.8: 反向解释 API — "为什么不推荐 X？" ───

  /**
   * 对指定食物名进行评分 + 过滤分析，生成反向解释
   *
   * 流程:
   * 1. 在食物库中按名称模糊匹配
   * 2. 检测硬过滤原因（过敏原、餐次不适配、热量超标等）
   * 3. 跑完整评分流程（10 维评分 + 偏好 + 健康修正）
   * 4. 由 ExplanationGeneratorService 生成用户可读的反向解释
   * 5. 返回同角色 Top-5 替代推荐
   *
   * @param userId      用户 ID
   * @param foodName    用户查询的食物名
   * @param mealType    餐次类型
   * @param goalType    用户目标类型
   * @param target      餐次营养目标
   * @param dailyTarget 日营养目标
   * @param consumed    已消耗营养
   * @param userProfile 用户画像约束
   */
  async scoreAndExplainWhyNot(
    userId: string,
    foodName: string,
    mealType: string,
    goalType: string,
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    consumed: { calories: number; protein: number },
    userProfile?: UserProfileConstraints,
  ): Promise<WhyNotResult> {
    // 1. 查找食物 — 先精确匹配，再模糊匹配
    const allFoods = await this.getAllFoods();
    const foodMatches = (food: (typeof allFoods)[number]): boolean => {
      const aliases = (food.aliases || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      return food.name === foodName || aliases.includes(foodName);
    };

    const foodFuzzyMatches = (food: (typeof allFoods)[number]): boolean => {
      const lowered = foodName.toLowerCase();
      const aliases = (food.aliases || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);

      return (
        food.name.includes(foodName) ||
        foodName.includes(food.name) ||
        aliases.some(
          (alias) => alias.includes(lowered) || lowered.includes(alias),
        )
      );
    };

    let food = allFoods.find((f) => foodMatches(f));
    if (!food) {
      // 模糊匹配: 包含关系
      food = allFoods.find((f) => foodFuzzyMatches(f));
    }

    if (!food) {
      return {
        foodName,
        found: false,
        score: 0,
        reason: `食物库中未找到"${foodName}"，请检查食物名称是否正确`,
        alternatives: [],
      };
    }

    // 2. 检测硬过滤原因
    const filterReasons: string[] = [];

    // 2a. 过敏原冲突
    if (userProfile?.allergens?.length) {
      const conflicts = matchAllergens(food, userProfile.allergens);
      if (conflicts.length > 0) {
        filterReasons.push(`含有你的过敏原: ${conflicts.join('、')}`);
      }
    }

    // 2b. 餐次不适配
    const foodMealTypes: string[] = food.mealTypes || [];
    if (foodMealTypes.length > 0 && !foodMealTypes.includes(mealType)) {
      filterReasons.push(
        `该食物不适合${mealType}餐次（适合: ${foodMealTypes.join('、')}）`,
      );
    }

    // 2c. 热量约束
    const constraints = this.constraintGenerator.generateConstraints(
      goalType,
      consumed,
      target,
      dailyTarget,
      mealType,
      userProfile,
      userProfile?.timezone,
    );
    const servingCal = (food.calories * food.standardServingG) / 100;
    if (servingCal > constraints.maxCalories) {
      filterReasons.push(
        `单份热量 ${Math.round(servingCal)}kcal 超过该餐上限 ${Math.round(constraints.maxCalories)}kcal`,
      );
    }

    // 2d. 蛋白质不足
    if (constraints.minProtein > 0 && food.protein) {
      const servingProtein = (food.protein * food.standardServingG) / 100;
      if (servingProtein < constraints.minProtein) {
        filterReasons.push(
          `蛋白质 ${Math.round(servingProtein)}g 低于该餐最低要求 ${Math.round(constraints.minProtein)}g`,
        );
      }
    }

    // 2e. 禁忌标签
    if (constraints.excludeTags.length > 0) {
      const foodTags = food.tags || [];
      const hitTags = constraints.excludeTags.filter((t) =>
        foodTags.includes(t),
      );
      if (hitTags.length > 0) {
        filterReasons.push(`含有限制标签: ${hitTags.join('、')}`);
      }
    }

    // 2f. 短期拒绝历史
    const shortTermProfile =
      await this.realtimeProfile.getShortTermProfile(userId);
    const recallConfig = (await this.resolveStrategyForUser(userId, goalType))
      ?.config?.recall;
    const rejectThreshold = recallConfig?.shortTermRejectThreshold ?? 2;
    const rejectCount = shortTermProfile?.rejectedFoods?.[food.name] || 0;
    if (rejectCount >= rejectThreshold) {
      filterReasons.push(
        `你近 7 天内已拒绝该食物 ${rejectCount} 次，系统暂时将其排除`,
      );
    }

    // 3. 跑评分流程（即使被硬过滤也跑分，用于分析弱维度）
    const resolvedStrategy = await this.resolveStrategyForUser(
      userId,
      goalType,
    );
    const penaltyCtx: HealthModifierContext = {
      allergens: userProfile?.allergens,
      healthConditions: userProfile?.healthConditions,
      goalType,
    };

    const detailed = this.foodScorer.scoreFoodDetailed(
      food,
      goalType,
      target,
      penaltyCtx,
      mealType,
      undefined,
      undefined,
      undefined,
      resolvedStrategy?.config?.rank,
    );

    const scored: ScoredFood = {
      food,
      score: detailed.score,
      ...this.foodScorer.calcServingNutrition(food),
      explanation: detailed.explanation,
    };

    // 4. 生成反向解释文案
    const reason = this.explanationGenerator.explainWhyNot(
      food,
      scored,
      filterReasons,
      userProfile,
      goalType,
    );

    // 5. 查找替代推荐 — 同餐次 Top-5（排除该食物本身）
    const alternativeFoods = this.foodScorer
      .scoreFoodsWithServing(
        allFoods.filter((f) => f.id !== food!.id),
        goalType,
        target,
        penaltyCtx,
        mealType,
        undefined,
        undefined,
        undefined,
        resolvedStrategy?.config?.rank,
      )
      .slice(0, 5);

    return {
      foodName: food.name,
      found: true,
      score: Math.round(detailed.score * 100) / 100,
      reason,
      alternatives: alternativeFoods.map((sf) => ({
        foodId: sf.food.id,
        name: sf.food.name,
        category: sf.food.category,
        score: Math.round(sf.score * 100) / 100,
        servingCalories: sf.servingCalories,
        servingProtein: sf.servingProtein,
      })),
    };
  }

  // ─── 数据访问 ───

  /**
   * V6 2.2: 安全地解析用户策略
   * V6 2.4: 策略 ↔ A/B 实验打通 — 解析策略后叠加实验配置层
   *
   * 最终优先级（从低到高）:
   *   1. 系统硬编码默认值
   *   2. 全局默认策略
   *   3. 目标类型策略
   *   4. A/B 实验组策略 ← 2.4 新增
   *   5. 用户级手动分配策略
   *
   * 策略解析失败不应阻断推荐流程，返回 null 回退到系统默认
   */
  private async resolveStrategyForUser(
    userId: string,
    goalType: string,
  ): Promise<ResolvedStrategy | null> {
    try {
      // 1. 从 StrategyResolver 获取基础策略（已合并 global → goal_type → user）
      let resolved = await this.strategyResolver.resolve(userId, goalType);

      // 2. V6 2.4: 叠加 A/B 实验策略层
      // 实验优先级高于 goal_type 策略，但低于 user 手动分配
      // 注意: StrategyResolver 的 user assignment 已在 resolved 中，
      // 这里的实验策略作为额外层叠加，user assignment 仍然最高
      try {
        const experimentResult =
          await this.abTestingService.resolveExperimentStrategy(
            userId,
            goalType,
          );
        if (experimentResult) {
          const source = `experiment:${experimentResult.experimentId}/${experimentResult.groupName}`;
          resolved = this.strategyResolver.mergeConfigOverride(
            resolved,
            experimentResult.config,
            source,
          );
          this.logger.debug(
            `用户 ${userId} 命中实验 ${experimentResult.experimentId}, 组=${experimentResult.groupName}`,
          );
        }
      } catch (expErr) {
        // 实验层失败不影响基础策略
        this.logger.warn(`A/B 实验策略解析失败 (user=${userId}): ${expErr}`);
      }

      return resolved;
    } catch (err) {
      this.logger.warn(
        `策略解析失败 (user=${userId}, goal=${goalType}), 回退到系统默认: ${err}`,
      );
      return null;
    }
  }

  async getAllFoods(): Promise<FoodLibrary[]> {
    const foods = await this.foodPoolCache.getVerifiedFoods();
    // V5 2.7: 同步品类微量营养素均值到评分服务（用于缺失值插补）
    this.foodScorer.setCategoryMicroDefaults(
      this.foodPoolCache.getCategoryMicroAverages(),
    );
    return foods;
  }

  /**
   * V5 4.7: 获取指定 goalType 的在线学习权重
   * 返回 null 表示没有学习数据，使用默认基线权重
   */
  async getLearnedWeights(goalType: string): Promise<number[] | null> {
    return this.weightLearner.getLearnedWeights(goalType as GoalType);
  }

  /**
   * 获取指定地区的食物评分偏移映射
   * @deprecated 使用 PreferenceProfileService.getRegionalBoostMap() 替代
   */
  async getRegionalBoostMap(region: string): Promise<Record<string, number>> {
    return this.preferenceProfileService.getRegionalBoostMap(region);
  }

  /**
   * 获取用户对每个食物的反馈统计 — 用于 Thompson Sampling
   * @deprecated 使用 RecommendationFeedbackService.getUserFeedbackStats() 替代
   */
  async getUserFeedbackStats(
    userId: string,
  ): Promise<Record<string, FoodFeedbackStats>> {
    return this.feedbackService.getUserFeedbackStats(userId);
  }

  /**
   * 构建用户偏好画像
   * @deprecated 使用 PreferenceProfileService.getUserPreferenceProfile() 替代
   */
  async getUserPreferenceProfile(
    userId: string,
  ): Promise<UserPreferenceProfile> {
    return this.preferenceProfileService.getUserPreferenceProfile(userId);
  }

  /**
   * 获取用户近期食物名
   * @deprecated 使用 PreferenceProfileService.getRecentFoodNames() 替代
   */
  async getRecentFoodNames(userId: string, days: number): Promise<string[]> {
    return this.preferenceProfileService.getRecentFoodNames(userId, days);
  }

  /**
   * V6.1 Phase 3.5: 直接从 Redis 读取分析画像
   *
   * 设计决策：不注入 AnalysisEventListener（food 模块），避免 DietModule ↔ FoodModule 循环依赖。
   * 而是直接通过 RedisCacheService 读取相同的 Redis key（analysis_profile:{userId}）。
   * key 格式与 AnalysisEventListener.buildKey() 保持一致。
   */
  private async getAnalysisProfile(
    userId: string,
  ): Promise<AnalysisShortTermProfile | null> {
    try {
      const key = this.redis.buildKey('analysis_profile', userId);
      return await this.redis.get<AnalysisShortTermProfile>(key);
    } catch (err) {
      this.logger.warn(
        `分析画像读取失败 (user=${userId}), 跳过分析联动: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ─── 食物替代建议 ───

  /**
   * 为指定食物查找替代候选
   * @deprecated 使用 SubstitutionService.findSubstitutes() 替代
   */
  async findSubstitutes(
    foodId: string,
    userId: string,
    mealType?: string,
    topK = 5,
    excludeNames: string[] = [],
    userConstraints?: UserProfileConstraints,
    preferenceProfile?: UserPreferenceProfile,
  ): Promise<SubstituteCandidate[]> {
    return this.substitutionService.findSubstitutes(
      foodId,
      userId,
      mealType,
      topK,
      excludeNames,
      userConstraints,
      preferenceProfile,
    );
  }

  // ─── 反馈写入 ───

  /**
   * 提交推荐反馈
   * @deprecated 使用 RecommendationFeedbackService.submitFeedback() 替代
   */
  async submitFeedback(params: {
    userId: string;
    mealType: string;
    foodName: string;
    foodId?: string;
    action: 'accepted' | 'replaced' | 'skipped';
    replacementFood?: string;
    recommendationScore?: number;
    goalType?: string;
    experimentId?: string;
    groupId?: string;
    /** V6 2.19: 多维评分 */
    ratings?: {
      taste?: number;
      portion?: number;
      price?: number;
      timing?: number;
      comment?: string;
    };
    /** V6 2.19: 隐式行为信号 */
    implicitSignals?: { dwellTimeMs?: number; detailExpanded?: boolean };
  }): Promise<void> {
    return this.feedbackService.submitFeedback(params);
  }
}
