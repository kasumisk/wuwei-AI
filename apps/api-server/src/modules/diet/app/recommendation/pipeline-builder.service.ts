/**
 * V6.7 Phase 3-D: PipelineBuilderService
 *
 * 从 RecommendationEngineService (2299行 God Class) 中提取的推荐管道核心。
 * 封装三阶段推荐管道: Recall → Rank → Rerank
 *
 * 职责：
 * - recallCandidates(): 基于角色/约束/画像的候选召回（规则路 + 语义路 + CF路）
 * - rankCandidates(): 多维评分 + 偏好加权 + 健康修正
 * - rerankAndSelect(): Thompson Sampling 探索 + 相似度去重 → Top-1 选择
 * - 整餐组合冲突解决（食材重复/烹饪方式重复）
 *
 * RecommendationEngineService 仅负责：
 * - 请求入口 + 画像聚合 + 策略解析
 * - 委托 PipelineBuilder 执行管道
 * - 结果后处理（份量调整、解释生成、多语言）
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';
import { GoalType } from '../nutrition-score.service';
import { FoodScorerService } from './food-scorer.service';
import { MealAssemblerService } from './meal-assembler.service';
import { ConstraintGeneratorService } from './constraint-generator.service';
import {
  ScoredFood,
  PipelineContext,
  ROLE_CATEGORIES,
  FoodFeedbackStats,
  EnrichedProfileContext,
  PipelineDegradation,
} from './recommendation.types';
import {
  HealthModifierContext,
  HealthModifierEngineService,
} from './health-modifier-engine.service';
import { filterByAllergens, hasAllergenConflict } from './allergen-filter.util';
import {
  multiObjectiveOptimize,
  extractRankedFoods,
} from './multi-objective-optimizer';
import { mapLifestyleToScoringFactors } from './profile-scoring-mapper';
import { NutritionTargetService } from './nutrition-target.service';
import { SemanticRecallService } from './semantic-recall.service';
import {
  RecallMergerService,
  SemanticRecallItem,
} from './recall-merger.service';
import { RealisticFilterService } from './realistic-filter.service';
import { LifestyleScoringAdapter } from './lifestyle-scoring-adapter.service';
import { ScoringConfigService } from './scoring-config.service';
import { CFRecallService } from './cf-recall.service';
import { MealCompositionScorer } from './meal-composition-scorer.service';
import { StrategyAutoTuner } from '../../../strategy/app/strategy-auto-tuner.service';
import { PreferenceProfileService } from './preference-profile.service';
import { ScoringChainService } from './scoring-chain/scoring-chain.service';
import type { RecommendationStrategy } from './recommendation-strategy.types';
import {
  PreferenceSignalFactor,
  RegionalBoostFactor,
  CollaborativeFilteringFactor,
  ShortTermProfileFactor,
  SceneContextFactor,
  AnalysisProfileFactor,
  LifestyleBoostFactor,
  PopularityFactor,
  ReplacementFeedbackFactor,
  RuleWeightFactor,
} from './scoring-chain/factors';

@Injectable()
export class PipelineBuilderService implements OnModuleInit {
  private readonly logger = new Logger(PipelineBuilderService.name);

  constructor(
    private readonly foodScorer: FoodScorerService,
    private readonly mealAssembler: MealAssemblerService,
    private readonly constraintGenerator: ConstraintGeneratorService,
    private readonly healthModifierEngine: HealthModifierEngineService,
    private readonly nutritionTargetService: NutritionTargetService,
    private readonly semanticRecallService: SemanticRecallService,
    private readonly recallMerger: RecallMergerService,
    private readonly realisticFilterService: RealisticFilterService,
    private readonly lifestyleScoringAdapter: LifestyleScoringAdapter,
    private readonly scoringConfigService: ScoringConfigService,
    private readonly cfRecallService: CFRecallService,
    private readonly mealCompositionScorer: MealCompositionScorer,
    private readonly strategyAutoTuner: StrategyAutoTuner,
    /** V7.1 P3-C: 偏好信号计算服务（统一 PreferenceSignal） */
    private readonly preferenceProfileService: PreferenceProfileService,
    /** V7.2 P3-A: 链式评分管道服务 */
    private readonly scoringChainService: ScoringChainService,
  ) {}

  // ─── V7.4 P1-E: 模块初始化时注册 10 个评分因子 ───

  /**
   * 在 NestJS 模块初始化时注册所有 ScoringFactor 到 ScoringChainService。
   *
   * V7.4: 将 V7.2 创建的 10 个 ScoringFactor 实现正式注册到链式评分管道，
   * 取代 rankCandidatesLegacy 中的 14 个内联 boost 块。
   * LifestyleBoostFactor 需要两个 lambda 来桥接 DI 服务：
   * - getLifestyleFactors: 从 PipelineContext 提取 lifestyle → mapLifestyleToScoringFactors
   * - getLifestyleAdjustment: 从 PipelineContext 提取 declared → lifestyleScoringAdapter.adapt()
   */
  onModuleInit(): void {
    this.scoringChainService.registerFactors([
      new PreferenceSignalFactor(),
      new RegionalBoostFactor(),
      new CollaborativeFilteringFactor(),
      new ShortTermProfileFactor(),
      new SceneContextFactor(),
      new AnalysisProfileFactor(),
      new LifestyleBoostFactor(
        // getLifestyleFactors: 从 ctx.userProfile.lifestyle 提取画像→评分函数
        (ctx) => {
          const enriched = ctx.userProfile as
            | EnrichedProfileContext
            | undefined;
          return mapLifestyleToScoringFactors(enriched?.lifestyle ?? null);
        },
        // getLifestyleAdjustment: 从 ctx.userProfile.declared 提取生活方式营养素调整
        (ctx) => {
          const enriched = ctx.userProfile as
            | EnrichedProfileContext
            | undefined;
          if (!enriched?.declared) return null;
          return this.lifestyleScoringAdapter.adapt(
            {
              sleepQuality: enriched.declared.sleepQuality,
              stressLevel: enriched.declared.stressLevel,
              supplementsUsed: enriched.declared.supplementsUsed,
              hydrationGoal: enriched.declared.hydrationGoal,
              mealTimingPreference: enriched.declared.mealTimingPreference,
              exerciseIntensity: enriched.declared.exerciseIntensity,
              alcoholFrequency: enriched.declared.alcoholFrequency,
              age: enriched.declared.age,
            },
            ctx.mealType,
          );
        },
      ),
      new PopularityFactor(),
      new ReplacementFeedbackFactor(),
      new RuleWeightFactor(),
    ]);

    this.logger.log(
      `Registered ${this.scoringChainService.getFactors().length} scoring factors via ScoringChain`,
    );
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
  async recallCandidates(
    ctx: PipelineContext,
    role: string,
  ): Promise<FoodLibrary[]> {
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

    // V6.2 3.4: 烹饪技能过滤 — beginner 用户排除 advanced 菜品
    if (ctx.userProfile?.cookingSkillLevel === 'beginner') {
      const beforeCount = candidates.length;
      candidates = candidates.filter((f) => f.skillRequired !== 'advanced');
      // 安全兜底：不能因技能过滤清空候选
      if (candidates.length < 3 && beforeCount >= 3) {
        candidates = ctx.allFoods
          .filter(
            (f) =>
              roleCategories.includes(f.category) && !ctx.usedNames.has(f.name),
          )
          .slice(0, 10);
      }
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

    // V6.4 Phase 3.3: 获取渠道过滤 — 按 available_channels 字段过滤
    // channel=unknown 时跳过过滤（保留全量候选）
    if (ctx.channel && ctx.channel !== 'unknown') {
      const beforeCount = candidates.length;
      candidates = candidates.filter((f) => {
        const channels = f.availableChannels;
        // 没有设置渠道的食物默认所有渠道可用
        if (!channels || channels.length === 0) return true;
        return channels.includes(ctx.channel!);
      });
      // 安全兜底：不能因渠道过滤清空候选（至少保留 3 个）
      if (candidates.length < 3 && beforeCount >= 3) {
        candidates = ctx.allFoods
          .filter(
            (f) =>
              roleCategories.includes(f.category) && !ctx.usedNames.has(f.name),
          )
          .slice(0, 10);
      }
    }

    // V6.7 Phase 2-B: 三路召回合并 — 语义路 + CF 路补充候选 + RecallMergerService 去重
    const vectorConfig = ctx.resolvedStrategy?.config?.recall?.sources?.vector;
    if (
      vectorConfig?.enabled &&
      vectorConfig.weight &&
      vectorConfig.weight > 0 &&
      ctx.userId
    ) {
      try {
        const semanticLimit = Math.max(
          Math.ceil(candidates.length * vectorConfig.weight),
          5,
        );
        const excludeIds = candidates.map((f) => f.id);
        // 1. 语义召回
        const semanticIds = await this.semanticRecallService.recallSimilarFoods(
          ctx.userId,
          semanticLimit,
          excludeIds,
        );
        // 2. 将语义召回 ID 映射为 SemanticRecallItem
        const semanticIdSet = new Set(semanticIds);
        const semanticItems: SemanticRecallItem[] = ctx.allFoods
          .filter(
            (f) =>
              semanticIdSet.has(f.id) &&
              !ctx.usedNames.has(f.name) &&
              roleCategories.includes(f.category),
          )
          .map((f) => ({ food: f, semanticScore: 0.5 }));

        // 3. V6.7 Phase 2-B: CF 召回第三路
        const cfCandidates = ctx.userId
          ? await this.cfRecallService.recall(
              ctx.userId,
              new Set(excludeIds),
              Math.max(Math.ceil(semanticLimit * 0.5), 5),
            )
          : [];

        // 4. 获取评分配置快照
        const scoringConfig = await this.scoringConfigService.getConfig();

        // 5. 三路合并
        const { merged } = this.recallMerger.mergeThreeWay(
          candidates,
          semanticItems,
          cfCandidates,
          scoringConfig,
        );
        candidates = this.recallMerger.toFoodListWithAllFoods(
          merged,
          ctx.allFoods,
        );
      } catch (err) {
        // 语义/CF召回失败不影响主流程，降级为纯规则路
        this.logger.debug(`三路召回降级: ${(err as Error).message}`);
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
   * V6.4: 改为 async 以支持 L2 缓存预热 + 回写
   * V7.2 P3-A: 链式评分管道替代 14 个内联 boost 块
   * V7.4 P1-E: 移除 legacy fallback 分支，ScoringFactor 在 onModuleInit 中注册，
   *            直接走 rankCandidatesViaChain 路径。
   */
  async rankCandidates(
    ctx: PipelineContext,
    candidates: FoodLibrary[],
  ): Promise<ScoredFood[]> {
    return this.rankCandidatesViaChain(ctx, candidates);
  }

  /**
   * V7.2 P3-A: 链式评分管道实现
   *
   * 将原 rankCandidates 中 14 个内联 boost 块替换为 ScoringChainService.executeChain()。
   * 保留：
   * - 健康修正引擎预加载/回写
   * - 营养目标个性化
   * - FoodScorer.scoreFoodDetailed() 基础评分
   * - PreferenceSignal 统一偏好信号
   */
  private async rankCandidatesViaChain(
    ctx: PipelineContext,
    candidates: FoodLibrary[],
  ): Promise<ScoredFood[]> {
    const penaltyCtx: HealthModifierContext = {
      allergens: ctx.userProfile?.allergens,
      healthConditions: ctx.userProfile?.healthConditions,
      goalType: ctx.goalType,
    };

    const nutritionGaps = (
      ctx.userProfile as EnrichedProfileContext | undefined
    )?.inferred?.nutritionGaps;

    const enrichedCtx = ctx.userProfile as EnrichedProfileContext | undefined;
    const nutritionTargets = this.buildNutritionTargets(enrichedCtx);

    const scoringConfig = await this.scoringConfigService.getConfig();

    const healthModifierCache = new Map<
      string,
      import('./health-modifier-engine.service').HealthModifierResult
    >();

    const candidateIds = candidates.map((f) => f.id).filter(Boolean);
    await this.healthModifierEngine.preloadL2Cache(
      candidateIds,
      penaltyCtx,
      healthModifierCache,
    );
    const preloadedIds = new Set(healthModifierCache.keys());

    // Phase A: 计算基础分（FoodScorer + PreferenceSignal）
    const baseResults = candidates.map((food) => {
      const foodFeedbackStat = ctx.feedbackStats?.[food.id] ?? null;
      const preferenceSignal =
        this.preferenceProfileService.computePreferenceSignal(
          food,
          foodFeedbackStat,
          ctx.preferenceProfile ?? null,
          ctx.domainProfiles?.preferences ?? null,
          ctx.substitutions ?? null,
        );

      const detailed = this.foodScorer.scoreFoodDetailed({
        food,
        goalType: ctx.goalType,
        target: ctx.target,
        penaltyContext: penaltyCtx,
        mealType: ctx.mealType,
        statusFlags: undefined,
        weightOverrides: ctx.weightOverrides,
        mealWeightOverrides: ctx.mealWeightOverrides,
        rankPolicy: ctx.resolvedStrategy?.config?.rank,
        nutritionGaps,
        healthModifierCache,
        nutritionTargets,
        scoringConfig,
        preferencesProfile: ctx.domainProfiles?.preferences,
        preferenceSignal,
      });

      return { food, score: detailed.score, explanation: detailed.explanation };
    });

    const baseFoods = baseResults.map((r) => r.food);
    const baseScores = baseResults.map((r) => r.score);
    const baseExplanations = baseResults.map((r) => r.explanation);

    // Phase B: 链式评分管道
    // V7.4 P2-C: 合并推荐策略的 factorStrengthOverrides 到 factorAdjustments
    const mergedCtx = this.mergeStrategyFactorOverrides(ctx);
    const chainResults = this.scoringChainService.executeChain(
      baseFoods,
      baseScores,
      mergedCtx,
    );

    // Phase C: 合并结果 → ScoredFood[]
    const scored: ScoredFood[] = chainResults
      .map((cr, i) => {
        // 合并 FoodScorer 的基础解释 + ScoringChain 的 boost 解释
        const mergedExplanation = {
          ...baseExplanations[i],
          ...cr.explanation, // chain 解释字段（preferenceBoost, profileBoost, etc.）覆盖
          finalScore: cr.finalScore,
        };

        return {
          food: cr.food,
          score: cr.finalScore,
          ...this.foodScorer.calcServingNutrition(cr.food),
          explanation: mergedExplanation,
        };
      })
      .sort((a, b) => b.score - a.score);

    // L2 缓存回写
    this.healthModifierEngine.flushToL2(
      healthModifierCache,
      preloadedIds,
      penaltyCtx,
    );

    return scored;
  }

  /**
   * V6.3 P2-12: 统一构建个性化营养目标
   */
  buildNutritionTargets(enrichedCtx?: EnrichedProfileContext) {
    return this.nutritionTargetService.calculate(
      enrichedCtx?.declared
        ? {
            gender: enrichedCtx.declared.gender,
            age: enrichedCtx.declared.birthYear
              ? new Date().getFullYear() - enrichedCtx.declared.birthYear
              : undefined,
            goal: enrichedCtx.declared.goal as GoalType | undefined,
            weightKg: enrichedCtx.declared.weightKg,
            healthConditions: enrichedCtx.declared.healthConditions,
          }
        : undefined,
    );
  }

  /**
   * V7.4 P2-C: 合并推荐策略的 factorStrengthOverrides 到 PipelineContext.factorAdjustments
   *
   * 合并规则：
   * - 如果 V7.3 FactorLearner 已有学习强度，与 V7.4 策略强度相乘
   *   （例如 FactorLearner=1.2, 策略=0.8 → 最终=0.96）
   * - 如果 FactorLearner 无数据，直接使用策略强度
   *
   * 返回一个浅克隆的 PipelineContext，不修改原始 ctx。
   */
  private mergeStrategyFactorOverrides(ctx: PipelineContext): PipelineContext {
    const strategy = ctx.recommendationStrategy?.strategy;
    if (!strategy) return ctx;

    const overrides = strategy.rank.factorStrengthOverrides;
    if (!overrides || Object.keys(overrides).length === 0) return ctx;

    const merged = new Map(ctx.factorAdjustments ?? []);
    for (const [factorName, strategyStrength] of Object.entries(overrides)) {
      const existing = merged.get(factorName) ?? 1.0;
      merged.set(factorName, existing * strategyStrength);
    }

    return { ...ctx, factorAdjustments: merged };
  }

  /**
   * V7.4 P2-C: 获取当前推荐策略（如果已设置）
   *
   * 供 recall/rerank 阶段使用。
   */
  private getRecommendationStrategy(
    ctx: PipelineContext,
  ): RecommendationStrategy | undefined {
    return ctx.recommendationStrategy?.strategy;
  }

  // ─── Stage 3: Rerank（重排 + 探索 + 选择） ───

  /**
   * 重排阶段 — Thompson Sampling 探索 + 多样性惩罚 → 选出 Top-1
   */
  rerankAndSelect(
    ctx: PipelineContext,
    ranked: ScoredFood[],
  ): ScoredFood | null {
    if (ranked.length === 0) return null;

    // V6 2.2: 从策略配置读取相似度惩罚系数
    const assemblyConfig = ctx.resolvedStrategy?.config?.assembly;
    const baseSimilarityCoeff =
      ctx.resolvedStrategy?.config?.boost?.similarityPenaltyCoeff ?? 0.3;
    const tuning = ctx.tuning;
    const diversityMultiplier =
      assemblyConfig?.diversityLevel === 'high'
        ? (tuning?.diversityHighMultiplier ?? 1.5)
        : assemblyConfig?.diversityLevel === 'low'
          ? (tuning?.diversityLowMultiplier ?? 0.5)
          : 1.0;
    const similarityCoeff = baseSimilarityCoeff * diversityMultiplier;

    // 记录探索前的分数
    const preExploreScores = new Map<string, number>();
    for (const sf of ranked) {
      preExploreScores.set(sf.food.id, sf.score);
    }

    // V6 2.6: 自适应探索率
    const explorationConfig = ctx.resolvedStrategy?.config?.exploration;
    const baseMin = explorationConfig?.baseMin ?? 0.3;
    const baseMax = explorationConfig?.baseMax ?? 1.7;
    const maturityShrink = explorationConfig?.maturityShrink ?? 0.4;
    const matureThreshold = explorationConfig?.matureThreshold ?? 50;

    let totalInteractions = 0;
    if (ctx.feedbackStats) {
      for (const stats of Object.values(ctx.feedbackStats)) {
        totalInteractions += (stats.accepted ?? 0) + (stats.rejected ?? 0);
      }
    }

    const maturity = Math.min(1, totalInteractions / matureThreshold);

    // V6.5 Phase 2G: 自适应探索率
    const tsConvergence = this.calcTsConvergence(ctx.feedbackStats);
    const adaptiveRate = this.strategyAutoTuner.calcAdaptiveExplorationRate(
      totalInteractions,
      tsConvergence,
    );
    const rateScale = adaptiveRate / (tuning?.baseExplorationRate ?? 0.15);

    const midPoint = (baseMin + baseMax) / 2;
    const halfSpan =
      ((baseMax - baseMin) / 2 - maturityShrink * maturity) * rateScale;
    const adaptiveRange: [number, number] = [
      midPoint - halfSpan,
      midPoint + halfSpan,
    ];

    // Thompson Sampling 探索
    let reranked = this.mealAssembler.addExploration(
      ranked,
      ctx.feedbackStats,
      adaptiveRange,
    );

    // ─── V7.3 P2-F: foodForm 成品菜优先策略 ───
    // 在外卖/食堂/便利/外出用餐场景下，优先推荐成品菜(dish)和半成品(semi_prepared)，
    // 降低纯原材料(ingredient)的排序。非外出场景下也给予 dish 适度加分。
    const dishBoostScenes = new Set([
      'eating_out',
      'convenience_meal',
      'canteen_meal',
    ]);
    const sceneType = ctx.sceneContext?.sceneType;
    const isDishPreferredScene =
      dishBoostScenes.has(sceneType ?? '') ||
      ctx.channel === 'delivery' ||
      ctx.channel === 'convenience' ||
      ctx.channel === 'canteen' ||
      ctx.channel === 'restaurant';

    reranked = reranked.map((sf) => {
      const form = sf.food.foodForm;
      let formMultiplier = 1.0;

      if (form === 'dish') {
        // 成品菜: 基础 boost + dishPriority(0-100) 映射为额外加分
        formMultiplier = isDishPreferredScene
          ? 1.0 +
            (sf.food.dishPriority || 50) /
              (tuning?.dishPriorityDivisorScene ?? 500) // 外出场景
          : 1.0 +
            (sf.food.dishPriority || 50) /
              (tuning?.dishPriorityDivisorNormal ?? 1000); // 非外出场景
      } else if (form === 'semi_prepared') {
        // 半成品: 中等 boost
        formMultiplier = isDishPreferredScene
          ? (tuning?.semiPreparedMultiplierScene ?? 1.08)
          : (tuning?.semiPreparedMultiplierNormal ?? 1.03);
      } else {
        // 原材料(ingredient): 外出场景适度降权
        formMultiplier = isDishPreferredScene
          ? (tuning?.ingredientMultiplierScene ?? 0.9)
          : 1.0;
      }

      return { ...sf, score: sf.score * formMultiplier };
    });

    // 食物搭配关系加分/减分
    if (ctx.picks.length > 0) {
      reranked = reranked.map((sf) => {
        const compat = this.mealAssembler.compatibilityBonus(
          sf.food,
          ctx.picks.map((p) => p.food),
        );
        return { ...sf, score: sf.score + compat };
      });
    }

    // 相似度去重惩罚
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

    // 填充 explanation
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

  // ─── 整餐组合冲突解决 ───

  /**
   * 食材重复冲突解决
   */
  resolveIngredientConflicts(
    picks: ScoredFood[],
    candidates: ScoredFood[],
    usedNames: Set<string>,
  ): void {
    const ingredientCount = new Map<string, number>();
    for (const p of picks) {
      const ing = p.food.mainIngredient?.toLowerCase();
      if (ing) ingredientCount.set(ing, (ingredientCount.get(ing) ?? 0) + 1);
    }

    for (const [ingredient, count] of ingredientCount) {
      if (count <= 1) continue;

      const duplicates = picks
        .filter((p) => p.food.mainIngredient?.toLowerCase() === ingredient)
        .sort((a, b) => a.score - b.score);
      const weakest = duplicates[0];
      const weakIdx = picks.indexOf(weakest);
      if (weakIdx === -1) continue;

      const replacement = candidates.find(
        (c) =>
          c.food.category === weakest.food.category &&
          c.food.mainIngredient?.toLowerCase() !== ingredient &&
          !usedNames.has(c.food.name),
      );

      if (replacement) {
        this.logger.debug(
          `整餐 Rerank: 替换重复食材 "${weakest.food.name}" → "${replacement.food.name}"`,
        );
        picks[weakIdx] = replacement;
        usedNames.add(replacement.food.name);
      }
    }
  }

  /**
   * 烹饪方式重复冲突解决
   */
  resolveCookingMethodConflicts(
    picks: ScoredFood[],
    candidates: ScoredFood[],
    usedNames: Set<string>,
  ): void {
    const methodCount = new Map<string, number>();
    for (const p of picks) {
      const method = p.food.cookingMethod?.toLowerCase();
      if (method) methodCount.set(method, (methodCount.get(method) ?? 0) + 1);
    }

    for (const [method, count] of methodCount) {
      if (count <= 1) continue;

      const duplicates = picks
        .filter((p) => p.food.cookingMethod?.toLowerCase() === method)
        .sort((a, b) => a.score - b.score);
      const weakest = duplicates[0];
      const weakIdx = picks.indexOf(weakest);
      if (weakIdx === -1) continue;

      const usedMethods = new Set(
        picks
          .map((p) => p.food.cookingMethod?.toLowerCase())
          .filter(Boolean) as string[],
      );
      const replacement = candidates.find(
        (c) =>
          c.food.category === weakest.food.category &&
          c.food.cookingMethod &&
          !usedMethods.has(c.food.cookingMethod.toLowerCase()) &&
          !usedNames.has(c.food.name),
      );

      if (replacement) {
        this.logger.debug(
          `整餐 Rerank: 替换重复烹饪方式 "${weakest.food.name}"(${method}) → "${replacement.food.name}"(${replacement.food.cookingMethod})`,
        );
        picks[weakIdx] = replacement;
        usedNames.add(replacement.food.name);
      }
    }
  }

  // ─── 管道执行入口 ───

  /**
   * 执行完整的角色循环管道: 对每个角色执行 Recall → Rank → Rerank
   * 并在所有角色完成后执行整餐组合检查和冲突解决
   *
   * @returns picks: 选中的食物列表, allCandidates: 全部候选（供全局优化器用）
   */
  async executeRolePipeline(
    ctx: PipelineContext,
    roles: string[],
    sceneAdjustedRealism: any,
  ): Promise<{
    picks: ScoredFood[];
    allCandidates: ScoredFood[];
    degradations: PipelineDegradation[];
  }> {
    const picks = ctx.picks;
    const usedNames = ctx.usedNames;
    const allCandidates: ScoredFood[] = [];
    const degradations: PipelineDegradation[] = [];

    for (const role of roles) {
      // Stage 1: Recall
      let recalled: FoodLibrary[];
      try {
        recalled = await this.recallCandidates(ctx, role);
      } catch (e) {
        this.logger.error(
          `Recall failed for role "${role}", using unfiltered fallback: ${e}`,
        );
        degradations.push({
          stage: 'recall',
          reason: e instanceof Error ? e.message : String(e),
          fallbackUsed: 'unfiltered_allFoods',
        });
        // Fallback: 使用全量食物池（仅做基本的过敏原/已选排除）
        recalled = ctx.allFoods.filter((f) => !usedNames.has(f.name));
      }

      // V6.5 Phase 3G: 现实性过滤
      let realistic: FoodLibrary[];
      try {
        realistic = this.realisticFilterService.filterByRealism(
          recalled,
          ctx,
          sceneAdjustedRealism,
          ctx.kitchenProfile, // V7.1 P3-B: 传递厨房设备画像
        );
      } catch (e) {
        this.logger.error(
          `Realism filter failed for role "${role}", skipping: ${e}`,
        );
        degradations.push({
          stage: 'realism_filter',
          reason: e instanceof Error ? e.message : String(e),
          fallbackUsed: 'skip_realism_filter',
        });
        realistic = recalled;
      }

      // V7.4 P2-C: 推荐策略 — acquisitionDifficulty 过滤
      // 如果策略设定了 acquisitionDifficultyMax，过滤掉获取难度超标的食物
      const recStrategy = this.getRecommendationStrategy(ctx);
      if (recStrategy) {
        const maxDiff = recStrategy.rerank.acquisitionDifficultyMax;
        const before = realistic.length;
        const filtered = realistic.filter(
          (f) => (f.acquisitionDifficulty ?? 3) <= maxDiff,
        );
        // 只在过滤后仍有足够候选时应用（至少保留3个）
        if (filtered.length >= 3) {
          realistic = filtered;
          if (before !== filtered.length) {
            this.logger.debug(
              `Strategy [${recStrategy.name}] filtered ${before - filtered.length} foods by acquisitionDifficulty > ${maxDiff}`,
            );
          }
        }
      }

      // Stage 2: Rank
      let ranked: ScoredFood[];
      try {
        ranked = await this.rankCandidates(ctx, realistic);
      } catch (e) {
        this.logger.error(
          `Ranking failed for role "${role}", using basic calorie sort: ${e}`,
        );
        degradations.push({
          stage: 'rank',
          reason: e instanceof Error ? e.message : String(e),
          fallbackUsed: 'basic_calorie_sort',
        });
        // Fallback: 按热量与目标的接近程度简单排序
        const targetCal = ctx.target.calories / (ctx.picks.length + 1 || 1);
        ranked = realistic
          .map((f) => ({
            food: f,
            servingCalories: f.calories ?? 0,
            servingProtein: f.protein ?? 0,
            servingFat: f.fat ?? 0,
            servingCarbs: f.carbs ?? 0,
            servingFiber: f.fiber ?? 0,
            servingGL: f.glycemicLoad ?? 0,
            score: 0,
            servingGrams: 100,
            adjustedScore: 0,
            dimensionScores: {},
            tags: [],
          }))
          .sort(
            (a, b) =>
              Math.abs((a.food.calories ?? 0) - targetCal) -
              Math.abs((b.food.calories ?? 0) - targetCal),
          );
      }

      // V6 2.5: 多目标优化（可选）
      let finalRanked: ScoredFood[];
      try {
        const moConfig = ctx.resolvedStrategy?.config?.multiObjective;
        finalRanked =
          moConfig?.enabled && ranked.length > 0
            ? extractRankedFoods(
                multiObjectiveOptimize(ranked, moConfig),
                ranked.length,
              )
            : ranked;
      } catch (e) {
        this.logger.error(
          `Multi-objective optimization failed for role "${role}", skipping: ${e}`,
        );
        degradations.push({
          stage: 'multi_objective',
          reason: e instanceof Error ? e.message : String(e),
          fallbackUsed: 'skip_multi_objective',
        });
        finalRanked = ranked;
      }

      // V5 2.1: 收集候选
      const optimizerLimit = ctx.tuning?.optimizerCandidateLimit ?? 8;
      allCandidates.push(...finalRanked.slice(0, optimizerLimit));

      // Stage 3: Rerank → Top-1
      let selected: ScoredFood | null;
      try {
        selected = this.rerankAndSelect(ctx, finalRanked);
      } catch (e) {
        this.logger.error(
          `Rerank failed for role "${role}", using top-1 from rank: ${e}`,
        );
        degradations.push({
          stage: 'rerank',
          reason: e instanceof Error ? e.message : String(e),
          fallbackUsed: 'top1_from_rank',
        });
        selected = finalRanked.length > 0 ? finalRanked[0] : null;
      }

      if (selected) {
        picks.push(selected);
        usedNames.add(selected.food.name);
      }
    }

    // V6.8 Phase 2-F: 多轮冲突解决（最多 3 轮，无冲突时提前退出）
    if (picks.length >= 2) {
      try {
        this.resolveCompositionConflicts(picks, allCandidates, usedNames);
      } catch (e) {
        this.logger.error(
          `Composition conflict resolution failed, skipping: ${e}`,
        );
        degradations.push({
          stage: 'composition_conflict',
          reason: e instanceof Error ? e.message : String(e),
          fallbackUsed: 'skip_conflict_resolution',
        });
      }
    }

    // V7.4 P2-C: 推荐策略 — maxSameCategory 同品类限制
    // 如果策略设定了最大同品类食物数量，超出时替换最低分的重复品类食物
    const recStrategyFinal = this.getRecommendationStrategy(ctx);
    if (recStrategyFinal && picks.length >= 2) {
      try {
        this.enforceMaxSameCategory(
          picks,
          allCandidates,
          usedNames,
          recStrategyFinal.rerank.maxSameCategory,
        );
      } catch (e) {
        this.logger.debug(`maxSameCategory enforcement failed, skipping: ${e}`);
      }
    }

    if (degradations.length > 0) {
      this.logger.warn(
        `Pipeline completed with ${degradations.length} degradation(s): ${degradations.map((d) => d.stage).join(', ')}`,
      );
    }

    return { picks, allCandidates, degradations };
  }

  /**
   * V7.4 P2-C: 同品类数量限制
   *
   * 检查 picks 中每个品类的食物数量是否超过 maxSameCategory，
   * 如果超过则用候选中不同品类的食物替换最低分的重复品类食物。
   */
  private enforceMaxSameCategory(
    picks: ScoredFood[],
    candidates: ScoredFood[],
    usedNames: Set<string>,
    maxSameCategory: number,
  ): void {
    const categoryCounts = new Map<string, number>();
    for (const p of picks) {
      const cat = p.food.category;
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
    }

    for (const [category, count] of categoryCounts) {
      if (count <= maxSameCategory) continue;

      // 找到同品类的食物，按分数升序（先替换最低分的）
      const sameCat = picks
        .filter((p) => p.food.category === category)
        .sort((a, b) => a.score - b.score);

      const excessCount = count - maxSameCategory;
      let replaced = 0;

      for (const weakest of sameCat) {
        if (replaced >= excessCount) break;

        const weakIdx = picks.indexOf(weakest);
        if (weakIdx === -1) continue;

        // 寻找不同品类的替代
        const replacement = candidates.find(
          (c) => c.food.category !== category && !usedNames.has(c.food.name),
        );

        if (replacement) {
          this.logger.debug(
            `Strategy maxSameCategory: 替换过多的 ${category} "${weakest.food.name}" → "${replacement.food.name}"`,
          );
          picks[weakIdx] = replacement;
          usedNames.add(replacement.food.name);
          replaced++;
        }
      }
    }
  }

  /**
   * V6.8 Phase 3-F: 多轮冲突解决（从 executeRolePipeline 提取）
   */
  private resolveCompositionConflicts(
    picks: ScoredFood[],
    allCandidates: ScoredFood[],
    usedNames: Set<string>,
  ): void {
    const tuning = this.scoringConfigService.getTuning();
    const maxRounds = tuning.conflictMaxRounds;
    for (let round = 0; round < maxRounds; round++) {
      const compositionScore =
        this.mealCompositionScorer.scoreMealComposition(picks);

      const hasIngredientConflict =
        compositionScore.ingredientDiversity <
        tuning.ingredientDiversityThreshold;
      const hasCookingConflict =
        compositionScore.cookingMethodDiversity <
        tuning.cookingMethodDiversityThreshold;

      if (!hasIngredientConflict && !hasCookingConflict) {
        if (round > 0) {
          this.logger.debug(
            `冲突解决在第 ${round} 轮完成（共 ${maxRounds} 轮上限）`,
          );
        }
        break;
      }

      const picksBefore = picks.map((p) => p.food.name).join(',');

      if (hasIngredientConflict) {
        this.resolveIngredientConflicts(picks, allCandidates, usedNames);
      }
      if (hasCookingConflict) {
        this.resolveCookingMethodConflicts(picks, allCandidates, usedNames);
      }

      const picksAfter = picks.map((p) => p.food.name).join(',');
      if (picksBefore === picksAfter) {
        this.logger.debug(`冲突解决第 ${round + 1} 轮无变化，停止迭代`);
        break;
      }
    }
  }

  // ─── V6.5 Phase 2G: TS 收敛度计算 ───

  /**
   * 计算 Thompson Sampling 收敛度 (0-1)
   */
  calcTsConvergence(feedbackStats?: Record<string, FoodFeedbackStats>): number {
    if (!feedbackStats) return 0;

    const entries = Object.values(feedbackStats);
    if (entries.length === 0) return 0;

    let totalVariance = 0;
    for (const stats of entries) {
      const alpha = (stats.accepted ?? 0) + 1;
      const beta = (stats.rejected ?? 0) + 1;
      const sum = alpha + beta;
      const variance = (alpha * beta) / (sum * sum * (sum + 1));
      totalVariance += variance;
    }

    const avgVariance = totalVariance / entries.length;
    const maxVariance = 1 / 12;
    return Math.max(0, Math.min(1, 1 - avgVariance / maxVariance));
  }
}
