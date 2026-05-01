/**
 * PipelineBuilderService
 *
 * 从 RecommendationEngineService 中提取的推荐管道核心。
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
import { FoodLibrary } from '../../../../food/food.types';
import { GoalType } from '../../services/nutrition-score.service';
import { FoodScorerService } from './food-scorer.service';
import { MealAssemblerService } from '../meal/meal-assembler.service';
import {
  ScoredFood,
  PipelineContext,
  ROLE_CATEGORIES,
  FoodFeedbackStats,
  EnrichedProfileContext,
  PipelineDegradation,
  Constraint,
} from '../types/recommendation.types';
import {
  HealthModifierContext,
  HealthModifierEngineService,
} from '../modifier/health-modifier-engine.service';
import {
  filterByAllergens,
  hasAllergenConflict,
} from '../filter/allergen-filter.util';
import {
  multiObjectiveOptimize,
  extractRankedFoods,
} from '../optimization/multi-objective-optimizer';
import { mapLifestyleToScoringFactors } from '../profile/profile-scoring-mapper';
import { getUserLocalDate } from '../../../../../common/utils/timezone.util';
import { DEFAULT_TIMEZONE } from '../../../../../common/config/regional-defaults';
import { NutritionTargetService } from './nutrition-target.service';
import { SemanticRecallService } from '../recall/semantic-recall.service';
import {
  RecallMergerService,
  SemanticRecallItem,
} from '../recall/recall-merger.service';
import { RealisticFilterService } from '../filter/realistic-filter.service';
import { RegionalCandidateFilterService } from '../filter/regional-candidate-filter.service';
import { foodViolatesDietaryRestriction } from './food-filter.service';
import { LifestyleScoringAdapter } from '../modifier/lifestyle-scoring-adapter.service';
import { ScoringConfigService } from '../context/scoring-config.service';
import { CFRecallService } from '../recall/cf-recall.service';
import { MealCompositionScorer } from '../meal/meal-composition-scorer.service';
import { StrategyAutoTuner } from '../../../../strategy/app/strategy-auto-tuner.service';
import { PreferenceProfileService } from '../profile/preference-profile.service';
import { ScoringChainService } from '../scoring-chain/scoring-chain.service';
import { SeasonalityService } from '../utils/seasonality.service';
import type { RecommendationStrategy } from '../types/recommendation-strategy.types';
import type { PipelineStageTrace } from '../types/pipeline.types';
import { writeStageBuffer, consumeStageBuffer } from '../types/pipeline.types';
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
  PriceFitFactor,
  ChannelAvailabilityFactor,
} from '../scoring-chain/factors';

/**
 * 统一兜底逻辑 — 过滤后候选不足时回退到角色类别全集 Top-N
 *
 * @param filtered  过滤后的候选列表
 * @param beforeCount  过滤前的候选数量
 * @param ctx  管道上下文（allFoods + usedNames）
 * @param roleCategories  当前角色对应的食物类别
 * @param opts  可选配置：minCount（最小候选数，默认3）、fallbackLimit（兜底取前N个，默认10）、
 *              sortFn（兜底列表排序函数，默认无排序）
 * @returns  满足最小候选数的列表（原始列表或兜底列表）
 */
function ensureMinCandidates(
  filtered: FoodLibrary[],
  beforeCount: number,
  ctx: Pick<PipelineContext, 'allFoods' | 'usedNames' | 'constraints'>,
  roleCategories: string[],
  opts?: {
    minCount?: number;
    fallbackLimit?: number;
    sortFn?: (a: FoodLibrary, b: FoodLibrary) => number;
  },
): FoodLibrary[] {
  const min = opts?.minCount ?? 3;
  const limit = opts?.fallbackLimit ?? 10;
  if (filtered.length >= min || beforeCount < min) return filtered;

  let fallback = ctx.allFoods.filter(
    (f) => roleCategories.includes(f.category) && !ctx.usedNames.has(f.name),
  );
  // Bug7-fix: 兜底也必须遵守饮食限制，防止过滤后的肉类食物被重新引入
  if (ctx.constraints?.dietaryRestrictions?.length) {
    fallback = fallback.filter(
      (f) =>
        !foodViolatesDietaryRestriction(
          f,
          ctx.constraints.dietaryRestrictions!,
        ),
    );
  }
  // #fix Bug11/18/19: 兜底也必须遵守 isFried / sodium / purine 硬约束
  if (ctx.constraints?.excludeIsFried) {
    fallback = fallback.filter((f) => !f.isFried);
  }
  if (ctx.constraints?.maxSodium != null) {
    const maxNa = ctx.constraints.maxSodium;
    fallback = fallback.filter((f) => (Number(f.sodium) || 0) <= maxNa);
  }
  if (ctx.constraints?.maxPurine != null) {
    const maxPu = ctx.constraints.maxPurine;
    fallback = fallback.filter((f) => (Number(f.purine) || 0) <= maxPu);
  }
  // #fix Bug31: 兜底也必须遵守 maxFat 硬约束
  if (ctx.constraints?.maxFat != null) {
    const maxFt = ctx.constraints.maxFat;
    fallback = fallback.filter((f) => (Number(f.fat) || 0) <= maxFt);
  }
  if (opts?.sortFn) fallback = fallback.sort(opts.sortFn);
  return fallback.slice(0, limit);
}

@Injectable()
export class PipelineBuilderService implements OnModuleInit {
  private readonly logger = new Logger(PipelineBuilderService.name);

  constructor(
    private readonly foodScorer: FoodScorerService,
    private readonly mealAssembler: MealAssemblerService,
    private readonly healthModifierEngine: HealthModifierEngineService,
    private readonly nutritionTargetService: NutritionTargetService,
    private readonly semanticRecallService: SemanticRecallService,
    private readonly recallMerger: RecallMergerService,
    private readonly realisticFilterService: RealisticFilterService,
    /** 阶段 3.1/3.2：区域候选过滤（availability + 法规） */
    private readonly regionalCandidateFilter: RegionalCandidateFilterService,
    private readonly lifestyleScoringAdapter: LifestyleScoringAdapter,
    private readonly scoringConfigService: ScoringConfigService,
    private readonly cfRecallService: CFRecallService,
    private readonly mealCompositionScorer: MealCompositionScorer,
    private readonly strategyAutoTuner: StrategyAutoTuner,
    /** 偏好信号计算服务（统一 PreferenceSignal） */
    private readonly preferenceProfileService: PreferenceProfileService,
    /** 链式评分管道服务 */
    private readonly scoringChainService: ScoringChainService,
    /** P2-2.2: 区域价格信息（PriceFitFactor 依赖） */
    private readonly seasonalityService: SeasonalityService,
  ) {}

  // ─── 模块初始化时注册 10 个评分因子 ───

  /**
   * 在 NestJS 模块初始化时注册所有 ScoringFactor 到 ScoringChainService。
   *
   * 将 10 个 ScoringFactor 实现注册到链式评分管道。
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
      // 区域+时区优化（阶段 4.1 + P2-2.2）：价格适配软评分
      // P2-2.2: 注入 SeasonalityService.getPriceInfo 让因子能查询食物的区域价格
      new PriceFitFactor((foodId) =>
        this.seasonalityService.getPriceInfo(foodId),
      ),
      // 渠道×时段可获得性（已取代 AvailabilityScorerService，P1-2 已删除）
      new ChannelAvailabilityFactor(),
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
   * 7. 分析画像风险食物过滤 (recentRiskFoods)
   * 8. 兜底: 如果过滤后为空，回退到全集
   */
  async recallCandidates(
    ctx: PipelineContext,
    role: string,
  ): Promise<FoodLibrary[]> {
    // MealPolicy 覆盖角色→品类映射
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

    // #fix Bug7: 饮食限制多字段硬过滤（vegetarian/vegan/pescatarian）
    // excludeTags 中的 "meat" 标签无法覆盖所有肉/鱼类食物，
    // 需要额外检查 foodGroup / mainIngredient / category。
    if (ctx.constraints.dietaryRestrictions?.length) {
      candidates = candidates.filter(
        (f) =>
          !foodViolatesDietaryRestriction(
            f,
            ctx.constraints.dietaryRestrictions!,
          ),
      );
    }

    // #fix Bug11: fat_loss 排除油炸食物（isFried 字段硬过滤）
    if (ctx.constraints.excludeIsFried) {
      candidates = candidates.filter((f) => !f.isFried);
    }

    // #fix Bug18: 钠含量硬过滤（low_sodium / hypertension）
    if (ctx.constraints.maxSodium != null) {
      const maxNa = ctx.constraints.maxSodium;
      candidates = candidates.filter((f) => (Number(f.sodium) || 0) <= maxNa);
    }

    // #fix Bug19: 嘌呤硬过滤（gout）
    if (ctx.constraints.maxPurine != null) {
      const maxPu = ctx.constraints.maxPurine;
      candidates = candidates.filter((f) => (Number(f.purine) || 0) <= maxPu);
    }

    // #fix Bug31: 脂肪硬过滤（low_fat 饮食限制）
    if (ctx.constraints.maxFat != null) {
      const maxFt = ctx.constraints.maxFat;
      candidates = candidates.filter((f) => (Number(f.fat) || 0) <= maxFt);
    }

    // 过敏原过滤 — 统一使用 allergen-filter.util (V4 A6)
    if (ctx.userProfile?.allergens?.length) {
      candidates = filterByAllergens(candidates, ctx.userProfile.allergens);
    }

    // 召回阶段 commonality/budget 快速预过滤
    // 将 RealisticFilter 中代价最低的两项基础过滤上移到召回阶段，
    // 在三路合并和后续评分之前就减少候选数量，避免对不可能通过现实性过滤的食物做无用评分。
    {
      const realismConfig = ctx.resolvedStrategy?.config?.realism;
      const commonalityThreshold = realismConfig?.commonalityThreshold ?? 20;
      if (commonalityThreshold > 0 && realismConfig?.enabled !== false) {
        const beforeCount = candidates.length;
        candidates = candidates.filter(
          (f) => (f.commonalityScore ?? 50) >= commonalityThreshold,
        );
        candidates = ensureMinCandidates(
          candidates,
          beforeCount,
          ctx,
          roleCategories,
          {
            sortFn: (a, b) =>
              (b.commonalityScore ?? 50) - (a.commonalityScore ?? 50),
          },
        );
      }
      if (
        realismConfig?.budgetFilterEnabled &&
        realismConfig?.enabled !== false
      ) {
        const budgetLevel = ctx.userProfile?.budgetLevel;
        if (budgetLevel) {
          const BUDGET_CAP: Record<string, number> = {
            low: 3,
            medium: 4,
            high: 5,
          };
          const maxCost = BUDGET_CAP[budgetLevel] ?? 5;
          candidates = candidates.filter(
            (f) => (f.estimatedCostLevel ?? 2) <= maxCost,
          );
        }
      }
    }

    // 烹饪技能过滤 — beginner 用户排除 advanced 菜品
    if (ctx.userProfile?.cookingSkillLevel === 'beginner') {
      const beforeCount = candidates.length;
      candidates = candidates.filter((f) => f.skillRequired !== 'advanced');
      candidates = ensureMinCandidates(
        candidates,
        beforeCount,
        ctx,
        roleCategories,
      );
    }

    // 短期画像 — 过滤近 7 天频繁拒绝的食物
    // 拒绝阈值可通过 RecallPolicy 配置（默认 2 次）
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
        candidates = ensureMinCandidates(
          candidates,
          beforeCount,
          ctx,
          roleCategories,
        );
      }
    }

    // 分析画像 — 过滤近期被标记为 caution/avoid 的风险食物
    if (ctx.analysisProfile?.recentRiskFoods?.length) {
      const riskFoodSet = new Set(ctx.analysisProfile.recentRiskFoods);
      const beforeCount = candidates.length;
      candidates = candidates.filter((f) => !riskFoodSet.has(f.name));
      candidates = ensureMinCandidates(
        candidates,
        beforeCount,
        ctx,
        roleCategories,
      );
    }

    // 获取渠道过滤 — 按 available_channels 字段过滤
    // channel=unknown 时跳过过滤（保留全量候选）
    //
    // #fix Bug29: 食物的 available_channels 使用"购买渠道"词汇（supermarket, wet_market 等），
    // 而 AcquisitionChannel 使用"消费场景"词汇（home_cook, delivery 等）。
    // 需要映射：消费场景 → 可能的购买渠道，否则几乎所有食物都会被过滤掉。
    if (ctx.channel && ctx.channel !== 'unknown') {
      // 消费场景 → 对应的购买渠道（如果食物可从这些渠道获得，则视为该场景可用）
      const CHANNEL_TO_SOURCES: Record<string, string[]> = {
        home_cook: [
          'supermarket',
          'wet_market',
          'farmers_market',
          'online',
          'specialty_store',
          'butcher',
          'butcher_shop',
          'bakery',
          'pharmacy',
          'traditional_chinese_medicine_store',
          'chinese_medicine_store',
        ],
        delivery: [
          'restaurant',
          'takeout',
          'fast_food',
          'delivery',
          'convenience_store',
          'bakery',
        ],
        restaurant: ['restaurant'],
        convenience: [
          'convenience_store',
          'convenience',
          'supermarket',
          'bakery',
        ],
        canteen: ['restaurant', 'canteen'],
      };
      const acceptableSources = CHANNEL_TO_SOURCES[ctx.channel] ?? [];
      const beforeCount = candidates.length;

      if (acceptableSources.length > 0) {
        candidates = candidates.filter((f) => {
          const channels = f.availableChannels;
          // 没有设置渠道的食物默认所有渠道可用
          if (!channels || channels.length === 0) return true;
          // 食物的购买渠道与当前消费场景对应的购买渠道有交集 → 保留
          return channels.some((ch) => acceptableSources.includes(ch));
        });
      } else {
        // 未知的消费场景 → 直接用原始匹配逻辑
        candidates = candidates.filter((f) => {
          const channels = f.availableChannels;
          if (!channels || channels.length === 0) return true;
          return channels.includes(ctx.channel!);
        });
      }
      candidates = ensureMinCandidates(
        candidates,
        beforeCount,
        ctx,
        roleCategories,
      );
    }

    // 三路召回合并 — 语义路 + CF 路补充候选 + RecallMergerService 去重
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
        //    Bug4-fix: 语义路也要遵守 mealType 门控，防止 breakfast 食物泄漏到 lunch
        const semanticIdSet = new Set(semanticIds);
        const semanticItems: SemanticRecallItem[] = ctx.allFoods
          .filter(
            (f) =>
              semanticIdSet.has(f.id) &&
              !ctx.usedNames.has(f.name) &&
              roleCategories.includes(f.category) &&
              ((f.mealTypes || []).length === 0 ||
                (f.mealTypes || []).includes(ctx.mealType)),
          )
          .map((f) => ({ food: f, semanticScore: 0.5 }));

        // 3. CF 召回第三路
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
        const ruleCandidateCount = candidates.length;
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

        // 类型安全的 stageBuffer 替代
        if (ctx.trace) {
          writeStageBuffer(ctx.trace, 'recallMerge', {
            ruleCandidates: ruleCandidateCount,
            semanticCandidates: semanticItems.length,
            cfCandidates: cfCandidates.length,
            mergedTotal: candidates.length,
          });
        }
      } catch (err) {
        // 语义/CF召回失败不影响主流程，降级为纯规则路
        this.logger.debug(`三路召回降级: ${(err as Error).message}`);
      }
    }

    // Bug4-fix: 三路合并后统一 mealType 门控 — 确保语义路/CF路的候选也遵守餐次约束
    candidates = candidates.filter((f) => {
      const foodMealTypes: string[] = f.mealTypes || [];
      return foodMealTypes.length === 0 || foodMealTypes.includes(ctx.mealType);
    });

    // 兜底: 无候选时回退到全集（排除已选 + mealType 门控 + 饮食限制）
    if (candidates.length === 0) {
      candidates = ctx.allFoods.filter((f) => {
        if (ctx.usedNames.has(f.name)) return false;
        const foodMealTypes: string[] = f.mealTypes || [];
        if (foodMealTypes.length > 0 && !foodMealTypes.includes(ctx.mealType))
          return false;
        // Bug7: 兜底也必须遵守饮食限制
        if (
          ctx.constraints.dietaryRestrictions?.length &&
          foodViolatesDietaryRestriction(f, ctx.constraints.dietaryRestrictions)
        )
          return false;
        return true;
      });
    }

    return candidates;
  }

  // ─── Stage 2: Rank（精排评分） ───

  /**
   * 精排阶段 — 多维评分 + 偏好加权
   */
  async rankCandidates(
    ctx: PipelineContext,
    candidates: FoodLibrary[],
  ): Promise<ScoredFood[]> {
    return this.rankCandidatesViaChain(ctx, candidates);
  }

  /**
   * 链式评分管道实现
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
      import('../modifier/health-modifier-engine.service').HealthModifierResult
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
        dailyTarget: ctx.dailyTarget,
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
        // 区域+时区优化（阶段 1.2）：透传用户本地月份给 SeasonalityService
        currentMonth: ctx.currentMonth,
        // P3-3.4：透传区域码，南半球地区会触发月份翻转
        regionCode: ctx.regionCode,
      });

      return { food, score: detailed.score, explanation: detailed.explanation };
    });

    const baseFoods = baseResults.map((r) => r.food);
    const baseScores = baseResults.map((r) => r.score);
    const baseExplanations = baseResults.map((r) => r.explanation);

    // Phase B: 链式评分管道
    // 合并推荐策略的 factorStrengthOverrides 到 factorAdjustments
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

    // 从 healthModifierCache 提取否决列表，写入 trace stageBuffer
    if (ctx.trace) {
      const vetoedFoods: string[] = [];
      for (const [foodId, result] of healthModifierCache.entries()) {
        if (result.isVetoed) {
          const food = candidates.find((f) => f.id === foodId);
          vetoedFoods.push(food?.name ?? foodId);
        }
      }
      writeStageBuffer(ctx.trace, 'healthModifier', {
        totalEvaluated: healthModifierCache.size,
        vetoedCount: vetoedFoods.length,
        vetoedFoods,
      });
    }

    return scored;
  }

  /**
   * 统一构建个性化营养目标
   */
  buildNutritionTargets(enrichedCtx?: EnrichedProfileContext) {
    // P2-R4: 年龄计算改用用户本地年份（基于 timezone），避免服务器跨时区跨年误差
    const userLocalYear = enrichedCtx?.timezone
      ? parseInt(getUserLocalDate(enrichedCtx.timezone).slice(0, 4), 10)
      : parseInt(getUserLocalDate(DEFAULT_TIMEZONE).slice(0, 4), 10);
    return this.nutritionTargetService.calculate(
      enrichedCtx?.declared
        ? {
            gender: enrichedCtx.declared.gender,
            age: enrichedCtx.declared.birthYear
              ? userLocalYear - enrichedCtx.declared.birthYear
              : undefined,
            goal: enrichedCtx.declared.goal as GoalType | undefined,
            weightKg: enrichedCtx.declared.weightKg,
            healthConditions: enrichedCtx.declared.healthConditions,
          }
        : undefined,
    );
  }

  /**
   * 合并推荐策略的 factorStrengthOverrides 到 PipelineContext.factorAdjustments
   *
   * 合并规则：
   * - 如果 FactorLearner 已有学习强度，与策略强度相乘
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
   * 获取当前推荐策略（如果已设置）
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

    // 从策略配置读取相似度惩罚系数
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

    // 自适应探索率
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

    // 自适应探索率（收敛度 + StrategyAutoTuner）
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
        // 原材料(ingredient): 所有场景均降权，外出场景更强
        // Bug5-fix: 从 1.0(非外出) 改为 0.85，减少 ingredient 入选概率
        formMultiplier = isDishPreferredScene
          ? (tuning?.ingredientMultiplierScene ?? 0.9)
          : (tuning?.ingredientMultiplierNormal ?? 0.85);
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
    dietaryRestrictions?: string[],
    constraints?: Constraint,
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
          !usedNames.has(c.food.name) &&
          // Bug7-fix: 替换时必须遵守饮食限制
          !(
            dietaryRestrictions?.length &&
            foodViolatesDietaryRestriction(c.food, dietaryRestrictions)
          ) &&
          // Bug11/18/19-fix: 替换时遵守硬约束
          !(constraints?.excludeIsFried && c.food.isFried) &&
          !(
            constraints?.maxSodium &&
            (c.food.sodium ?? 0) > constraints.maxSodium
          ) &&
          !(
            constraints?.maxPurine &&
            (Number(c.food.purine) || 0) > constraints.maxPurine
          ) &&
          !(
            constraints?.maxFat &&
            (Number(c.food.fat) || 0) > constraints.maxFat
          ),
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
    dietaryRestrictions?: string[],
    constraints?: Constraint,
  ): void {
    const methodCount = new Map<string, number>();
    for (const p of picks) {
      const method = p.food.cookingMethods?.[0]?.toLowerCase();
      if (method) methodCount.set(method, (methodCount.get(method) ?? 0) + 1);
    }

    for (const [method, count] of methodCount) {
      if (count <= 1) continue;

      const duplicates = picks
        .filter((p) => p.food.cookingMethods?.[0]?.toLowerCase() === method)
        .sort((a, b) => a.score - b.score);
      const weakest = duplicates[0];
      const weakIdx = picks.indexOf(weakest);
      if (weakIdx === -1) continue;

      const usedMethods = new Set(
        picks
          .map((p) => p.food.cookingMethods?.[0]?.toLowerCase())
          .filter(Boolean) as string[],
      );
      const replacement = candidates.find(
        (c) =>
          c.food.category === weakest.food.category &&
          c.food.cookingMethods?.length &&
          !usedMethods.has(c.food.cookingMethods[0].toLowerCase()) &&
          !usedNames.has(c.food.name) &&
          // Bug7-fix: 替换时必须遵守饮食限制
          !(
            dietaryRestrictions?.length &&
            foodViolatesDietaryRestriction(c.food, dietaryRestrictions)
          ) &&
          // Bug11/18/19-fix: 替换时遵守硬约束
          !(constraints?.excludeIsFried && c.food.isFried) &&
          !(
            constraints?.maxSodium &&
            (c.food.sodium ?? 0) > constraints.maxSodium
          ) &&
          !(
            constraints?.maxPurine &&
            (Number(c.food.purine) || 0) > constraints.maxPurine
          ) &&
          !(
            constraints?.maxFat &&
            (Number(c.food.fat) || 0) > constraints.maxFat
          ),
      );

      if (replacement) {
        this.logger.debug(
          `整餐 Rerank: 替换重复烹饪方式 "${weakest.food.name}"(${method}) → "${replacement.food.name}"(${replacement.food.cookingMethods?.[0]})`,
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
    const trace = ctx.trace; // 管道追踪（可选）

    for (const role of roles) {
      // Stage 1: Recall
      let recalled: FoodLibrary[];
      const recallStart = trace ? Date.now() : 0;
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
        // Fallback: 使用全量食物池（仅做基本的过敏原/已选排除 + 饮食限制）
        recalled = ctx.allFoods.filter((f) => {
          if (usedNames.has(f.name)) return false;
          if (
            ctx.constraints.dietaryRestrictions?.length &&
            foodViolatesDietaryRestriction(
              f,
              ctx.constraints.dietaryRestrictions,
            )
          )
            return false;
          return true;
        });
      }
      if (trace) {
        // 从 stageBuffer 读取并清除三路召回详情
        const recallMergeDetails =
          consumeStageBuffer(trace, 'recallMerge') ?? {};

        const stageTrace: PipelineStageTrace = {
          stage: 'recall',
          durationMs: Date.now() - recallStart,
          inputCount: ctx.allFoods.length,
          outputCount: recalled.length,
          details: { role, ...recallMergeDetails },
        };
        trace.stages.push(stageTrace);
      }

      // 现实性过滤
      let realistic: FoodLibrary[];
      const filterStart = trace ? Date.now() : 0;
      const recalledCount = recalled.length;
      try {
        realistic = this.realisticFilterService.filterByRealism(
          recalled,
          ctx,
          sceneAdjustedRealism,
          ctx.kitchenProfile,
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

      // 阶段 3.1/3.2：区域候选过滤（availability + 法规禁止）
      realistic = this.regionalCandidateFilter.filter(
        realistic,
        ctx.regionCode ?? 'unknown',
      );

      // 推荐策略 — acquisitionDifficulty 过滤
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
      if (trace) {
        // 从 stageBuffer 读取并清除现实性过滤详情
        const filterDetails =
          consumeStageBuffer(trace, 'realisticFilter') ?? {};

        const stageTrace: PipelineStageTrace = {
          stage: 'realistic_filter',
          durationMs: Date.now() - filterStart,
          inputCount: recalledCount,
          outputCount: realistic.length,
          details: { role, ...filterDetails },
        };
        trace.stages.push(stageTrace);
      }

      // Stage 2: Rank
      let ranked: ScoredFood[];
      const rankStart = trace ? Date.now() : 0;
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
      if (trace) {
        // 从 stageBuffer 读取并清除评分链和健康修正详情
        const chainDetails = consumeStageBuffer(trace, 'scoringChain') ?? {};

        const healthDetails = consumeStageBuffer(trace, 'healthModifier') ?? {};

        const stageTrace: PipelineStageTrace = {
          stage: 'rank',
          durationMs: Date.now() - rankStart,
          inputCount: realistic.length,
          outputCount: ranked.length,
          details: {
            role,
            scoringChain: chainDetails,
            healthModifier: healthDetails,
          },
        };
        trace.stages.push(stageTrace);
      }

      // 多目标优化（永远启用 — 根因#1 修复：去掉 enabled gate，
      // 改为策略通过 preferences 权重控制各维度影响力，避免默认路径退回 10 维健康排序）
      let finalRanked: ScoredFood[];
      try {
        const moConfig = ctx.resolvedStrategy?.config?.multiObjective ?? {};
        finalRanked =
          ranked.length > 0
            ? extractRankedFoods(
                multiObjectiveOptimize(
                  ranked,
                  moConfig,
                  undefined,
                  ctx.dailyTarget,
                  ctx.mealType,
                  ctx.goalType,
                ),
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

      // 收集候选
      const optimizerLimit = ctx.tuning?.optimizerCandidateLimit ?? 8;
      allCandidates.push(...finalRanked.slice(0, optimizerLimit));

      // Stage 3: Rerank → Top-1
      let selected: ScoredFood | null;
      const rerankStart = trace ? Date.now() : 0;
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
      if (trace) {
        const stageTrace: PipelineStageTrace = {
          stage: 'rerank',
          durationMs: Date.now() - rerankStart,
          inputCount: finalRanked.length,
          outputCount: selected ? 1 : 0,
          details: {
            role,
            selectedFood: selected?.food.name ?? null,
            selectedScore: selected?.score ?? null,
          },
        };
        trace.stages.push(stageTrace);
      }

      if (selected) {
        // P-α 修复：累积脂肪/碳水预算检查
        // rerankAndSelect 只看单食物得分，多角色各自选出的高脂 Top-1 累加后
        // 常使本餐总脂肪超标 2-3×（食物过滤器的 80% 单份上限无法跨角色累积）。
        // 这里在每轮角色选出后，检查 cumFat/cumCarbs 是否越过 maxMealFat/maxMealCarbs，
        // 若越过则从同角色 finalRanked 中寻找首个得分最高且仍在预算内的替代。
        const picksFatSoFar = picks.reduce(
          (s, p) => s + (p.servingFat || 0),
          0,
        );
        const picksCarbsSoFar = picks.reduce(
          (s, p) => s + (p.servingCarbs || 0),
          0,
        );
        const maxFat = ctx.constraints.maxMealFat;
        const maxCarbs = ctx.constraints.maxMealCarbs;
        const overflowsFat =
          maxFat != null &&
          maxFat > 0 &&
          picksFatSoFar + (selected.servingFat || 0) > maxFat;
        const overflowsCarbs =
          maxCarbs != null &&
          maxCarbs > 0 &&
          picksCarbsSoFar + (selected.servingCarbs || 0) > maxCarbs;

        if (overflowsFat || overflowsCarbs) {
          const alt = finalRanked.find((cand) => {
            if (cand.food.name === selected!.food.name) return false;
            if (usedNames.has(cand.food.name)) return false;
            const fatOk =
              maxFat == null ||
              maxFat <= 0 ||
              picksFatSoFar + (cand.servingFat || 0) <= maxFat;
            const carbsOk =
              maxCarbs == null ||
              maxCarbs <= 0 ||
              picksCarbsSoFar + (cand.servingCarbs || 0) <= maxCarbs;
            return fatOk && carbsOk;
          });
          if (alt) {
            this.logger.debug(
              `[P-α cumFatGuard] role=${role} 原选 ${selected.food.name}` +
                `(fat=${(selected.servingFat || 0).toFixed(1)}g, carbs=${(selected.servingCarbs || 0).toFixed(1)}g) ` +
                `累积超限 cumFat=${(picksFatSoFar + (selected.servingFat || 0)).toFixed(1)}/${maxFat?.toFixed(1) ?? '∞'}, ` +
                `cumCarbs=${(picksCarbsSoFar + (selected.servingCarbs || 0)).toFixed(1)}/${maxCarbs?.toFixed(1) ?? '∞'} → ` +
                `替换为 ${alt.food.name}(fat=${(alt.servingFat || 0).toFixed(1)}g, carbs=${(alt.servingCarbs || 0).toFixed(1)}g)`,
            );
            selected = alt;
          } else {
            // 无替代则保留原选（降级），打日志供诊断
            this.logger.debug(
              `[P-α cumFatGuard] role=${role} 无可替代候选，保留原选 ${selected.food.name}（本餐总脂肪/碳水将超预算）`,
            );
          }
        }

        picks.push(selected);
        usedNames.add(selected.food.name);
      }
    }

    // P-β 修复：累积蛋白下限守门（与 P-α cumFatGuard 对称）
    // 角色循环仅单食物 top-1，即使每角色评分最佳，累加后本餐蛋白常低于目标 30-50%，
    // 尤其 habit/fat_loss 目标（蛋白比例 25-35%），饮料/配菜角色拉低总 P。
    // 这里在角色循环结束后，若 cumProtein < targetMealProtein × 0.85，
    // 从 allCandidates 中寻找高蛋白替代，换掉 picks 中蛋白最低的槽位，
    // 同时保持 fat/carbs 仍在 maxMealFat/maxMealCarbs 预算内。最多交换 3 次。
    const targetProtein = ctx.constraints.targetMealProtein;
    if (targetProtein != null && targetProtein > 0 && picks.length > 0) {
      const proteinFloor = targetProtein * 0.85;
      const maxFatBudget = ctx.constraints.maxMealFat;
      const maxCarbsBudget = ctx.constraints.maxMealCarbs;
      const targetKcal = ctx.constraints.targetMealCalories;
      let cumProtein = picks.reduce((s, p) => s + (p.servingProtein || 0), 0);
      // P-ε 阶段 2 修复：严格饮食下（素食/多过敏/糖尿病）3 次交换常常不足以补齐蛋白，
      // 扩展到 8 次并在仍不达标且 kcal 仍有空间时 ADD 高蛋白补充项。
      for (let tries = 0; tries < 8 && cumProtein < proteinFloor; tries++) {
        let worstIdx = -1;
        let worstProtein = Infinity;
        for (let i = 0; i < picks.length; i++) {
          const pp = picks[i].servingProtein || 0;
          if (pp < worstProtein) {
            worstProtein = pp;
            worstIdx = i;
          }
        }
        if (worstIdx < 0) break;
        const worst = picks[worstIdx];
        const restFat = picks.reduce(
          (s, p, i) => (i === worstIdx ? s : s + (p.servingFat || 0)),
          0,
        );
        const restCarbs = picks.reduce(
          (s, p, i) => (i === worstIdx ? s : s + (p.servingCarbs || 0)),
          0,
        );
        const worstCal = worst.servingCalories || 0;
        const alt = allCandidates
          .filter(
            (c) =>
              !usedNames.has(c.food.name) &&
              (c.servingProtein || 0) > (worst.servingProtein || 0) + 2,
          )
          // 卡路里等效：替代食物的热量不能少于被换食物的 70%，避免整餐变稀
          .filter(
            (c) => worstCal <= 0 || (c.servingCalories || 0) >= worstCal * 0.7,
          )
          .filter(
            (c) =>
              maxFatBudget == null ||
              maxFatBudget <= 0 ||
              restFat + (c.servingFat || 0) <= maxFatBudget,
          )
          .filter(
            (c) =>
              maxCarbsBudget == null ||
              maxCarbsBudget <= 0 ||
              restCarbs + (c.servingCarbs || 0) <= maxCarbsBudget,
          )
          .sort((a, b) => (b.servingProtein || 0) - (a.servingProtein || 0))[0];
        if (!alt) break;
        this.logger.debug(
          `[P-β proteinFloor] cumP=${cumProtein.toFixed(1)}/${proteinFloor.toFixed(1)} ` +
            `换 ${worst.food.name}(P=${(worst.servingProtein || 0).toFixed(1)}g) → ` +
            `${alt.food.name}(P=${(alt.servingProtein || 0).toFixed(1)}g)`,
        );
        usedNames.delete(worst.food.name);
        usedNames.add(alt.food.name);
        picks[worstIdx] = alt;
        cumProtein = picks.reduce((s, p) => s + (p.servingProtein || 0), 0);
      }

      // P-ε 阶段 2：swap 耗尽仍不达标 → 仅当 kcal 仍有明显空间（< target × 0.95）时 ADD 高蛋白补充项。
      // 这一限制防止 ADD 在已接近 kcal 目标的场景（如 baseline）推升总热量。
      const MAX_PICKS = 6;
      if (cumProtein < proteinFloor && picks.length < MAX_PICKS) {
        let cumCal = picks.reduce((s, p) => s + (p.servingCalories || 0), 0);
        let cumFat = picks.reduce((s, p) => s + (p.servingFat || 0), 0);
        let cumCarbs = picks.reduce((s, p) => s + (p.servingCarbs || 0), 0);
        // 允许 ADD 的条件：kcal 离目标还有 ≥5% 空间
        const kcalCeiling =
          targetKcal != null && targetKcal > 0 ? targetKcal * 1.02 : Infinity;
        const kcalAddThreshold =
          targetKcal != null && targetKcal > 0 ? targetKcal * 0.95 : Infinity;
        for (
          let addTries = 0;
          addTries < 4 &&
          cumProtein < proteinFloor &&
          picks.length < MAX_PICKS &&
          cumCal < kcalAddThreshold;
          addTries++
        ) {
          const supplement = allCandidates
            .filter(
              (c) =>
                !usedNames.has(c.food.name) &&
                (c.servingProtein || 0) >= 5 &&
                cumCal + (c.servingCalories || 0) <= kcalCeiling &&
                (maxFatBudget == null ||
                  maxFatBudget <= 0 ||
                  cumFat + (c.servingFat || 0) <= maxFatBudget) &&
                (maxCarbsBudget == null ||
                  maxCarbsBudget <= 0 ||
                  cumCarbs + (c.servingCarbs || 0) <= maxCarbsBudget),
            )
            .sort(
              (a, b) => (b.servingProtein || 0) - (a.servingProtein || 0),
            )[0];
          if (!supplement) break;
          this.logger.debug(
            `[P-ε proteinFloorAdd] cumP=${cumProtein.toFixed(1)}/${proteinFloor.toFixed(1)} ` +
              `ADD ${supplement.food.name}(P=${(supplement.servingProtein || 0).toFixed(1)}g, ` +
              `cal=${(supplement.servingCalories || 0).toFixed(0)})`,
          );
          picks.push(supplement);
          usedNames.add(supplement.food.name);
          cumProtein += supplement.servingProtein || 0;
          cumCal += supplement.servingCalories || 0;
          cumFat += supplement.servingFat || 0;
          cumCarbs += supplement.servingCarbs || 0;
        }
      }
    }

    // 多轮冲突解决（最多 3 轮，无冲突时提前退出）
    const assembleStart = trace ? Date.now() : 0;
    if (picks.length >= 2) {
      try {
        this.resolveCompositionConflicts(
          picks,
          allCandidates,
          usedNames,
          ctx.constraints.dietaryRestrictions,
          ctx.constraints,
        );
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

    // 推荐策略 — maxSameCategory 同品类限制
    // 如果策略设定了最大同品类食物数量，超出时替换最低分的重复品类食物
    const recStrategyFinal = this.getRecommendationStrategy(ctx);
    if (recStrategyFinal && picks.length >= 2) {
      try {
        this.enforceMaxSameCategory(
          picks,
          allCandidates,
          usedNames,
          recStrategyFinal.rerank.maxSameCategory,
          ctx.constraints.dietaryRestrictions,
          ctx.constraints,
        );
      } catch (e) {
        this.logger.debug(`maxSameCategory enforcement failed, skipping: ${e}`);
      }
    }
    if (trace) {
      trace.stages.push({
        stage: 'assemble',
        durationMs: Date.now() - assembleStart,
        inputCount: picks.length,
        outputCount: picks.length,
        details: {
          conflictResolutionApplied: picks.length >= 2,
          maxSameCategoryApplied: !!(recStrategyFinal && picks.length >= 2),
        },
      });
    }

    if (degradations.length > 0) {
      this.logger.warn(
        `Pipeline completed with ${degradations.length} degradation(s): ${degradations.map((d) => d.stage).join(', ')}`,
      );
    }

    // 填充 trace summary
    if (trace) {
      trace.completedAt = Date.now();

      // 构建候选数流转路径 — 从各阶段的 inputCount→outputCount 中提取
      const recallStages = trace.stages.filter((s) => s.stage === 'recall');
      const filterStages = trace.stages.filter(
        (s) => s.stage === 'realistic_filter',
      );
      const rankStages = trace.stages.filter((s) => s.stage === 'rank');
      const flowParts: number[] = [];
      if (recallStages.length > 0)
        flowParts.push(recallStages[0].inputCount, recallStages[0].outputCount);
      if (filterStages.length > 0) flowParts.push(filterStages[0].outputCount);
      if (rankStages.length > 0) flowParts.push(rankStages[0].outputCount);
      flowParts.push(picks.length);

      // 去除连续重复值
      const deduped = flowParts.filter(
        (v, i) => i === 0 || v !== flowParts[i - 1],
      );

      trace.summary = {
        totalDurationMs: trace.completedAt - trace.startedAt,
        candidateFlowPath: deduped.join('→'),
        strategyName:
          ctx.resolvedStrategy?.strategyName ??
          ctx.recommendationStrategy?.strategy?.name ??
          '',
        sceneName: ctx.sceneContext?.sceneType ?? '',
        realismLevel: String(sceneAdjustedRealism?.level ?? ''),
        degradations: degradations.map((d) => d.stage),
        cacheHit: false, // 由上游调用方覆盖
      };
    }

    return { picks, allCandidates, degradations };
  }

  /**
   * 同品类数量限制
   *
   * 检查 picks 中每个品类的食物数量是否超过 maxSameCategory，
   * 如果超过则用候选中不同品类的食物替换最低分的重复品类食物。
   */
  private enforceMaxSameCategory(
    picks: ScoredFood[],
    candidates: ScoredFood[],
    usedNames: Set<string>,
    maxSameCategory: number,
    dietaryRestrictions?: string[],
    constraints?: Constraint,
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
          (c) =>
            c.food.category !== category &&
            !usedNames.has(c.food.name) &&
            // Bug7-fix: 替换时必须遵守饮食限制
            !(
              dietaryRestrictions?.length &&
              foodViolatesDietaryRestriction(c.food, dietaryRestrictions)
            ) &&
            // Bug11/18/19-fix: 替换时遵守硬约束
            !(constraints?.excludeIsFried && c.food.isFried) &&
            !(
              constraints?.maxSodium &&
              (c.food.sodium ?? 0) > constraints.maxSodium
            ) &&
            !(
              constraints?.maxPurine &&
              (Number(c.food.purine) || 0) > constraints.maxPurine
            ) &&
            !(
              constraints?.maxFat &&
              (Number(c.food.fat) || 0) > constraints.maxFat
            ),
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
   * 多轮冲突解决（从 executeRolePipeline 提取）
   */
  private resolveCompositionConflicts(
    picks: ScoredFood[],
    allCandidates: ScoredFood[],
    usedNames: Set<string>,
    dietaryRestrictions?: string[],
    constraints?: Constraint,
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
        this.resolveIngredientConflicts(
          picks,
          allCandidates,
          usedNames,
          dietaryRestrictions,
          constraints,
        );
      }
      if (hasCookingConflict) {
        this.resolveCookingMethodConflicts(
          picks,
          allCandidates,
          usedNames,
          dietaryRestrictions,
          constraints,
        );
      }

      const picksAfter = picks.map((p) => p.food.name).join(',');
      if (picksBefore === picksAfter) {
        this.logger.debug(`冲突解决第 ${round + 1} 轮无变化，停止迭代`);
        break;
      }
    }
  }

  // ─── TS 收敛度计算 ───

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
