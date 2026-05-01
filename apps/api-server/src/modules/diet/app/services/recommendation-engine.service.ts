import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';
import { ConstraintGeneratorService } from '../recommendation/pipeline/constraint-generator.service';
import { FoodScorerService } from '../recommendation/pipeline/food-scorer.service';
import { MealAssemblerService } from '../recommendation/meal/meal-assembler.service';
import {
  MealTarget,
  ScoredFood,
  MealRecommendation,
  UserProfileConstraints,
  PipelineContext,
  MEAL_ROLES,
  MUSCLE_GAIN_MEAL_ROLES,
  buildMealRoles,
  MealFromPoolRequest,
} from '../recommendation/types/recommendation.types';
import { HealthModifierContext } from '../recommendation/modifier/health-modifier-engine.service';
import { FoodPoolCacheService } from '../recommendation/pipeline/food-pool-cache.service';
import { matchAllergens } from '../recommendation/filter/allergen-filter.util';
import { ExplanationGeneratorService } from '../recommendation/explanation/explanation-generator.service';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../core/cache/tiered-cache-manager';
import { AnalysisShortTermProfile } from '../../../food/app/listeners/analysis-event.listener';
import { RecipeService } from '../../../recipe/app/recipe.service';
import { ScoredRecipe } from '../../../recipe/recipe.types';
import {
  EnrichedProfileContext,
  inferAcquisitionChannel,
  AcquisitionChannel,
  SceneContext,
  type SceneType,
} from '../recommendation/types/recommendation.types';

import { ReplacementFeedbackInjectorService } from '../recommendation/feedback/replacement-feedback-injector.service';
import { RealisticFilterService } from '../recommendation/filter/realistic-filter.service';
import { FoodI18nService } from './food-i18n.service';
import { RequestContextService } from '../../../../core/context/request-context.service';
import { ScoringConfigService } from '../recommendation/context/scoring-config.service';
import { PipelineBuilderService } from '../recommendation/pipeline/pipeline-builder.service';
import { SceneResolverService } from '../recommendation/context/scene-resolver.service';

import type { EnrichedProfileWithDomain } from '../../../user/app/services/profile/profile-resolver.service';
import { DailyPlanContextService } from '../recommendation/context/daily-plan-context.service';

import { MealTemplateService } from '../recommendation/meal/meal-template.service';
import { FactorLearnerService } from '../recommendation/optimization/factor-learner.service';
import { ProfileAggregatorService } from '../recommendation/profile/profile-aggregator.service';
import { StrategyResolverFacade } from '../recommendation/pipeline/strategy-resolver-facade.service';
import { RecommendationTraceService } from '../recommendation/tracing/recommendation-trace.service';
import { FeatureFlagService } from '../../../feature-flag/feature-flag.service';
import { v4 as uuidv4 } from 'uuid';
import { PipelineContextFactory } from '../recommendation/context/pipeline-context-factory.service';
import { RecommendationResultProcessor } from './recommendation-result-processor.service';
import { SeasonalityService } from '../recommendation/utils/seasonality.service';
import { DEFAULT_REGION_CODE } from '../../../../common/config/regional-defaults';
import { t, type Locale } from '../recommendation/utils/i18n-messages';

/** 反向解释 API 返回结构 */
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

  /** 分析画像 TieredCache namespace（与 AnalysisEventListener 共享 key 空间） */
  private analysisProfileCache!: TieredCacheNamespace<AnalysisShortTermProfile>;

  constructor(
    private readonly constraintGenerator: ConstraintGeneratorService,
    private readonly foodScorer: FoodScorerService,
    private readonly mealAssembler: MealAssemblerService,
    private readonly foodPoolCache: FoodPoolCacheService,
    /** 推荐解释生成器（反向解释 API） */
    private readonly explanationGenerator: ExplanationGeneratorService,
    /** TieredCacheManager — 创建分析画像共享 namespace */
    private readonly cacheManager: TieredCacheManager,
    /** 菜谱服务 — 用于菜谱模式组装 */
    private readonly recipeService: RecipeService,
    /** 现实性过滤服务（场景动态 realism + 候选过滤） */
    private readonly realisticFilterService: RealisticFilterService,
    /** 替换反馈权重注入服务 */
    private readonly replacementFeedbackInjector: ReplacementFeedbackInjectorService,
    /** 推荐结果多语言服务 */
    private readonly foodI18nService: FoodI18nService,
    /** 请求上下文（读取 locale） */
    private readonly requestCtx: RequestContextService,
    private readonly scoringConfigService: ScoringConfigService,
    /** 推荐管道核心（Recall → Rank → Rerank） */
    private readonly pipelineBuilder: PipelineBuilderService,
    /** 场景解析器 */
    private readonly sceneResolver: SceneResolverService,
    /** 日计划上下文服务（跨餐补偿计算） */
    private readonly dailyPlanContextService: DailyPlanContextService,
    /** 餐食模板服务（场景模板匹配 + 槽位填充） */
    private readonly mealTemplateService: MealTemplateService,
    /** Factor 权重学习服务（用户反馈驱动的因子强度调整） */
    private readonly factorLearnerService: FactorLearnerService,
    /** 画像聚合 Facade */
    private readonly profileAggregator: ProfileAggregatorService,
    /** 策略解析 Facade */
    private readonly strategyFacade: StrategyResolverFacade,
    /** 推荐 Trace 持久化服务 */
    private readonly traceService: RecommendationTraceService,
    /** Feature Flag 服务（控制 trace 开关） */
    private readonly featureFlagService: FeatureFlagService,
    /** PipelineContext 工厂（统一构建 PipelineContext） */
    private readonly contextFactory: PipelineContextFactory,
    /** 推荐结果后处理器（模板填充 + 份量调整 + 聚合 + 菜谱 + 洞察） */
    private readonly resultProcessor: RecommendationResultProcessor,
    /** 时令服务（区域+时区优化阶段 1.1b：每次推荐前预热区域时令缓存） */
    private readonly seasonalityService: SeasonalityService,
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

  private resolveLocale(locale?: string): Locale {
    if (locale === 'en-US' || locale === 'ja-JP' || locale === 'zh-CN') {
      return locale;
    }

    const requestLocale = this.requestCtx.locale;
    return requestLocale === 'en-US' ||
      requestLocale === 'ja-JP' ||
      requestLocale === 'zh-CN'
      ? requestLocale
      : 'zh-CN';
  }

  // ─── 核心推荐函数 ───

  async recommendMeal(
    userId: string,
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: MealTarget,
    userProfile?: UserProfileConstraints,
    additionalExcludeNames?: string[],
  ): Promise<MealRecommendation> {
    // 通过 ProfileAggregatorService 聚合全部画像数据
    const [allFoods, profileData, resolvedStrategy, analysisProfile] =
      await Promise.all([
        this.getAllFoods(),
        this.profileAggregator.aggregateForRecommendation(userId, mealType),
        this.strategyFacade.resolveStrategyForUser(userId, goalType),
        this.getAnalysisProfile(userId),
      ]);

    const {
      recentFoodNames,
      feedbackStats,
      preferenceProfile,
      enrichedProfile,
      effectiveGoal,
      goalProgress,
      kitchenProfile,
      substitutions,
      learnedWeightOverrides,
      regionalBoostMap,
    } = profileData;

    // shortTerm 和 contextual 直接从 enrichedProfile 中获取
    const shortTermProfile = enrichedProfile.shortTerm;
    const contextualProfile = enrichedProfile.contextual;

    // 使用 EnrichedProfileContext 作为 userProfile（向后兼容，因为 extends UserProfileConstraints）
    // 如果调用方传入了 userProfile，将其非空字段合并到 enrichedProfile 上（调用方覆盖优先）
    const mergedProfile: EnrichedProfileContext = userProfile
      ? { ...enrichedProfile, ...this.pickDefinedFields(userProfile) }
      : enrichedProfile;

    // 区域+时区优化（阶段 1.1b）：在评分前预热当前用户区域的 SeasonalityService 缓存。
    // 修复 "preloadRegion 生产从未被调用 → seasonalityScore 永远 0.5" 的 Bug。
    // 失败不阻塞推荐主流程（SeasonalityService 内部已有 try/catch）。
    void this.seasonalityService.preloadRegion(
      mergedProfile.regionCode || DEFAULT_REGION_CODE,
    );

    // 菜谱优先模式 — 当策略配置 assembly.preferRecipe=true 时
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
              // 传入日期类型，支持烹饪时间维度评分
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

    // 场景解析 — 提供完整场景上下文
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
        // 厨房设备画像（HOME_COOK 场景下注入设备约束）
        kitchenProfile ?? null,
        // 区域+时区优化 P0-1：透传用户时区，避免使用服务器时区
        enrichedProfile.declared?.timezone,
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
      // #fix Bug21-22: 合并近期食物名与额外排除名（跨餐去重）
      excludeNames: [...recentFoodNames, ...(additionalExcludeNames ?? [])],
      feedbackStats,
      userProfile: mergedProfile,
      preferenceProfile,
      regionalBoostMap,
      shortTermProfile,
      resolvedStrategy,
      contextualProfile,
      analysisProfile,
      scoredRecipes,
      channel: sceneContext.channel,
      userId,
      weightOverrides: learnedWeightOverrides,
      sceneContext,
      effectiveGoal,
      goalProgress,
      domainProfiles: enrichedProfile.domainProfiles,
      kitchenProfile: kitchenProfile ?? null,
      substitutions,
    });

    // 推荐成功后回写渠道使用行为（fire-and-forget，不阻塞返回）
    if (userId && sceneContext.channel) {
      this.sceneResolver
        .recordChannelUsage(
          userId,
          mealType,
          sceneContext.channel,
          // P0-1：用本地时区分桶
          enrichedProfile.declared?.timezone,
        )
        .catch((err) =>
          this.logger.warn(
            `SceneResolver.recordChannelUsage failed: ${(err as Error).message}`,
          ),
        );
    }

    // 多语言食物名覆盖（非 zh 时从 food_translations 读取）
    const locale = this.requestCtx.locale;
    return this.foodI18nService.applyToMealRecommendation(result, locale);
  }

  /**
   * 从 UserProfileConstraints 中提取已定义（非 undefined）的字段
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
   * 烹饪技能等级 → 最大菜谱难度
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
   * V8.0 P2-01: 改为通过标准管道（PipelineBuilder.executeRolePipeline）执行，
   * 每个场景构建独立的 PipelineContext（设置对应的 channel + sceneContext），
   * 依次调用管道后由 RecommendationResultProcessor 后处理结果。
   * 三个场景并行执行以保持性能，跨场景去重通过累积 usedNames 实现。
   *
   * 这样场景推荐自动享受全部管道能力：
   * - Factor 链评分（10 因子）
   * - 现实性过滤（RealisticFilter）
   * - Pipeline Trace 追踪
   * - 洞察生成（InsightGenerator）
   */
  async recommendByScenario(
    userId: string,
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: MealTarget,
    userProfile?: UserProfileConstraints,
  ): Promise<{
    takeout: MealRecommendation;
    convenience: MealRecommendation;
    homeCook: MealRecommendation;
  }> {
    // 聚合画像数据（与 recommendMeal 一致）
    const [allFoods, scenarioData, resolvedStrategy, analysisProfile] =
      await Promise.all([
        this.getAllFoods(),
        this.profileAggregator.aggregateForScenario(userId, mealType),
        this.strategyFacade.resolveStrategyForUser(userId, goalType),
        this.getAnalysisProfile(userId),
      ]);
    const { recentFoodNames, enrichedProfile } = scenarioData;

    // 合并调用方传入的 userProfile 覆盖
    const mergedProfile: EnrichedProfileContext = userProfile
      ? { ...enrichedProfile, ...this.pickDefinedFields(userProfile) }
      : enrichedProfile;

    // 区域+时区优化（阶段 1.1b）：预热区域时令缓存（同 recommendMeal）
    void this.seasonalityService.preloadRegion(
      mergedProfile.regionCode || DEFAULT_REGION_CODE,
    );

    const shortTermProfile = enrichedProfile.shortTerm;
    const contextualProfile = enrichedProfile.contextual;

    // 跨场景去重：外卖 → 便利店 → 在家做，累积已用食物名
    const usedAcrossScenarios = new Set<string>(recentFoodNames);

    // 场景配置：channel + sceneType + realismLevel
    const SCENARIO_CONFIGS: Array<{
      key: 'takeout' | 'convenience' | 'homeCook';
      channel: AcquisitionChannel;
      sceneType: SceneType;
      realismLevel: 'relaxed' | 'strict' | 'normal';
    }> = [
      {
        key: 'takeout',
        channel: AcquisitionChannel.DELIVERY,
        sceneType: 'eating_out',
        realismLevel: 'relaxed',
      },
      {
        key: 'convenience',
        channel: AcquisitionChannel.CONVENIENCE,
        sceneType: 'convenience_meal',
        realismLevel: 'strict',
      },
      {
        key: 'homeCook',
        channel: AcquisitionChannel.HOME_COOK,
        sceneType: 'home_cooking',
        realismLevel: 'normal',
      },
    ];

    // 串行执行三个场景，保证 usedAcrossScenarios 跨场景去重有效
    const results: Record<string, MealRecommendation> = {};

    for (const scenarioConfig of SCENARIO_CONFIGS) {
      const sceneContext: SceneContext = {
        channel: scenarioConfig.channel,
        sceneType: scenarioConfig.sceneType,
        realismLevel: scenarioConfig.realismLevel,
        confidence: 1.0,
        source: 'rule_inferred',
        sceneConstraints: {},
      };

      const picks: ScoredFood[] = [];
      const usedNames = new Set<string>(usedAcrossScenarios);

      const constraints = this.constraintGenerator.generateConstraints(
        goalType,
        consumed,
        target,
        dailyTarget,
        mealType,
        mergedProfile,
        mergedProfile.timezone,
        mergedProfile.observed?.bingeRiskHours,
      );

      const ctx = this.contextFactory.build(
        {
          allFoods,
          mealType,
          goalType,
          consumed,
          target,
          dailyTarget,
          excludeNames: Array.from(usedAcrossScenarios),
          userProfile: mergedProfile,
          shortTermProfile,
          contextualProfile,
          analysisProfile,
          resolvedStrategy,
          channel: scenarioConfig.channel,
          sceneContext,
          userId,
        } as MealFromPoolRequest,
        { constraints, picks, usedNames },
      );

      const sceneAdjustedRealism = this.realisticFilterService.adjustForScene(
        resolvedStrategy?.config?.realism,
        mealType,
        contextualProfile?.dayType as string | undefined,
      );

      const mealPolicy = resolvedStrategy?.config?.meal;
      // P0-A 根因#3 修复：按当餐蛋白目标动态构建 role 数组，突破 3 protein slot 天花板。
      // 原硬编码 MEAL_ROLES 每餐 1 个 protein slot，减脂 152g/日目标物理不可达（天花板 ~105g）。
      // 优先级：策略覆盖 > 动态派生 > 兜底增肌/普通模板
      const dynamicRoles = buildMealRoles(mealType, target.protein);
      const defaultRoles =
        goalType === 'muscle_gain'
          ? (MUSCLE_GAIN_MEAL_ROLES[mealType] ?? MEAL_ROLES[mealType])
          : MEAL_ROLES[mealType];
      const roles = mealPolicy?.mealRoles?.[mealType] ??
        dynamicRoles ??
        defaultRoles ?? ['carb', 'protein', 'veggie'];

      const {
        picks: finalPicks,
        allCandidates,
        degradations,
      } = await this.pipelineBuilder.executeRolePipeline(
        ctx,
        roles,
        sceneAdjustedRealism,
      );

      // 累积本场景选出的食物，让后续场景避开
      for (const p of finalPicks) {
        usedAcrossScenarios.add(p.food.name);
      }

      const result = await this.resultProcessor.process({
        finalPicks,
        allCandidates,
        degradations,
        mealType,
        goalType,
        target,
        userProfile: mergedProfile,
        sceneContext,
        userId,
      });

      results[scenarioConfig.key] = result;
    }

    return {
      takeout: results['takeout'],
      convenience: results['convenience'],
      homeCook: results['homeCook'],
    };
  }

  // ─── 从食物池推荐（三阶段 Pipeline: Recall → Rank → Rerank） ───

  /**
   * 参数对象化 — 单一 MealFromPoolRequest 替代 19 个位置参数
   */
  async recommendMealFromPool(
    req: MealFromPoolRequest,
  ): Promise<MealRecommendation> {
    const {
      mealType,
      goalType,
      consumed,
      target,
      dailyTarget,
      excludeNames,
      userProfile,
      resolvedStrategy,
      contextualProfile,
      channel,
      userId,
      sceneContext,
      effectiveGoal,
      goalProgress,
      crossMealAdjustment: reqCrossMealAdjustment,
      kitchenProfile,
      substitutions,
    } = req;
    const scoredRecipes = req.scoredRecipes;

    // 区域+时区优化（阶段 1.1b）：从食物池推荐入口同样预热区域时令缓存。
    // 该入口由 recommendMeal 内部调用，正常流程已 preload；当外部直接调用此入口时仍能保证缓存就绪。
    void this.seasonalityService.preloadRegion(
      userProfile?.regionCode || DEFAULT_REGION_CODE,
    );

    const constraints = this.constraintGenerator.generateConstraints(
      goalType,
      consumed,
      target,
      dailyTarget,
      mealType,
      userProfile,
      userProfile?.timezone,
      // 从 EnrichedProfileContext 提取暴食风险时段
      (userProfile as EnrichedProfileContext | undefined)?.observed
        ?.bingeRiskHours,
    );

    // MealPolicy 覆盖餐次角色模板
    const mealPolicy = resolvedStrategy?.config?.meal;
    // P0-A 根因#3 修复：按当餐蛋白目标动态构建 role 数组
    const dynamicRolesLegacy = buildMealRoles(mealType, target.protein);
    const defaultRolesLegacy =
      goalType === 'muscle_gain'
        ? (MUSCLE_GAIN_MEAL_ROLES[mealType] ?? MEAL_ROLES[mealType])
        : MEAL_ROLES[mealType];
    const roles = mealPolicy?.mealRoles?.[mealType] ??
      dynamicRolesLegacy ??
      defaultRolesLegacy ?? ['carb', 'protein', 'veggie'];
    const picks: ScoredFood[] = [];
    const usedNames = new Set(excludeNames);

    // 跨餐营养补偿 — 如果上游未传入 crossMealAdjustment，
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

    // ─── 菜谱优先组装模式 ───
    // 当策略配置 assembly.preferRecipe=true 且有评分菜谱候选时，
    // 先尝试菜谱组装路径。成功则直接返回，失败则降级到原有食物组合模式。
    const assemblyPolicy = resolvedStrategy?.config?.assembly;
    if (
      assemblyPolicy?.preferRecipe &&
      scoredRecipes &&
      scoredRecipes.length > 0
    ) {
      // 先完成一轮角色召回+评分，获取食物候选池（用于菜谱缺口补充）
      const ctx: PipelineContext = this.contextFactory.build(req, {
        constraints,
        picks: [],
        usedNames,
      });

      // 菜谱模式也应用场景动态 realism
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
          // 现实性过滤 + 设备约束过滤
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
          // 菜谱补充召回失败，跳过该角色
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
        const toppedUpRecipePicks =
          this.mealAssembler.ensureMinimumCalorieCoverage(
            recipePicks,
            supplementCandidates,
            target.calories,
            0.7,
            1.1,
          );

        const finalizedRecipePicks =
          toppedUpRecipePicks.length === recipePicks.length
            ? recipePicks
            : this.mealAssembler.adjustPortions(
                toppedUpRecipePicks,
                target.calories,
                userProfile?.portionTendency,
              );

        const tip = this.mealAssembler.buildTip(
          mealType,
          goalType,
          target,
          finalizedRecipePicks.reduce((s, p) => s + p.servingCalories, 0),
          this.resolveLocale(),
        );
        const result = this.mealAssembler.aggregateMealResult(
          finalizedRecipePicks,
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
    // 预取替换反馈权重 Map（一次 DB 查询，在角色循环外执行）
    const replacementWeightMap = userId
      ? await this.replacementFeedbackInjector.getWeightMap(userId, mealType)
      : null;

    const ctx: PipelineContext = this.contextFactory.build(req, {
      constraints,
      picks,
      usedNames,
      replacementWeightMap,
      crossMealAdjustment,
    });

    // 初始化管道追踪（受 feature flag 控制）
    const traceEnabled = userId
      ? await this.featureFlagService.isEnabled(
          'pipeline_trace_enabled',
          userId,
        )
      : await this.featureFlagService.isEnabled('pipeline_trace_enabled');
    if (traceEnabled) {
      ctx.trace = {
        traceId: uuidv4(),
        userId: userId ?? 'anonymous',
        mealType,
        startedAt: Date.now(),
        stages: [],
      };
    }

    // 模板匹配 — 如果场景和餐次有对应模板，设置到上下文中
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

    // 加载用户 Factor 强度调整（冷启动用户返回空 Map，不影响评分）
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

    // 场景动态 realism 调整
    // 在策略合并用户偏好后，根据当前场景（工作日/周末 × 餐次）进一步收紧
    const dayType = contextualProfile?.dayType as string | undefined;
    const sceneAdjustedRealism = this.realisticFilterService.adjustForScene(
      resolvedStrategy?.config?.realism,
      mealType,
      dayType,
    );

    // 委托 PipelineBuilder 执行角色循环管道
    const {
      picks: finalPicks,
      allCandidates,
      degradations,
    } = await this.pipelineBuilder.executeRolePipeline(
      ctx,
      roles,
      sceneAdjustedRealism,
    );

    // 记录降级信息（如有）
    if (degradations.length > 0) {
      this.logger.warn(
        `Pipeline degradations for user ${userId ?? 'anonymous'}, meal ${mealType}: ` +
          degradations.map((d) => `${d.stage}(${d.fallbackUsed})`).join(', '),
      );
    }

    // 持久化管道追踪数据（异步，不阻塞推荐响应）
    if (ctx.trace) {
      ctx.trace.completedAt = Date.now();
      const pipelineStartedAt = ctx.trace.startedAt;
      const totalDurationMs = ctx.trace.completedAt - pipelineStartedAt;

      // 构建 candidateFlow 路径 — 从 trace stages 提取 inputCount→outputCount
      const flowParts: number[] = [];
      for (const stage of ctx.trace.stages) {
        if (flowParts.length === 0) {
          flowParts.push(stage.inputCount);
        }
        flowParts.push(stage.outputCount);
      }
      const candidateFlow = flowParts.join('→') || 'N/A';

      // fire-and-forget：异步写入，失败不影响推荐返回
      this.traceService
        .recordTraceV79({
          userId: userId ?? 'anonymous',
          mealType,
          goalType,
          channel: channel ?? AcquisitionChannel.UNKNOWN,
          strategyId: resolvedStrategy?.strategyId ?? undefined,
          strategyVersion:
            resolvedStrategy?.resolvedAt?.toString() ?? undefined,
          pipelineContext: ctx,
          topFoods: finalPicks,
          foodPoolSize: req.allFoods.length,
          durationMs: totalDurationMs,
          // 新增字段
          traceData: ctx.trace,
          strategyName: resolvedStrategy?.strategyName ?? 'default',
          sceneName: sceneContext?.sceneType ?? 'general',
          realismLevel:
            sceneAdjustedRealism?.enabled === false
              ? 'disabled'
              : sceneAdjustedRealism?.canteenMode
                ? 'canteen'
                : `threshold_${sceneAdjustedRealism?.commonalityThreshold ?? 20}`,
          candidateFlow,
          totalDurationMs,
          cacheHit: ctx.trace.summary?.cacheHit ?? false,
          degradations: degradations.map(
            (d) => `${d.stage}(${d.fallbackUsed})`,
          ),
        })
        .catch((err) => {
          this.logger.warn(
            `Trace persistence failed for user ${userId ?? 'anonymous'}: ${(err as Error).message}`,
          );
        });
    }

    // 委托 ResultProcessor 执行后处理
    return this.resultProcessor.process({
      finalPicks,
      allCandidates,
      degradations,
      mealType,
      goalType,
      target,
      userProfile,
      matchedTemplate,
      sceneContext,
      userId,
      effectiveGoal,
      goalProgress,
      crossMealAdjustment,
      substitutions,
      dailyPlanState: req.dailyPlanState,
    });
  }

  // ─── 反向解释 API — "为什么不推荐 X？" ───

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
    dailyTarget: MealTarget,
    consumed: { calories: number; protein: number },
    userProfile?: UserProfileConstraints,
    locale?: string,
  ): Promise<WhyNotResult> {
    const resolvedLocale = this.resolveLocale(locale);
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
        reason: t('error.foodNotFound', { foodName }, resolvedLocale),
        alternatives: [],
      };
    }

    // 2. 检测硬过滤原因
    const filterReasons: string[] = [];

    // 2a. 过敏原冲突
    if (userProfile?.allergens?.length) {
      const conflicts = matchAllergens(food, userProfile.allergens);
      if (conflicts.length > 0) {
        filterReasons.push(
          t(
            'filter_reason.allergen',
            {
              allergen: conflicts.join(
                resolvedLocale === 'en-US' ? ', ' : '、',
              ),
            },
            resolvedLocale,
          ),
        );
      }
    }

    // 2b. 餐次不适配
    const foodMealTypes: string[] = food.mealTypes || [];
    if (foodMealTypes.length > 0 && !foodMealTypes.includes(mealType)) {
      const currentMealLabel = t(`meal.label.${mealType}`, {}, resolvedLocale);
      const supportedMeals = foodMealTypes
        .map((type) => t(`meal.label.${type}`, {}, resolvedLocale))
        .join(resolvedLocale === 'en-US' ? ', ' : '、');
      filterReasons.push(
        resolvedLocale === 'en-US'
          ? `Not suitable for ${currentMealLabel} (better for: ${supportedMeals})`
          : resolvedLocale === 'ja-JP'
            ? `${currentMealLabel}には不向きです（適した食事: ${supportedMeals}）`
            : `该食物不适合${currentMealLabel}餐次（适合: ${supportedMeals}）`,
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
      filterReasons.push(t('filter_reason.calorieTooHigh', {}, resolvedLocale));
    }

    // 2d. 蛋白质不足
    if (constraints.minProtein > 0 && food.protein) {
      const servingProtein = (food.protein * food.standardServingG) / 100;
      if (servingProtein < constraints.minProtein) {
        filterReasons.push(
          resolvedLocale === 'en-US'
            ? `Protein ${Math.round(servingProtein)}g is below the minimum target ${Math.round(constraints.minProtein)}g for this meal`
            : resolvedLocale === 'ja-JP'
              ? `たんぱく質 ${Math.round(servingProtein)}g はこの食事の最低目標 ${Math.round(constraints.minProtein)}g を下回っています`
              : `蛋白质 ${Math.round(servingProtein)}g 低于该餐最低要求 ${Math.round(constraints.minProtein)}g`,
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
        filterReasons.push(
          t(
            'filter_reason.dietary',
            {
              restriction: hitTags.join(
                resolvedLocale === 'en-US' ? ', ' : '、',
              ),
            },
            resolvedLocale,
          ),
        );
      }
    }

    // 2f. 短期拒绝历史
    const shortTermProfile =
      await this.profileAggregator.getShortTermProfile(userId);
    const resolvedStrategy = await this.strategyFacade.resolveStrategyForUser(
      userId,
      goalType,
    );
    const recallConfig = resolvedStrategy?.config?.recall;
    const rejectThreshold = recallConfig?.shortTermRejectThreshold ?? 2;
    const rejectCount = shortTermProfile?.rejectedFoods?.[food.name] || 0;
    if (rejectCount >= rejectThreshold) {
      filterReasons.push(t('filter_reason.userRejected', {}, resolvedLocale));
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

    // 加载中心化评分参数
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
      scoringConfig,
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
      resolvedLocale,
    );

    // 5. 查找替代推荐 — 同餐次 Top-5（排除该食物本身）
    const alternativeFoods = this.foodScorer
      .scoreFoodsWithServing(
        allFoods.filter((f) => f.id !== food.id),
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

  async getAllFoods(): Promise<FoodLibrary[]> {
    const foods = await this.foodPoolCache.getVerifiedFoods();
    // 同步品类微量营养素均值到评分服务（用于缺失值插补）
    this.foodScorer.setCategoryMicroDefaults(
      this.foodPoolCache.getCategoryMicroAverages(),
    );
    return foods;
  }

  /**
   * 通过 TieredCache 共享 namespace 读取分析画像
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
}
