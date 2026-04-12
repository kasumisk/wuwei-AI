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

import { Injectable, Logger } from '@nestjs/common';
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
  ScoringConfigSnapshot,
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
import {
  mapLifestyleToScoringFactors,
  ScoringFactors,
} from './profile-scoring-mapper';
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

/** V5 2.1: 每个角色最多保留的候选数量，供全局优化器替换用 */
const OPTIMIZER_CANDIDATE_LIMIT = 8;

@Injectable()
export class PipelineBuilderService {
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
        const channels = (f as any).availableChannels as string[] | undefined;
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
   * V7.2 P3-A: 如果 ScoringChainService 已注册因子，使用链式评分管道替代
   *            14个内联 boost 块；否则回退到原始实现（向后兼容）。
   */
  async rankCandidates(
    ctx: PipelineContext,
    candidates: FoodLibrary[],
  ): Promise<ScoredFood[]> {
    // 如果链式评分管道已注册因子，使用新路径
    if (this.scoringChainService.getFactors().length > 0) {
      return this.rankCandidatesViaChain(ctx, candidates);
    }
    // 否则回退到原始内联实现
    return this.rankCandidatesLegacy(ctx, candidates);
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
    const chainResults = this.scoringChainService.executeChain(
      baseFoods,
      baseScores,
      ctx,
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
   * 原始内联 boost 实现（V7.2 之前的 rankCandidates 逻辑）
   *
   * 保留用于 ScoringChain 未注册因子时的回退路径，
   * 确保完全向后兼容。Phase 3 集成完成后可逐步移除。
   */
  private async rankCandidatesLegacy(
    ctx: PipelineContext,
    candidates: FoodLibrary[],
  ): Promise<ScoredFood[]> {
    const penaltyCtx: HealthModifierContext = {
      allergens: ctx.userProfile?.allergens,
      healthConditions: ctx.userProfile?.healthConditions,
      goalType: ctx.goalType,
    };

    // V6.3 P1-2: 从 EnrichedProfileContext 提取 nutritionGaps
    const nutritionGaps = (
      ctx.userProfile as EnrichedProfileContext | undefined
    )?.inferred?.nutritionGaps;

    // V6.3 P1-10: 计算个性化营养目标
    const enrichedCtx = ctx.userProfile as EnrichedProfileContext | undefined;
    const nutritionTargets = this.buildNutritionTargets(enrichedCtx);

    // V6.7 Phase 1-B: 从 ScoringConfigService 加载评分参数快照
    const scoringConfig = await this.scoringConfigService.getConfig();

    // V6.3 P1-8: 健康修正请求级缓存
    const healthModifierCache = new Map<
      string,
      import('./health-modifier-engine.service').HealthModifierResult
    >();

    // V6.4: L2 缓存预热
    const candidateIds = candidates.map((f) => f.id).filter(Boolean);
    await this.healthModifierEngine.preloadL2Cache(
      candidateIds,
      penaltyCtx,
      healthModifierCache,
    );
    const preloadedIds = new Set(healthModifierCache.keys());

    // V6.5 Phase 1E: 画像→评分因子
    const lifestyleFactors: ScoringFactors = mapLifestyleToScoringFactors(
      (ctx.userProfile as EnrichedProfileContext | undefined)?.lifestyle ??
        null,
    );

    // V6.6 Phase 2-C: 生活方式营养素优先级调整
    const enrichedForLifestyle = ctx.userProfile as
      | EnrichedProfileContext
      | undefined;
    const lifestyleAdjustment = enrichedForLifestyle?.declared
      ? this.lifestyleScoringAdapter.adapt(
          {
            sleepQuality: enrichedForLifestyle.declared.sleepQuality,
            stressLevel: enrichedForLifestyle.declared.stressLevel,
            supplementsUsed: enrichedForLifestyle.declared.supplementsUsed,
            hydrationGoal: enrichedForLifestyle.declared.hydrationGoal,
            mealTimingPreference:
              enrichedForLifestyle.declared.mealTimingPreference,
            exerciseIntensity: enrichedForLifestyle.declared.exerciseIntensity, // V6.8
            alcoholFrequency: enrichedForLifestyle.declared.alcoholFrequency, // V6.8 Phase 3-B
            age: enrichedForLifestyle.declared.age, // V6.8 Phase 3-B
          },
          ctx.mealType,
        )
      : null;

    const scored: ScoredFood[] = candidates
      .map((food) => {
        // V7.1 P3-C: 计算统一偏好信号（per-food）
        // 在 ScoringContext 中传递给 FoodScorer，替代 inline 菜系 boost
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
          // V6.8 Phase 1-B: lifestyleAdjustment 不再传给 food-scorer，统一通过 lifestyleNutrientBoost 路径
          scoringConfig,
          // V7.0 Phase 3-C: 偏好画像（cuisineWeights 等）— fallback 用
          preferencesProfile: ctx.domainProfiles?.preferences,
          // V7.1 P3-C: 统一偏好信号
          preferenceSignal,
        });
        let score = detailed.score;
        const explanation = detailed.explanation;

        // V6 2.2: 从策略配置读取 boost 参数
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

          // 食物名偏好
          const nameW = ctx.preferenceProfile.foodNameWeights[food.name];
          if (nameW !== undefined) {
            profileBoost *= nameW;
          }
        }
        score *= profileBoost;
        explanation.profileBoost = profileBoost;

        // 地区感知偏移
        let regionalBoost = 1.0;
        if (ctx.regionalBoostMap) {
          const regionW = ctx.regionalBoostMap[food.id];
          if (regionW !== undefined) {
            regionalBoost = regionW;
          }
        }
        score *= regionalBoost;
        explanation.regionalBoost = regionalBoost;

        // V4 Phase 4.4: 协同过滤加成
        const cfBoostCap = boostConfig?.cfBoostCap ?? 0.15;
        let cfBoost = 0;
        if (ctx.cfScores) {
          const cfScore = ctx.cfScores[food.id];
          if (cfScore !== undefined && cfScore > 0) {
            cfBoost = cfScore * cfBoostCap;
            score *= 1 + cfBoost;
          }
        }
        explanation.cfBoost = cfBoost;

        // V6 1.9: 短期画像偏好调整
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
              const acceptRate = mealPref.accepted / total;
              const [minBoost, maxBoost] = shortTermBoostRange;
              shortTermBoost = minBoost + acceptRate * (maxBoost - minBoost);
            }
          }
          const rejCount = ctx.shortTermProfile.rejectedFoods?.[food.name] || 0;
          if (rejCount === 1) {
            shortTermBoost *= singleRejectPenalty;
          }
        }
        score *= shortTermBoost;
        explanation.shortTermBoost = shortTermBoost;

        // V6 2.18: 上下文场景加权
        let sceneBoost = 1.0;
        if (ctx.contextualProfile?.sceneWeightModifiers) {
          const mods = ctx.contextualProfile.sceneWeightModifiers;
          const modValues = Object.values(mods).filter(
            (v) => v !== undefined,
          ) as number[];
          if (modValues.length > 0) {
            const product = modValues.reduce((p, v) => p * v, 1.0);
            sceneBoost = Math.pow(product, 1 / modValues.length);
            sceneBoost = Math.max(0.8, Math.min(1.2, sceneBoost));
          }
        }
        score *= sceneBoost;
        explanation.sceneBoost = sceneBoost;

        // V6.1 Phase 3.5: 分析画像加权
        let analysisBoost = 1.0;
        if (ctx.analysisProfile) {
          const analyzedCategories =
            ctx.analysisProfile.recentAnalyzedCategories;
          const categoryCount = analyzedCategories[food.category] ?? 0;
          if (categoryCount > 0) {
            const categoryInterestBoost = Math.min(categoryCount * 0.02, 0.08);
            analysisBoost *= 1 + categoryInterestBoost;
          }
          if (ctx.analysisProfile.recentRiskFoods?.includes(food.name)) {
            analysisBoost *= 0.7;
          }
        }
        score *= analysisBoost;
        explanation.analysisBoost = analysisBoost;

        // V6.5 Phase 1E: 画像→评分因子
        const lifestyleBoost =
          lifestyleFactors.tasteMatch(food) *
          lifestyleFactors.cuisineMatch(food) *
          lifestyleFactors.budgetMatch(food) *
          lifestyleFactors.skillMatch(food) *
          lifestyleFactors.mealPrepMatch(food);
        score *= lifestyleBoost;
        explanation.lifestyleBoost = lifestyleBoost;

        // V6.6 Phase 2-C → V6.8 Phase 1-B: 生活方式营养素优先级调整加成
        // V6.8: 消除双重消费 — food-scorer 不再直接消费 lifestyle 信号，
        // 所有 lifestyle 影响统一通过此路径
        let lifestyleNutrientBoost = 1.0;
        if (
          lifestyleAdjustment &&
          Object.keys(lifestyleAdjustment).length > 0
        ) {
          const foodNutrientValues: Record<string, number> = {
            magnesium: Number((food as any).magnesium) || 0,
            vitaminC: Number((food as any).vitaminC) || 0,
            vitaminD: Number((food as any).vitaminD) || 0,
            vitaminB12: Number((food as any).vitaminB12) || 0,
            vitaminB6: Number((food as any).vitaminB6) || 0,
            calcium: Number((food as any).calcium) || 0,
            iron: Number((food as any).iron) || 0,
            omega3: Number((food as any).omega3) || 0,
            zinc: Number((food as any).zinc) || 0,
            folate: Number((food as any).folate) || 0,
            potassium: Number((food as any).potassium) || 0,
          };

          // V6.8: tryptophan 使用标签匹配（食物库通常无 tryptophan 字段）
          const TRYPTOPHAN_RICH_TAGS =
            scoringConfig?.lifestyleTryptophanTags ?? [
              'poultry',
              'dairy',
              'banana',
              'oats',
              'eggs',
              'seeds',
              'nuts',
              'turkey',
            ];
          const hasTryptophan = TRYPTOPHAN_RICH_TAGS.some(
            (t) =>
              food.tags?.includes(t) ||
              food.category === t ||
              food.mainIngredient?.toLowerCase().includes(t),
          );
          if (hasTryptophan) {
            foodNutrientValues['tryptophan'] = 1;
          }

          // V6.8: waterContent 使用品类估算（食物库通常无 waterContent 字段）
          const waterPct =
            Number((food as any).waterContentPercent) ||
            this.estimateWaterContentForLifestyle(food, scoringConfig);
          const waterHighThreshold =
            scoringConfig?.lifestyleWaterHighThreshold ?? 80;
          if (waterPct > waterHighThreshold) {
            foodNutrientValues['waterContent'] = 1;
          }

          let cumulativeDelta = 0;
          for (const [nutrient, delta] of Object.entries(lifestyleAdjustment)) {
            const val = foodNutrientValues[nutrient];
            if (val !== undefined && val > 0) {
              cumulativeDelta += delta;
            }
          }
          lifestyleNutrientBoost = Math.max(
            0.85,
            Math.min(1.15, 1 + cumulativeDelta * 0.05),
          );
        }
        score *= lifestyleNutrientBoost;

        // V6.3 P2-4: 声明偏好加成
        let foodPrefBoost = 1.0;
        const declaredFoodPrefs = (
          ctx.userProfile as EnrichedProfileContext | undefined
        )?.declared?.foodPreferences;
        if (declaredFoodPrefs?.length) {
          const foodTags = food.tags || [];
          const foodCat = food.category || '';
          const foodSubCat = (food as any).subCategory || '';
          const matchCount = declaredFoodPrefs.filter(
            (pref) =>
              foodTags.includes(pref) ||
              foodCat === pref ||
              foodSubCat === pref,
          ).length;
          if (matchCount > 0) {
            foodPrefBoost = 1 + Math.min(matchCount * 0.05, 0.15);
          }
        }
        score *= foodPrefBoost;
        explanation.foodPrefBoost = foodPrefBoost;

        // V6.3 P2-4: 热门食物加成
        let popularityBoost = 1.0;
        const recallConfig = ctx.resolvedStrategy?.config?.recall;
        const popularEnabled = recallConfig?.sources?.popular?.enabled;
        const popularWeight = recallConfig?.sources?.popular?.weight ?? 0;
        if (popularEnabled && popularWeight > 0 && food.popularity > 0) {
          const explorationConfig = ctx.resolvedStrategy?.config?.exploration;
          const matureThreshold = explorationConfig?.matureThreshold ?? 50;
          let totalInteractions = 0;
          if (ctx.feedbackStats) {
            for (const stats of Object.values(ctx.feedbackStats)) {
              totalInteractions +=
                (stats.accepted ?? 0) + (stats.rejected ?? 0);
            }
          }
          const maturity = Math.min(1, totalInteractions / matureThreshold);
          const coldStartFactor = 1 - maturity;
          const normalizedPop = Math.min(food.popularity / 100, 1);
          popularityBoost = 1 + popularWeight * normalizedPop * coldStartFactor;
        }
        score *= popularityBoost;
        explanation.popularityBoost = popularityBoost;

        // V6.6 Phase 2-B: 替换反馈乘数
        const replacementBoost = ctx.replacementWeightMap?.get(food.id) ?? 1.0;
        if (replacementBoost !== 1.0) {
          score *= replacementBoost;
        }
        explanation.replacementBoost = replacementBoost;

        // V6.6 Phase 2-A: 语义补充路 ruleWeight 折扣
        const ruleWeight = (food as any).__ruleWeight as number | undefined;
        if (ruleWeight !== undefined && ruleWeight < 1.0) {
          score *= ruleWeight;
        }

        // 更新 explanation 的 finalScore
        explanation.finalScore = score;

        return {
          food,
          score,
          ...this.foodScorer.calcServingNutrition(food),
          explanation,
        };
      })
      .sort((a, b) => b.score - a.score);

    // V6.4: L2 缓存回写
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
    const diversityMultiplier =
      assemblyConfig?.diversityLevel === 'high'
        ? 1.5
        : assemblyConfig?.diversityLevel === 'low'
          ? 0.5
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
    const rateScale = adaptiveRate / 0.15;

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
        // 成品菜: 基础 boost + dishPriority(0-100) 映射为 0-20% 额外加分
        formMultiplier = isDishPreferredScene
          ? 1.0 + (sf.food.dishPriority || 50) / 500 // 外出场景: 1.10 ~ 1.20
          : 1.0 + (sf.food.dishPriority || 50) / 1000; // 非外出场景: 1.05 ~ 1.10
      } else if (form === 'semi_prepared') {
        // 半成品: 中等 boost
        formMultiplier = isDishPreferredScene ? 1.08 : 1.03;
      } else {
        // 原材料(ingredient): 外出场景适度降权
        formMultiplier = isDishPreferredScene ? 0.9 : 1.0;
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
      allCandidates.push(...finalRanked.slice(0, OPTIMIZER_CANDIDATE_LIMIT));

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

    if (degradations.length > 0) {
      this.logger.warn(
        `Pipeline completed with ${degradations.length} degradation(s): ${degradations.map((d) => d.stage).join(', ')}`,
      );
    }

    return { picks, allCandidates, degradations };
  }

  /**
   * V6.8 Phase 3-F: 多轮冲突解决（从 executeRolePipeline 提取）
   */
  private resolveCompositionConflicts(
    picks: ScoredFood[],
    allCandidates: ScoredFood[],
    usedNames: Set<string>,
  ): void {
    const maxRounds = 3;
    for (let round = 0; round < maxRounds; round++) {
      const compositionScore =
        this.mealCompositionScorer.scoreMealComposition(picks);

      const hasIngredientConflict = compositionScore.ingredientDiversity < 60;
      const hasCookingConflict = compositionScore.cookingMethodDiversity < 50;

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

  // ─── V6.8 Phase 1-B: Lifestyle 含水率估算（从 food-scorer 迁移） ───

  /**
   * 基于品类估算食物含水率。
   * 从 food-scorer.estimateWaterContent 迁移，用于 lifestyle waterContent 信号匹配。
   */
  private estimateWaterContentForLifestyle(
    food: FoodLibrary,
    cfg?: ScoringConfigSnapshot | null,
  ): number {
    const DEFAULT_MAP: Record<string, number> = {
      veggie: 90,
      fruit: 85,
      beverage: 95,
      dairy: 87,
      protein: 65,
      grain: 12,
      composite: 55,
      snack: 5,
      fat: 0,
      condiment: 50,
    };
    const waterMap = cfg?.categoryWaterMap ?? DEFAULT_MAP;
    return waterMap[food.category] ?? 50;
  }
}
