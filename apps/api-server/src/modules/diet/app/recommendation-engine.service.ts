import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FoodLibrary } from '../../food/food.types';
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
  MealFromPoolRequest,
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
import {
  ContextualProfile,
  ContextualProfileService,
} from '../../user/app/contextual-profile.service';
import { StrategyResolver } from '../../strategy/app/strategy-resolver.service';
import { ResolvedStrategy } from '../../strategy/strategy.types';
import { ABTestingService } from './recommendation/ab-testing.service';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../core/cache/tiered-cache-manager';
import { AnalysisShortTermProfile } from '../../food/app/analysis-event.listener';
import { ProfileResolverService } from '../../user/app/profile-resolver.service';
import { RecipeService } from '../../recipe/app/recipe.service';
import { ScoredRecipe } from '../../recipe/recipe.types';
import {
  EnrichedProfileContext,
  AcquisitionChannel,
  inferAcquisitionChannel,
  SceneContext,
} from './recommendation/recommendation.types';
import {
  MealCompositionScorer,
  MealCompositionScore,
} from './recommendation/meal-composition-scorer.service';
import { ReplacementFeedbackInjectorService } from './recommendation/replacement-feedback-injector.service';
import { UserProfileService } from '../../user/app/user-profile.service';
import { RealisticFilterService } from './recommendation/realistic-filter.service';
import { LearnedRankingService } from './recommendation/learned-ranking.service';
import { FoodI18nService } from './food-i18n.service';
import { RequestContextService } from '../../../core/context/request-context.service';
import { ScoringConfigService } from './recommendation/scoring-config.service';
import { PipelineBuilderService } from './recommendation/pipeline-builder.service';
import { SceneResolverService } from './recommendation/scene-resolver.service';
import { RecipeAssemblerService } from './recommendation/recipe-assembler.service';
import { GoalPhaseService } from '../../user/app/goal-phase.service';
import { GoalTrackerService } from '../../user/app/goal-tracker.service';
import type { EnrichedProfileWithDomain } from '../../user/app/profile-resolver.service';
import { DailyPlanContextService } from './recommendation/daily-plan-context.service';
import { ExecutionTrackerService } from './recommendation/execution-tracker.service';
import { InsightGeneratorService } from './recommendation/insight-generator.service';
import type { InsightContext } from './recommendation/insight.types';
import type { KitchenProfile } from '../../user/user.types';
// V7.3 P3-D: 模板集成
import { MealTemplateService } from './recommendation/meal-template.service';
// V7.3 P3-E: Factor学习集成
import { FactorLearnerService } from './recommendation/factor-learner.service';

// 向后兼容：re-export SubstituteCandidate 和所有类型
export type { SubstituteCandidate } from './recommendation/substitution.service';
export type {
  MealTarget,
  Constraint,
  ScoredFood,
  MealRecommendation,
  MealFromPoolRequest,
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

@Injectable()
export class RecommendationEngineService implements OnModuleInit {
  private readonly logger = new Logger(RecommendationEngineService.name);

  /** V6.2 3.9: 分析画像 TieredCache namespace（与 AnalysisEventListener 共享 key 空间） */
  private analysisProfileCache!: TieredCacheNamespace<AnalysisShortTermProfile>;

  constructor(
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
    /** V6.2 3.9: TieredCacheManager — 创建分析画像共享 namespace，替代直接 Redis 读取 */
    private readonly cacheManager: TieredCacheManager,
    /** V6.2 Phase 2.12: 上下文画像服务 — 场景检测 */
    private readonly contextualProfileService: ContextualProfileService,
    /** V6.3 P1-1: 统一画像聚合 — 替代手动拼装 declared/observed/inferred/shortTerm/contextual */
    private readonly profileResolver: ProfileResolverService,
    /** V6.3 P2-8: 菜谱服务 — 用于菜谱模式组装 */
    private readonly recipeService: RecipeService,
    /** V6.5 Phase 2C/2D: 整餐组合评分器 */
    private readonly mealCompositionScorer: MealCompositionScorer,
    /** V6.5 Phase 3F: 用户画像服务（获取推荐偏好） */
    private readonly userProfileService: UserProfileService,
    /** V6.5 Phase 3G: 现实性过滤服务（场景动态 realism + 候选过滤） */
    private readonly realisticFilterService: RealisticFilterService,
    /** V6.6 Phase 2-B: 替换反馈权重注入服务 */
    private readonly replacementFeedbackInjector: ReplacementFeedbackInjectorService,
    /** V6.6 Phase 3-A: per-segment 学习权重优化服务 */
    private readonly learnedRankingService: LearnedRankingService,
    /** V6.6 Phase 3-B: 推荐结果多语言服务 */
    private readonly foodI18nService: FoodI18nService,
    /** V6.6 Phase 3-B: 请求上下文（读取 locale） */
    private readonly requestCtx: RequestContextService,
    private readonly scoringConfigService: ScoringConfigService,
    /** V6.7 Phase 3-D: 推荐管道核心（Recall → Rank → Rerank） */
    private readonly pipelineBuilder: PipelineBuilderService,
    /** V6.9 Phase 1-E: 场景解析器（替代 inferAcquisitionChannel） */
    private readonly sceneResolver: SceneResolverService,
    /** V6.9 Phase 1-E: 菜谱组装器（管道后组装菜谱方案） */
    private readonly recipeAssembler: RecipeAssemblerService,
    /** V7.0 Phase 3-A: 分阶段目标管理（获取 EffectiveGoal） */
    private readonly goalPhaseService: GoalPhaseService,
    /** V7.0 Phase 3-A: 目标进度追踪（获取 GoalProgress） */
    private readonly goalTrackerService: GoalTrackerService,
    /** V7.1 P3-A: 日计划上下文服务（跨餐补偿计算） */
    private readonly dailyPlanContextService: DailyPlanContextService,
    /** V7.1 P3-D: 执行追踪服务（获取高频替换模式） */
    private readonly executionTrackerService: ExecutionTrackerService,
    /** V7.2 P3-C: 结构化洞察生成器（替代 ExplanationGenerator.generateStructuredInsights 的 9 参数调用） */
    private readonly insightGenerator: InsightGeneratorService,
    /** V7.3 P3-D: 餐食模板服务（场景模板匹配 + 槽位填充） */
    private readonly mealTemplateService: MealTemplateService,
    /** V7.3 P3-E: Factor 权重学习服务（用户反馈驱动的因子强度调整） */
    private readonly factorLearnerService: FactorLearnerService,
  ) {}

  onModuleInit(): void {
    // 与 AnalysisEventListener 使用同名 namespace —— TieredCacheManager.createNamespace 是幂等的，
    // 同名会返回同一个实例，所以两边共享同一个 L1/L2 缓存。
    this.analysisProfileCache =
      this.cacheManager.createNamespace<AnalysisShortTermProfile>({
        namespace: 'analysis_profile',
        l1MaxEntries: 500,
        l1TtlMs: 5 * 60 * 1000,
        l2TtlMs: 7 * 24 * 60 * 60 * 1000,
      });
  }

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
    // V6.3 P1-1: 通过 ProfileResolverService 统一聚合五层画像，
    // 替代原来手动调用 realtimeProfile.getShortTermProfile() + contextualProfileService.detectScene()
    const [
      allFoods,
      recentFoodNames,
      feedbackStats,
      preferenceProfile,
      enrichedProfile,
      // V6 2.2: 并行解析策略
      resolvedStrategy,
      // V6.1 Phase 3.5: 并行获取分析画像
      analysisProfile,
      // V7.0 Phase 3-A: 并行获取有效目标 + 目标进度
      effectiveGoal,
      goalProgress,
      // V7.1 P3-B: 并行获取厨房设备画像
      kitchenProfile,
      // V7.1 P3-D: 并行获取高频替换模式
      substitutions,
    ] = await Promise.all([
      this.getAllFoods(),
      this.getRecentFoodNames(userId, 3),
      this.getUserFeedbackStats(userId),
      this.getUserPreferenceProfile(userId),
      // V7.0 Phase 3-A: 升级为 resolveWithDomainProfiles，附加强类型领域画像
      this.profileResolver.resolveWithDomainProfiles(userId, mealType),
      // V6 2.2: 并行解析用户策略
      this.resolveStrategyForUser(userId, goalType),
      // V6.1 Phase 3.5: 直接读 Redis（避免 FoodModule 循环依赖）
      this.getAnalysisProfile(userId),
      // V7.0 Phase 3-A: 获取分阶段目标（含 CompoundGoal 解析 + 权重调整）
      this.goalPhaseService.getCurrentGoal(userId),
      // V7.0 Phase 3-A: 获取目标进度（14天合规率 + 执行率 + 连续天数）
      this.goalTrackerService.getProgress(userId),
      // V7.1 P3-B: 厨房设备画像（用于 HOME_COOK 场景设备过滤）
      this.userProfileService.getKitchenProfile(userId),
      // V7.1 P3-D: 高频替换模式（供 PreferenceSignal 计算替换 boost）
      this.executionTrackerService.getTopSubstitutions(userId),
    ]);

    // V6.3 P1-1: 使用 EnrichedProfileContext 作为 userProfile（向后兼容，因为 extends UserProfileConstraints）
    // 如果调用方传入了 userProfile，将其非空字段合并到 enrichedProfile 上（调用方覆盖优先）
    const mergedProfile: EnrichedProfileContext = userProfile
      ? { ...enrichedProfile, ...this.pickDefinedFields(userProfile) }
      : enrichedProfile;

    // V6.3 P1-1: shortTerm 和 contextual 直接从 enrichedProfile 中获取
    const shortTermProfile = enrichedProfile.shortTerm;
    const contextualProfile = enrichedProfile.contextual;

    // V6.6 Phase 3-A: 获取 per-segment 学习权重（feature flag 控制，失败不阻断推荐）
    const userSegment = enrichedProfile.inferred?.userSegment;
    let learnedWeightOverrides: number[] | null = null;
    try {
      learnedWeightOverrides =
        await this.learnedRankingService.getLearnedWeights(userSegment, userId);
    } catch (err) {
      this.logger.debug(
        `LearnedRankingService.getLearnedWeights failed (user=${userId}): ${(err as Error).message}`,
      );
    }

    const regionalBoostMap = await this.getRegionalBoostMap(
      mergedProfile.regionCode || 'CN',
    );

    // V6.3 P2-8: 菜谱优先模式 — 当策略配置 assembly.preferRecipe=true 时
    // 提前异步获取评分菜谱候选
    let scoredRecipes: ScoredRecipe[] | null = null;
    const assemblyPolicy = resolvedStrategy?.config?.assembly;
    if (assemblyPolicy?.preferRecipe) {
      try {
        const recipeDetails = await this.recipeService.findActiveByFilters({
          cuisine: mergedProfile.cuisinePreferences?.[0],
          maxDifficulty: this.cookingSkillToMaxDifficulty(
            mergedProfile.cookingSkillLevel,
          ),
          limit: 20,
        });

        if (recipeDetails.length > 0) {
          scoredRecipes = this.recipeService.scoreAndRankRecipes(
            recipeDetails,
            {
              targetCalories: dailyTarget.calories,
              targetProtein: dailyTarget.protein,
              cuisinePreferences: mergedProfile.cuisinePreferences,
              foodPreferences:
                enrichedProfile.declared?.foodPreferences ?? undefined,
              cookingSkillLevel: mergedProfile.cookingSkillLevel,
              // V6.5 Phase 1K: 传入日期类型，支持烹饪时间维度评分
              dayType:
                (contextualProfile?.dayType as 'weekday' | 'weekend') ??
                undefined,
            },
            10,
          );
        }
      } catch (err) {
        this.logger.warn(
          `菜谱候选获取失败，降级到食物模式: ${(err as Error).message}`,
        );
      }
    }

    // V6.9 Phase 1-E: 场景解析 — 替代 inferAcquisitionChannel，提供完整场景上下文
    let sceneContext: SceneContext;
    try {
      sceneContext = await this.sceneResolver.resolve(
        userId,
        mealType,
        undefined, // 无显式渠道指定
        undefined, // 无显式 realism 指定
        contextualProfile
          ? {
              scene: contextualProfile.scene,
              dayType: contextualProfile.dayType,
            }
          : null,
        enrichedProfile.declared
          ? {
              canCook: enrichedProfile.declared.canCook,
              takeoutFrequency: enrichedProfile.declared.takeoutFrequency,
              primaryEatingLocation: null, // 当前 declared 画像中暂无此字段
            }
          : null,
        // V7.1 P3-B: 厨房设备画像（HOME_COOK 场景下注入设备约束）
        kitchenProfile ?? null,
      );
    } catch (err) {
      this.logger.warn(
        `SceneResolver.resolve failed, fallback to inferAcquisitionChannel: ${(err as Error).message}`,
      );
      // 降级：使用旧版 inferAcquisitionChannel
      const fallbackChannel = inferAcquisitionChannel(
        undefined,
        contextualProfile
          ? {
              scene: contextualProfile.scene,
              dayType: contextualProfile.dayType,
            }
          : null,
        enrichedProfile.declared
          ? {
              canCook: enrichedProfile.declared.canCook,
              takeoutFrequency: enrichedProfile.declared.takeoutFrequency,
            }
          : null,
        mealType,
      );
      sceneContext = {
        channel: fallbackChannel,
        sceneType: 'general',
        realismLevel: 'normal',
        confidence: 0.3,
        source: 'rule_inferred',
        sceneConstraints: {},
      };
    }

    const result = await this.recommendMealFromPool({
      allFoods,
      mealType,
      goalType,
      consumed,
      target,
      dailyTarget,
      excludeNames: recentFoodNames,
      feedbackStats,
      userProfile: mergedProfile,
      preferenceProfile,
      regionalBoostMap,
      shortTermProfile,
      resolvedStrategy,
      contextualProfile,
      analysisProfile,
      scoredRecipes, // V6.3 P2-8: 菜谱候选
      // V6.9 Phase 1-E: 使用 SceneResolver 解析的渠道
      channel: sceneContext.channel,
      userId, // V6.5 Phase 3D
      weightOverrides: learnedWeightOverrides, // V6.6 Phase 3-A: per-segment 学习权重
      sceneContext, // V6.9 Phase 1-E: 完整场景上下文
      effectiveGoal, // V7.0 Phase 3-A: 有效目标
      goalProgress, // V7.0 Phase 3-A: 目标进度
      domainProfiles: (enrichedProfile as EnrichedProfileWithDomain)
        .domainProfiles, // V7.0 Phase 3-A: 领域画像
      kitchenProfile: kitchenProfile ?? null, // V7.1 P3-B: 厨房设备画像
      substitutions, // V7.1 P3-D: 高频替换模式
    });

    // V6.9 Phase 2-E: 推荐成功后回写渠道使用行为（fire-and-forget，不阻塞返回）
    if (userId && sceneContext.channel) {
      this.sceneResolver
        .recordChannelUsage(userId, mealType, sceneContext.channel)
        .catch((err) =>
          this.logger.warn(
            `SceneResolver.recordChannelUsage failed: ${(err as Error).message}`,
          ),
        );
    }

    // V6.6 Phase 3-B: 多语言食物名覆盖（非 zh 时从 food_translations 读取）
    const locale = this.requestCtx.locale;
    return this.foodI18nService.applyToMealRecommendation(result, locale);
  }

  /**
   * V6.3 P1-1: 从 UserProfileConstraints 中提取已定义（非 undefined）的字段
   * 用于调用方传入的 userProfile 覆盖 enrichedProfile 的基础约束字段
   */
  private pickDefinedFields(
    source: UserProfileConstraints,
  ): Partial<UserProfileConstraints> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result as Partial<UserProfileConstraints>;
  }

  /**
   * V6.3 P2-8: 烹饪技能等级 → 最大菜谱难度
   */
  private cookingSkillToMaxDifficulty(skill?: string): number {
    const map: Record<string, number> = {
      beginner: 2,
      basic: 3,
      intermediate: 4,
      advanced: 5,
      expert: 5,
    };
    return map[skill ?? 'basic'] ?? 3;
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
    // V6.3 P1-1: 通过 ProfileResolverService 聚合五层画像
    const [allFoods, recentFoodNames, enrichedProfile] = await Promise.all([
      this.getAllFoods(),
      this.getRecentFoodNames(userId, 3),
      this.profileResolver.resolve(userId, mealType),
    ]);

    // V6.3 P1-1: 合并调用方传入的 userProfile 覆盖
    const mergedProfile: EnrichedProfileContext = userProfile
      ? { ...enrichedProfile, ...this.pickDefinedFields(userProfile) }
      : enrichedProfile;

    const baseConstraints = this.constraintGenerator.generateConstraints(
      goalType,
      consumed,
      target,
      dailyTarget,
      mealType,
      mergedProfile,
      mergedProfile.timezone,
      // V6.3 P1-3: 暴食风险时段
      mergedProfile.observed?.bingeRiskHours,
    );

    // V6.3 P1-1: 使用合并后的画像获取过敏原
    const userAllergens = mergedProfile.allergens;

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
      const nutritionTargets = this.pipelineBuilder.buildNutritionTargets(
        userProfile as EnrichedProfileContext | undefined,
      );
      const scored = this.foodScorer
        .scoreFoodsWithServing(
          candidates,
          goalType,
          target,
          { allergens: userAllergens, goalType },
          mealType,
          undefined,
          undefined,
          undefined,
          undefined,
          nutritionTargets,
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
        goalType,
        userProfile,
      );
    };

    return {
      takeout: buildForScenario('takeout'),
      convenience: buildForScenario('convenience'),
      homeCook: buildForScenario('homeCook'),
    };
  }

  // ─── 从食物池推荐（三阶段 Pipeline: Recall → Rank → Rerank） ───

  /**
   * V6.2 Phase 3.1: 参数对象化 — 单一 MealFromPoolRequest 替代 19 个位置参数
   * V6.4: 改为 async 以支持 L2 缓存预热
   */
  async recommendMealFromPool(
    req: MealFromPoolRequest,
  ): Promise<MealRecommendation> {
    const {
      allFoods,
      mealType,
      goalType,
      consumed,
      target,
      dailyTarget,
      excludeNames,
      userPreferences,
      feedbackStats,
      userProfile,
      preferenceProfile,
      regionalBoostMap,
      cfScores,
      weightOverrides,
      mealWeightOverrides,
      shortTermProfile,
      resolvedStrategy,
      contextualProfile,
      analysisProfile,
      channel, // V6.4 Phase 3.3
      userId, // V6.5 Phase 3D
      sceneContext, // V6.9 Phase 1-E
      effectiveGoal, // V7.0 Phase 3-A
      goalProgress, // V7.0 Phase 3-A
      domainProfiles, // V7.0 Phase 3-A
      crossMealAdjustment: reqCrossMealAdjustment, // V7.1 P3-A
      kitchenProfile, // V7.1 P3-B
      substitutions, // V7.1 P3-D
    } = req;
    const scoredRecipes = req.scoredRecipes;
    const constraints = this.constraintGenerator.generateConstraints(
      goalType,
      consumed,
      target,
      dailyTarget,
      mealType,
      userProfile,
      userProfile?.timezone,
      // V6.3 P1-3: 从 EnrichedProfileContext 提取暴食风险时段
      (userProfile as EnrichedProfileContext | undefined)?.observed
        ?.bingeRiskHours,
    );

    // V6 2.3: MealPolicy 覆盖餐次角色模板
    const mealPolicy = resolvedStrategy?.config?.meal;
    const roles = mealPolicy?.mealRoles?.[mealType] ??
      MEAL_ROLES[mealType] ?? ['carb', 'protein', 'veggie'];
    const picks: ScoredFood[] = [];
    const usedNames = new Set(excludeNames);

    // V7.1 P3-A: 跨餐营养补偿 — 如果上游未传入 crossMealAdjustment，
    // 且有 dailyPlanState（日计划上下文），则实时计算
    let crossMealAdjustment = reqCrossMealAdjustment;
    if (!crossMealAdjustment && req.dailyPlanState) {
      try {
        const mealIndex = req.dailyPlanState.mealCount; // mealCount = 已完成餐数 = 当前餐次 index (0-based)
        crossMealAdjustment =
          this.dailyPlanContextService.computeCrossMealAdjustment(
            req.dailyPlanState,
            mealIndex,
            dailyTarget,
          );
      } catch (err) {
        this.logger.debug(
          `computeCrossMealAdjustment failed for user ${userId ?? 'anonymous'}: ${(err as Error).message}`,
        );
        // 计算失败不影响推荐，crossMealAdjustment 保持 undefined
      }
    }

    // ─── V6.3 P2-8: 菜谱优先组装模式 ───
    // 当策略配置 assembly.preferRecipe=true 且有评分菜谱候选时，
    // 先尝试菜谱组装路径。成功则直接返回，失败则降级到原有食物组合模式。
    const assemblyPolicy = resolvedStrategy?.config?.assembly;
    if (
      assemblyPolicy?.preferRecipe &&
      scoredRecipes &&
      scoredRecipes.length > 0
    ) {
      // 先完成一轮角色召回+评分，获取食物候选池（用于菜谱缺口补充）
      const ctx: PipelineContext = {
        allFoods,
        mealType,
        goalType,
        target,
        constraints,
        usedNames,
        picks: [],
        userId, // V6.5 Phase 3D
        userPreferences,
        feedbackStats,
        userProfile,
        preferenceProfile,
        regionalBoostMap,
        cfScores,
        weightOverrides,
        mealWeightOverrides,
        shortTermProfile,
        resolvedStrategy,
        contextualProfile,
        analysisProfile,
        channel, // V6.4 Phase 3.3
        sceneContext, // V6.9 Phase 1-E
        effectiveGoal, // V7.0 Phase 3-A: 有效目标
        goalProgress, // V7.0 Phase 3-A: 目标进度
        domainProfiles, // V7.0 Phase 3-A: 领域画像
        crossMealAdjustment, // V7.1 P3-A: 跨餐营养补偿
        kitchenProfile, // V7.1 P3-B: 厨房设备画像
        substitutions, // V7.1 P3-D: 高频替换模式
        realismOverride: req.realismOverride, // V7.2 P3-B: 用户端现实策略覆盖
      };

      // V6.5 Phase 3G: 菜谱模式也应用场景动态 realism
      const recipeDayType = contextualProfile?.dayType as string | undefined;
      const recipeRealism = this.realisticFilterService.adjustForScene(
        resolvedStrategy?.config?.realism,
        mealType,
        recipeDayType,
      );

      // 快速召回+评分一批食物候选（不做最终选择），供菜谱缺口补充
      const supplementCandidates: ScoredFood[] = [];
      for (const role of roles) {
        try {
          const recalled = await this.pipelineBuilder.recallCandidates(
            ctx,
            role,
          );
          // V6.5 Phase 3G: 现实性过滤
          // V7.1 P3-B: 传入 kitchenProfile 用于设备约束过滤
          const realistic = this.realisticFilterService.filterByRealism(
            recalled,
            ctx,
            recipeRealism,
            kitchenProfile ?? undefined,
          );
          const ranked = await this.pipelineBuilder.rankCandidates(
            ctx,
            realistic,
          );
          supplementCandidates.push(...ranked.slice(0, 5));
        } catch (e) {
          // V6.8 Phase 3-F: 菜谱补充召回失败，跳过该角色
          this.logger.warn(
            `Recipe supplement recall/rank failed for role "${role}", skipping: ${e}`,
          );
        }
      }

      const recipePicks = this.mealAssembler.assembleMealWithRecipes(
        scoredRecipes,
        supplementCandidates,
        target,
        assemblyPolicy,
        userProfile?.portionTendency,
      );

      if (recipePicks && recipePicks.length > 0) {
        const tip = this.mealAssembler.buildTip(
          mealType,
          goalType,
          target,
          recipePicks.reduce((s, p) => s + p.servingCalories, 0),
        );
        const result = this.mealAssembler.aggregateMealResult(
          recipePicks,
          tip,
          goalType,
          userProfile,
        );
        result.candidates = supplementCandidates;
        return result;
      }
      // 菜谱组装失败，降级到原有模式
    }

    // 构建 Pipeline 共享上下文
    // V6.6 Phase 2-B: 预取替换反馈权重 Map（一次 DB 查询，在角色循环外执行）
    // V6.7 Phase 2-E: 传入 mealType 实现餐次感知替换反馈
    const replacementWeightMap = userId
      ? await this.replacementFeedbackInjector.getWeightMap(userId, mealType)
      : null;

    const ctx: PipelineContext = {
      allFoods,
      mealType,
      goalType,
      target,
      constraints,
      usedNames,
      picks,
      userId, // V6.5 Phase 3D
      replacementWeightMap, // V6.6 Phase 2-B: 替换反馈权重
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
      channel, // V6.4 Phase 3.3: 获取渠道
      sceneContext, // V6.9 Phase 1-E: 场景上下文
      effectiveGoal, // V7.0 Phase 3-A: 有效目标（含阶段 + 权重调整）
      goalProgress, // V7.0 Phase 3-A: 目标进度（合规率 + 执行率）
      domainProfiles, // V7.0 Phase 3-A: 领域画像
      crossMealAdjustment, // V7.1 P3-A: 跨餐营养补偿
      kitchenProfile, // V7.1 P3-B: 厨房设备画像
      substitutions, // V7.1 P3-D: 高频替换模式
      realismOverride: req.realismOverride, // V7.2 P3-B: 用户端现实策略覆盖
    };

    // V7.3 P3-D: 模板匹配 — 如果场景和餐次有对应模板，设置到上下文中
    const sceneType = sceneContext?.sceneType ?? 'general';
    const matchedTemplate = this.mealTemplateService.matchTemplate(
      sceneType,
      mealType,
    );
    if (matchedTemplate) {
      ctx.matchedTemplate = matchedTemplate;
      this.logger.debug(
        `Template matched: ${matchedTemplate.id} for scene=${sceneType}, meal=${mealType}`,
      );
    }

    // V7.3 P3-E: 加载用户 Factor 强度调整（冷启动用户返回空 Map，不影响评分）
    if (userId && goalType) {
      try {
        const factorAdjustments =
          await this.factorLearnerService.getUserFactorAdjustments(
            userId,
            goalType,
          );
        if (factorAdjustments.size > 0) {
          ctx.factorAdjustments = factorAdjustments;
          this.logger.debug(
            `FactorLearner adjustments loaded for user ${userId}: ${Array.from(
              factorAdjustments.entries(),
            )
              .map(([k, v]) => `${k}=${v.toFixed(3)}`)
              .join(', ')}`,
          );
        }
      } catch (err) {
        this.logger.debug(
          `FactorLearner.getUserFactorAdjustments failed for user ${userId}: ${(err as Error).message}`,
        );
        // 加载失败不影响推荐，factorAdjustments 保持 undefined
      }
    }

    // V6.5 Phase 3G: 场景动态 realism 调整
    // 在策略已合并用户偏好（Phase 3F）后，根据当前场景（工作日/周末 × 餐次）进一步收紧
    const dayType = contextualProfile?.dayType as string | undefined;
    const sceneAdjustedRealism = this.realisticFilterService.adjustForScene(
      resolvedStrategy?.config?.realism,
      mealType,
      dayType,
    );

    // V6.7 Phase 3-D: 委托 PipelineBuilder 执行角色循环管道
    const {
      picks: finalPicks,
      allCandidates,
      degradations,
    } = await this.pipelineBuilder.executeRolePipeline(
      ctx,
      roles,
      sceneAdjustedRealism,
    );

    // V6.8 Phase 3-F: 记录降级信息（如有）
    if (degradations.length > 0) {
      this.logger.warn(
        `Pipeline degradations for user ${userId ?? 'anonymous'}, meal ${mealType}: ` +
          degradations.map((d) => `${d.stage}(${d.fallbackUsed})`).join(', '),
      );
    }

    // V7.3 P3-D: 模板填充 — 如果匹配到模板且有足够候选，尝试用模板重新组织推荐结果
    let templateFilledPicks = finalPicks;
    let templateId: string | undefined;
    if (matchedTemplate && allCandidates.length > 0) {
      try {
        const templateResult = this.mealTemplateService.fillTemplate(
          matchedTemplate,
          allCandidates,
          target.calories,
        );
        // 使用模板填充结果替代角色管道的 picks（如果覆盖度 >= 0.5）
        if (
          templateResult.coverageScore >= 0.5 &&
          templateResult.filledSlots.length > 0
        ) {
          templateFilledPicks = templateResult.filledSlots.map(
            (slot) => slot.food,
          );
          templateId = templateResult.templateId;
          this.logger.debug(
            `Template ${templateResult.templateId} applied: ${templateResult.filledSlots.length} slots, ` +
              `coverage=${templateResult.coverageScore.toFixed(2)}, match=${templateResult.templateMatchScore.toFixed(2)}`,
          );
        }
      } catch (err) {
        this.logger.debug(
          `Template filling failed for ${matchedTemplate.id}, falling back to role pipeline: ${(err as Error).message}`,
        );
        // 模板填充失败，静默降级到角色管道结果
      }
    }

    const adjustedPicks = this.mealAssembler.adjustPortions(
      templateFilledPicks,
      target.calories,
      userProfile?.portionTendency, // V6.2 Phase 2.14: 份量倾向
    );
    const tip = this.mealAssembler.buildTip(
      mealType,
      goalType,
      target,
      adjustedPicks.reduce((s, p) => s + p.servingCalories, 0),
    );
    const result = this.mealAssembler.aggregateMealResult(
      adjustedPicks,
      tip,
      goalType,
      userProfile,
    );
    // V5 2.1: 附带候选池供全局优化器使用
    result.candidates = allCandidates;

    // V6.5 Phase 2D: 附带整餐组合评分（Rerank 后的最终评分）
    if (adjustedPicks.length >= 2) {
      result.compositionScore =
        this.mealCompositionScorer.scoreMealComposition(adjustedPicks);
    }

    // V6.8 Phase 3-F: 附带降级记录
    if (degradations.length > 0) {
      result.degradations = degradations;
    }

    // V7.3 P3-D: 附带模板 ID
    if (templateId) {
      result.templateId = templateId;
    }

    // V6.9 Phase 1-E: 菜谱组装 — 将推荐食物组装为可执行菜谱方案
    if (sceneContext) {
      try {
        const { recipes, planTheme, executionDifficulty } =
          await this.recipeAssembler.assembleRecipes(
            adjustedPicks,
            sceneContext,
            mealType,
          );
        if (recipes.length > 0) {
          result.recipes = recipes;
          result.planTheme = planTheme;
          result.executionDifficulty = executionDifficulty;
        }
      } catch (err) {
        this.logger.warn(
          `RecipeAssembler failed for user ${userId ?? 'anonymous'}, meal ${mealType}: ${(err as Error).message}`,
        );
        // 菜谱组装失败不影响推荐结果，静默降级
      }
    }

    // V6.9 Phase 2-B / V7.2 P3-C: 结构化洞察 — 使用 InsightGeneratorService + InsightContext 参数对象
    try {
      const insightCtx: InsightContext = {
        foods: adjustedPicks,
        target,
        sceneContext: sceneContext ?? null,
        dailyPlan: req.dailyPlanState ?? null,
        effectiveGoal,
        goalProgress: goalProgress ?? null,
        crossMealAdjustment,
        substitutions: substitutions ?? null,
      };
      const insights = this.insightGenerator.generate(insightCtx);
      if (insights.length > 0) {
        result.insights = insights;
      }
    } catch (err) {
      this.logger.debug(
        `InsightGenerator.generate failed for user ${userId ?? 'anonymous'}: ${(err as Error).message}`,
      );
      // 洞察生成失败不影响推荐结果
    }

    return result;
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
    const resolvedStrategy = await this.resolveStrategyForUser(
      userId,
      goalType,
    );
    const recallConfig = resolvedStrategy?.config?.recall;
    const rejectThreshold = recallConfig?.shortTermRejectThreshold ?? 2;
    const rejectCount = shortTermProfile?.rejectedFoods?.[food.name] || 0;
    if (rejectCount >= rejectThreshold) {
      filterReasons.push(
        `你近 7 天内已拒绝该食物 ${rejectCount} 次，系统暂时将其排除`,
      );
    }

    // 3. 跑评分流程（即使被硬过滤也跑分，用于分析弱维度）
    const penaltyCtx: HealthModifierContext = {
      allergens: userProfile?.allergens,
      healthConditions: userProfile?.healthConditions,
      goalType,
    };
    const nutritionTargets = this.pipelineBuilder.buildNutritionTargets(
      userProfile as EnrichedProfileContext | undefined,
    );

    // V6.7 Phase 1-B: 加载中心化评分参数
    const scoringConfig = await this.scoringConfigService.getConfig();

    const detailed = this.foodScorer.scoreFoodDetailed({
      food,
      goalType,
      target,
      penaltyContext: penaltyCtx,
      mealType,
      statusFlags: undefined,
      weightOverrides: undefined,
      mealWeightOverrides: undefined,
      rankPolicy: resolvedStrategy?.config?.rank,
      nutritionGaps: undefined,
      healthModifierCache: undefined,
      nutritionTargets,
      scoringConfig, // V6.7 Phase 1-B
    });

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
        nutritionTargets,
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

      // 3. V6.5 Phase 3F: 叠加用户推荐偏好覆盖（最高优先级 realism 层）
      // 用户在 App 中设置的大众化/烹饪投入/预算偏好 → 转换为 RealismConfig 覆盖
      // V7.2 P3-B: 新增 realismLevel 维度（strict/normal/relaxed/off）
      try {
        const recPrefs =
          await this.userProfileService.getRecommendationPreferences(userId);
        if (
          recPrefs.popularityPreference ||
          recPrefs.cookingEffort ||
          recPrefs.budgetSensitivity ||
          recPrefs.realismLevel
        ) {
          const realismOverride =
            UserProfileService.toRealismOverride(recPrefs);
          if (Object.keys(realismOverride).length > 0) {
            resolved = this.strategyResolver.mergeConfigOverride(
              resolved,
              { realism: realismOverride },
              'user_recommendation_preferences',
            );
            this.logger.debug(
              `用户 ${userId} 推荐偏好覆盖: ${JSON.stringify(realismOverride)}`,
            );
          }
        }
      } catch (prefErr) {
        // 偏好层失败不影响策略
        this.logger.warn(`用户推荐偏好加载失败 (user=${userId}): ${prefErr}`);
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
   * V6.1 Phase 3.5 → V6.2 3.9: 通过 TieredCache 共享 namespace 读取分析画像
   *
   * 设计决策：不注入 AnalysisEventListener（food 模块），避免 DietModule ↔ FoodModule 循环依赖。
   * 通过 TieredCacheManager.createNamespace 的幂等性，两边共享同一个 namespace 实例。
   */
  private async getAnalysisProfile(
    userId: string,
  ): Promise<AnalysisShortTermProfile | null> {
    try {
      return await this.analysisProfileCache.get(userId);
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
