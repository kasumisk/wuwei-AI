import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  MealPlan,
  MealFoodItem,
  MealFoodExplanation,
  PlanAdjustment,
  MealType,
} from '../../diet.types';
import { UserProfiles as UserProfile } from '@prisma/client';
import { FoodLibrary } from '../../../food/food.types';
import { FoodService } from './food.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { NutritionScoreService } from './nutrition-score.service';
import { RecommendationEngineService } from './recommendation-engine.service';
import { PreferenceProfileService } from '../recommendation/profile/preference-profile.service';
import { RecommendationFeedbackService } from '../recommendation/feedback/feedback.service';
import { ExplanationGeneratorService } from '../recommendation/explanation/explanation-generator.service';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import {
  MEAL_RATIOS,
  FoodFeedbackStats,
  UserPreferenceProfile,
  UserProfileConstraints,
  MealRecommendation,
  ROLE_CATEGORIES,
  MealTarget,
} from '../recommendation/types/recommendation.types';
import {
  optimizeDailyPlan,
  MealSlot,
} from '../recommendation/optimization/global-optimizer';
import { getSupportedLocales, t } from '../recommendation/utils/i18n-messages';
import { normalizeDietLocale } from '../recommendation/utils/locale.util';
import {
  getUserLocalDate,
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../../common/utils/timezone.util';
import { ProfileResolverService } from '../../../user/app/services/profile/profile-resolver.service';
import { StrategyResolver } from '../../../strategy/app/strategy-resolver.service';
import type { ExplainPolicyConfig } from '../../../strategy/strategy.types';
import { AdaptiveExplanationDepthService } from '../recommendation/explanation/adaptive-explanation-depth.service';
import { RequestContextService } from '../../../../core/context/request-context.service';
import type { Locale } from '../recommendation/utils/i18n-messages';
import { FoodI18nService } from './food-i18n.service';

/**
 * V5 2.5: 预加载上下文 — 周计划批量生成时一次性查询，避免 N天×5 次重复 DB 查询
 */
export interface PreloadedContext {
  profile: UserProfile | null;
  allFoods: FoodLibrary[];
  recentFoodNames: string[];
  feedbackStats: Record<string, FoodFeedbackStats>;
  preferenceProfile: UserPreferenceProfile;
  regionalBoostMap: Record<string, number>;
}

/**
 * V4 Phase 2.6 — toMealPlan 转换逻辑统一 (A5)
 *
 * 将 MealRecommendation → MealPlan 的转换提取为共享函数，
 * 消除 generatePlan() 和 adjustPlanForCurrentProgress() 的重复定义。
 */

/** MealRecommendation 兼容输入 — 同时支持完整 ScoredFood 和简化结构 */
interface MealRecLike {
  displayText: string;
  foods: Array<{
    food: {
      id: string;
      name: string;
      displayName?: string;
      standardServingDesc?: string;
      standardServingG: number;
      category: string;
    };
    servingCalories: number;
    servingProtein: number;
    servingFat: number;
    servingCarbs: number;
  }>;
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  tip: string;
}

function toMealPlan(
  rec: MealRecLike,
  explanations?: Record<string, MealFoodExplanation>,
): MealPlan {
  return {
    foods: rec.displayText,
    foodItems: Array.isArray(rec.foods)
      ? rec.foods.map(
          (sf): MealFoodItem => ({
            foodId: sf.food?.id ?? '',
            name: sf.food?.displayName ?? sf.food?.name ?? '',
            servingDesc:
              sf.food?.standardServingDesc ||
              `${sf.food?.standardServingG || 100}g`,
            calories: sf.servingCalories ?? 0,
            protein: sf.servingProtein ?? 0,
            fat: sf.servingFat ?? 0,
            carbs: sf.servingCarbs ?? 0,
            category: sf.food?.category ?? '',
          }),
        )
      : undefined,
    calories: rec.totalCalories,
    protein: rec.totalProtein,
    fat: rec.totalFat,
    carbs: rec.totalCarbs,
    tip: rec.tip,
    explanations,
  };
}

/**
 * V6.5 Phase 2L: 根据食物 category 反查角色
 * ROLE_CATEGORIES: { carb: ['grain','composite'], protein: ['protein','dairy'], ... }
 * 返回匹配的第一个 role，无匹配时返回 'side'
 */
function categoryToRole(category: string): string {
  for (const [role, cats] of Object.entries(ROLE_CATEGORIES)) {
    if (cats.includes(category)) return role;
  }
  return 'side';
}

@Injectable()
export class DailyPlanService {
  private readonly logger = new Logger(DailyPlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly recommendationEngine: RecommendationEngineService,
    private readonly explanationGenerator: ExplanationGeneratorService,
    private readonly redis: RedisCacheService,
    /** V6.3 P1-4: 统一画像聚合 — 获取 optimalMealCount */
    private readonly profileResolver: ProfileResolverService,
    /** V6.3 P2-3: 策略解析器 — 获取 explain policy 控制解释详细程度 */
    private readonly strategyResolver: StrategyResolver,
    /** V6.5 Phase 3K: 自适应解释深度 — 根据用户互动意愿调整详细度 */
    private readonly adaptiveDepth: AdaptiveExplanationDepthService,
    private readonly preferenceProfileService: PreferenceProfileService,
    private readonly feedbackService: RecommendationFeedbackService,
    private readonly requestCtx: RequestContextService,
    private readonly foodI18nService: FoodI18nService,
  ) {}

  private getCurrentLocale(): Locale {
    return normalizeDietLocale(this.requestCtx.locale);
  }

  /**
   * 获取今日计划（惰性生成：不存在则自动创建）
   * 使用 Redis setNX 幂等锁防止并发重复生成
   */
  async getPlan(userId: string): Promise<any> {
    const tz = await this.userProfileService.getTimezone(userId);
    const today = getUserLocalDate(tz);
    let plan = await this.prisma.dailyPlans.findFirst({
      where: { userId: userId, date: new Date(today) },
    });
    if (plan) return this.localizePlan(plan, userId);

    // 幂等锁：30 秒过期，防止并发生成
    const lockKey = this.redis.buildKey('diet', 'plan_gen', userId, today);
    const acquired = await this.redis.setNX(lockKey, '1', 30000);
    if (!acquired) {
      // 锁已被占用，等待后重试读取
      await this.waitForPlan(userId, today);
      plan = await this.prisma.dailyPlans.findFirst({
        where: { userId: userId, date: new Date(today) },
      });
      if (plan) return this.localizePlan(plan, userId);
      // 超时后 fallback：直接生成（极端情况）
    }

    try {
      plan = await this.generatePlan(userId, today);
    } finally {
      await this.redis.del(lockKey);
    }
    return this.localizePlan(plan!, userId);
  }

  /**
   * 等待并发计划生成完成（轮询 DB，最多等 10 秒）
   */
  private async waitForPlan(
    userId: string,
    date: string,
    maxWaitMs = 10000,
  ): Promise<void> {
    const interval = 500;
    let waited = 0;
    while (waited < maxWaitMs) {
      await new Promise((r) => setTimeout(r, interval));
      waited += interval;
      const plan = await this.prisma.dailyPlans.findFirst({
        where: { userId: userId, date: new Date(date) },
      });
      if (plan) return;
    }
  }

  /**
   * 强制重新生成今日计划（删除缓存后重新生成）
   */
  async regeneratePlan(userId: string): Promise<any> {
    const tz = await this.userProfileService.getTimezone(userId);
    const today = getUserLocalDate(tz);
    await this.prisma.dailyPlans.deleteMany({
      where: { userId: userId, date: new Date(today) },
    });
    return this.generatePlan(userId, today);
  }

  /**
   * 单餐替换 — 仅重新生成指定餐次，保留其他餐不变
   *
   * 流程：
   * 1. 加载现有计划（如不存在则先生成）
   * 2. 收集其他餐的食物名作为排除集，避免跨餐重复
   * 3. 使用推荐引擎重新生成指定餐次
   * 4. 仅更新对应的 plan 字段，保存并返回
   */
  async regenerateMeal(
    userId: string,
    mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack',
  ): Promise<any> {
    const tz = await this.userProfileService.getTimezone(userId);
    const today = getUserLocalDate(tz);

    // 确保今日计划存在
    let plan: any = await this.prisma.dailyPlans.findFirst({
      where: { userId: userId, date: new Date(today) },
    });
    if (!plan) {
      plan = await this.generatePlan(userId, today);
    }

    const [summary, profile] = await Promise.all([
      this.foodService.getTodaySummary(userId),
      this.userProfileService.getProfile(userId),
    ]);

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const goalType = profile?.goal || 'health';

    const userProfileConstraints: UserProfileConstraints | undefined = profile
      ? {
          dietaryRestrictions: (profile.dietaryRestrictions as string[]) || [],
          weakTimeSlots: (profile.weakTimeSlots as string[]) || [],
          discipline: profile.discipline as string | undefined,
          allergens: (profile.allergens as string[]) || [],
          healthConditions: (profile.healthConditions as string[]) || [],
          regionCode: (profile.regionCode as string) || 'CN',
          timezone: profile.timezone ?? undefined,
          // Final-fix P0-1: 透传 cuisinePreferences 供 CuisineRegionFilterService
          // 用于跨 region cuisine 硬过滤（避免 US/JP 用户拿到纯中餐）
          cuisinePreferences:
            ((profile as any).cuisinePreferences as
              | string[]
              | null
              | undefined) ?? undefined,
        }
      : undefined;

    const mealRatios = MEAL_RATIOS[goalType] || MEAL_RATIOS.health;

    // 餐次 → plan 字段 & 比例 key 的映射
    const MEAL_TO_PLAN_KEY: Record<
      string,
      'morningPlan' | 'lunchPlan' | 'dinnerPlan' | 'snackPlan'
    > = {
      breakfast: 'morningPlan',
      lunch: 'lunchPlan',
      dinner: 'dinnerPlan',
      snack: 'snackPlan',
    };

    const planKey = MEAL_TO_PLAN_KEY[mealType];
    const ratio = mealRatios[mealType] || 0.25;

    const consumed = {
      calories: summary.totalCalories || 0,
      protein: summary.totalProtein || 0,
    };
    const dailyTarget: MealTarget = {
      calories: goals.calories,
      protein: goals.protein,
      fat: goals.fat,
      carbs: goals.carbs,
    };
    const mealTarget: MealTarget = {
      calories: Math.round(goals.calories * ratio),
      protein: Math.round(goals.protein * ratio),
      fat: Math.round(goals.fat * ratio),
      carbs: Math.round(goals.carbs * ratio),
    };

    // 收集其他餐的食物名作为排除集，避免跨餐重复
    const otherPlanKeys = Object.entries(MEAL_TO_PLAN_KEY)
      .filter(([mt]) => mt !== mealType)
      .map(([, pk]) => pk);

    const excludeNames: string[] = [];
    for (const pk of otherPlanKeys) {
      const otherMeal = plan[pk] as MealPlan | null;
      if (otherMeal?.foodItems) {
        for (const item of otherMeal.foodItems) {
          excludeNames.push(item.name);
        }
      }
    }

    // 获取推荐所需数据
    const [
      allFoods,
      recentFoodNames,
      feedbackStats,
      preferenceProfile,
      regionalBoostMap,
    ] = await Promise.all([
      this.recommendationEngine.getAllFoods(),
      this.preferenceProfileService.getRecentFoodNames(userId, 3),
      this.feedbackService.getUserFeedbackStats(userId),
      this.preferenceProfileService.getUserPreferenceProfile(userId),
      this.preferenceProfileService.getRegionalBoostMap(
        userProfileConstraints?.regionCode || 'CN',
      ),
    ]);

    const fullExcludeNames = [
      ...new Set([...excludeNames, ...recentFoodNames]),
    ];

    // 使用推荐引擎生成新的单餐
    const newRec = await this.recommendationEngine.recommendMealFromPool({
      allFoods,
      mealType,
      goalType,
      consumed,
      target: mealTarget,
      dailyTarget,
      excludeNames: fullExcludeNames,
      feedbackStats,
      userProfile: userProfileConstraints,
      preferenceProfile,
      regionalBoostMap,
      userId, // V6.5 Phase 3D
    });

    // V6.3 P2-3: 解析策略获取 explain policy
    let explainPolicy: ExplainPolicyConfig | undefined;
    try {
      const resolved = await this.strategyResolver.resolve(userId, goalType);
      explainPolicy = resolved.config?.explain;
    } catch {
      // 策略解析失败不影响单餐替换
    }

    // V6.5 Phase 3K: 自适应解释深度覆盖
    const resolvedDetailLevel = await this.adaptiveDepth.resolveDepth(
      explainPolicy?.detailLevel ?? 'standard',
      userId,
    );

    // V5 3.6 + V6 2.7 + V6.3 P2-3: 为单餐生成用户可读解释（含 V2 可视化数据）
    const locale = this.getCurrentLocale();
    const explanations = this.buildMealExplanations(
      newRec,
      userProfileConstraints,
      goalType,
      mealTarget,
      mealType,
      explainPolicy,
      userId,
      resolvedDetailLevel,
      locale,
    );

    // 仅更新指定餐次
    const updatedMealPlan = toMealPlan(newRec, explanations);

    const updatedPlan = await this.prisma.dailyPlans.update({
      where: { id: plan.id },
      data: { [planKey]: updatedMealPlan },
    });

    // V6.5 Phase 2L: 替换该餐次的 daily_plan_items
    await this.deletePlanItems(plan.id, [mealType]);
    await this.writePlanItems(plan.id, { [mealType]: newRec });

    return updatedPlan as any;
  }

  /**
   * V4 Phase 4.3 — 为指定日期生成计划（供 WeeklyPlanService 调用）
   *
   * 如果该日期已有计划则直接返回，否则生成新计划。
   * V5 2.3: 接收跨天排除集，保证周计划内食物多样性
   * V5 2.5: 接收预加载上下文，避免周计划 N 天重复查询
   */
  async generatePlanForDate(
    userId: string,
    date: string,
    weekExcludeNames?: Set<string>,
    preloaded?: PreloadedContext,
  ): Promise<any> {
    const existing = await this.prisma.dailyPlans.findFirst({
      where: { userId: userId, date: new Date(date) },
    });
    if (existing) return existing;
    return this.generatePlan(userId, date, weekExcludeNames, preloaded);
  }

  /**
   * 规则引擎生成每日计划（基于食物库推荐，零 AI 成本）
   * V5 2.3: 接收跨天排除集，与最近食物合并后传入推荐管线
   * V5 2.5: 接收预加载上下文，避免重复查询
   */
  private async generatePlan(
    userId: string,
    date: string,
    weekExcludeNames?: Set<string>,
    preloaded?: PreloadedContext,
  ): Promise<any> {
    // V5 2.5: 使用预加载数据或现场查询
    const [summary, profile] = preloaded
      ? [await this.foodService.getTodaySummary(userId), preloaded.profile]
      : await Promise.all([
          this.foodService.getTodaySummary(userId),
          this.userProfileService.getProfile(userId),
        ]);

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const goalType = profile?.goal || 'health';

    // 提取用户档案约束（过敏原、健康状况等传递给推荐引擎）
    const userProfileConstraints: UserProfileConstraints | undefined = profile
      ? {
          dietaryRestrictions: (profile.dietaryRestrictions as string[]) || [],
          weakTimeSlots: (profile.weakTimeSlots as string[]) || [],
          discipline: profile.discipline as string | undefined,
          allergens: (profile.allergens as string[]) || [],
          healthConditions: (profile.healthConditions as string[]) || [],
          regionCode: (profile.regionCode as string) || 'CN',
          timezone: profile.timezone ?? undefined,
          // Final-fix P0-1: 透传 cuisinePreferences 供 CuisineRegionFilterService
          // 用于跨 region cuisine 硬过滤（避免 US/JP 用户拿到纯中餐）
          cuisinePreferences:
            ((profile as any).cuisinePreferences as
              | string[]
              | null
              | undefined) ?? undefined,
        }
      : undefined;

    // V4: 按目标类型使用自适应餐次比例 (修复 E3)
    const mealRatios = MEAL_RATIOS[goalType] || MEAL_RATIOS.health;

    // V6.3 P1-4: 从推断画像获取 optimalMealCount，动态决定餐次数量
    // 优先级: optimalMealCount(推断) > meals_per_day(声明) > 默认3
    let optimalMealCount: number | undefined;
    try {
      const enrichedProfile = await this.profileResolver.resolve(userId);
      optimalMealCount =
        enrichedProfile.inferred?.optimalMealCount ?? undefined;
    } catch {
      // 画像获取失败不影响计划生成
    }

    // V6.3 P2-3: 解析策略获取 explain policy，控制解释详细程度
    let explainPolicy: ExplainPolicyConfig | undefined;
    try {
      const resolved = await this.strategyResolver.resolve(userId, goalType);
      explainPolicy = resolved.config?.explain;
    } catch {
      // 策略解析失败不影响计划生成，使用默认行为（standard）
    }

    // V6.5 Phase 3K: 自适应解释深度覆盖（一次解析，所有餐次复用）
    const resolvedDetailLevel = await this.adaptiveDepth.resolveDepth(
      explainPolicy?.detailLevel ?? 'standard',
      userId,
    );

    const effectiveMealCount = optimalMealCount ?? profile?.mealsPerDay ?? 3;

    // V6.3 P1-4: 根据餐次数量选择要生成的餐类型
    // 2餐: lunch + dinner
    // 3餐: breakfast + lunch + dinner
    // 4餐: breakfast + lunch + dinner + snack
    // 5餐: breakfast + morning_snack + lunch + afternoon_snack + dinner（超出当前支持，降级为4餐）
    const ALL_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
    let activeMealTypes: readonly string[];
    if (effectiveMealCount <= 2) {
      activeMealTypes = ['lunch', 'dinner'];
    } else if (effectiveMealCount === 3) {
      activeMealTypes = ['breakfast', 'lunch', 'dinner'];
    } else {
      activeMealTypes = ALL_MEAL_TYPES; // 4+
    }

    // 重新分配比例（仅活跃餐次分享 100% 热量）
    const activeRatioSum = activeMealTypes.reduce(
      (sum, mt) => sum + (mealRatios[mt] || 0.25),
      0,
    );
    const normalizedRatios: Record<string, number> = {};
    for (const mt of activeMealTypes) {
      normalizedRatios[mt] = (mealRatios[mt] || 0.25) / activeRatioSum;
    }

    const buildBudget = (r: number): MealTarget => ({
      calories: Math.round(goals.calories * r),
      protein: Math.round(goals.protein * r),
      fat: Math.round(goals.fat * r),
      carbs: Math.round(goals.carbs * r),
    });

    const consumed = {
      calories: summary.totalCalories || 0,
      protein: summary.totalProtein || 0,
    };
    const dailyTarget: MealTarget = {
      calories: goals.calories,
      protein: goals.protein,
      fat: goals.fat,
      carbs: goals.carbs,
    };

    // V5 2.5: 使用预加载数据或现场查询（避免周计划 N 天重复查询）
    const allFoods =
      preloaded?.allFoods ?? (await this.recommendationEngine.getAllFoods());
    const recentFoodNames =
      preloaded?.recentFoodNames ??
      (await this.preferenceProfileService.getRecentFoodNames(userId, 3));
    const feedbackStats =
      preloaded?.feedbackStats ??
      (await this.feedbackService.getUserFeedbackStats(userId));
    const preferenceProfile =
      preloaded?.preferenceProfile ??
      (await this.preferenceProfileService.getUserPreferenceProfile(userId));
    const regionalBoostMap =
      preloaded?.regionalBoostMap ??
      (await this.preferenceProfileService.getRegionalBoostMap(
        userProfileConstraints?.regionCode || 'CN',
      ));

    // 用户偏好提取（loves/avoids）
    const foodPreferences = (profile?.foodPreferences as any[]) || [];
    const userPreferences: { loves?: string[]; avoids?: string[] } = {};
    // 从 foodPreferences 和 behaviorProfile 提取偏好，暂时保持简单
    if (foodPreferences.length > 0) {
      // foodPreferences 是用户标记的偏好类型（如 'sweet', 'fried' 等）
      // 后续可从 behaviorProfile.foodPreferences.loves/avoids 获取更精准的食物名
    }

    // V6.3 P1-4: 动态餐次生成 — 基于 activeMealTypes 串行生成
    // 每餐选完后排除已选食物
    // V5 2.3: 合并跨天排除集，保证周内食物多样性
    const excludeNames: string[] = [
      ...recentFoodNames,
      ...(weekExcludeNames ?? []),
    ];

    const mealRecMap: Record<string, MealRecommendation> = {};
    for (const mt of activeMealTypes) {
      const rec = await this.recommendationEngine.recommendMealFromPool({
        allFoods,
        mealType: mt,
        goalType,
        consumed,
        target: buildBudget(normalizedRatios[mt]),
        dailyTarget,
        excludeNames,
        userPreferences,
        feedbackStats,
        userProfile: userProfileConstraints,
        preferenceProfile,
        regionalBoostMap,
        userId, // V6.5 Phase 3D
      });
      mealRecMap[mt] = rec;
      excludeNames.push(...rec.foods.map((f) => f.food.name));
    }

    // V6.3 P1-4: 将动态餐次映射回固定的 4 槽位
    // 未激活的餐次使用空占位（不生成推荐）
    const emptyRec: MealRecommendation = {
      foods: [],
      totalCalories: 0,
      totalProtein: 0,
      totalFat: 0,
      totalCarbs: 0,
      displayText: '',
      tip: '',
    };
    const morningRec = mealRecMap['breakfast'] || emptyRec;
    const lunchRec = mealRecMap['lunch'] || emptyRec;
    const dinnerRec = mealRecMap['dinner'] || emptyRec;
    const snackRec = mealRecMap['snack'] || emptyRec;

    // ── V5 Phase 2.1: 全局优化器集成 ──
    // 替代 V4 的单餐补偿逻辑，使用迭代贪心改进在全天餐次间做食物替换
    const allRecs = [morningRec, lunchRec, dinnerRec, snackRec];
    const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

    // 构建全天营养目标（用于偏差计算）
    // V5 2.2: 包含膳食纤维目标 (25g) 和血糖负荷上限 (80)
    const fullDayTarget: MealTarget = {
      calories: goals.calories,
      protein: goals.protein,
      fat: goals.fat,
      carbs: goals.carbs,
      fiber: 25,
      glycemicLoad: 80,
    };

    // 将推荐结果 → MealSlot[] 供优化器使用
    const mealSlots: MealSlot[] = allRecs.map((rec, i) => ({
      mealType: mealTypes[i],
      picks: [...rec.foods],
      candidates: rec.candidates || [],
      target: buildBudget(normalizedRatios[mealTypes[i]] || 0),
    }));

    // 运行全局优化器（V5: 最多 12 轮迭代贪心改进，含食物替换+份量调整）
    const optResult = optimizeDailyPlan(mealSlots, fullDayTarget);

    // 如果优化器做了替换，用优化后的 picks 重建推荐结果
    if (optResult.swapCount > 0) {
      this.logger.log(
        `全局优化器: 偏差 ${(optResult.deviationBefore * 100).toFixed(1)}%→` +
          `${(optResult.deviationAfter * 100).toFixed(1)}%, ` +
          `替换 ${optResult.swapCount} 次`,
      );
      for (let i = 0; i < allRecs.length; i++) {
        const optimizedPicks = optResult.meals[i].picks;
        const totalCalories = optimizedPicks.reduce(
          (s, p) => s + p.servingCalories,
          0,
        );
        const totalProtein = optimizedPicks.reduce(
          (s, p) => s + p.servingProtein,
          0,
        );
        const totalFat = optimizedPicks.reduce((s, p) => s + p.servingFat, 0);
        const totalCarbs = optimizedPicks.reduce(
          (s, p) => s + p.servingCarbs,
          0,
        );
        allRecs[i] = {
          ...allRecs[i],
          foods: optimizedPicks,
          totalCalories,
          totalProtein,
          totalFat,
          totalCarbs,
        };
      }
    }

    // 优化后偏差检查 → 生成提示信息
    const locale = this.getCurrentLocale();
    let compensationTip = '';
    const planTotals = {
      calories: allRecs.reduce((s, r) => s + r.totalCalories, 0),
      protein: allRecs.reduce((s, r) => s + r.totalProtein, 0),
    };
    const calDeviation =
      (planTotals.calories - goals.calories) / goals.calories;
    const proteinDeviation =
      (planTotals.protein - goals.protein) / goals.protein;

    if (Math.abs(proteinDeviation) > 0.1) {
      compensationTip = t('compensation.lowProtein', {}, locale);
    } else if (calDeviation > 0.1) {
      compensationTip = t('compensation.highCalories', {}, locale);
    }

    const strategy =
      this.buildStrategy(
        goals.calories,
        profile,
        goalType,
        profile?.timezone ?? undefined,
        locale,
      ) + (compensationTip ? `；${compensationTip}` : '');

    // V5 3.6 + V6 2.7 + V6.3 P2-3: 为每餐生成用户可读解释（含 V2 可视化数据）
    // explainPolicy 控制解释详细程度和雷达图可见性
    // V6.5 Phase 3K: resolvedDetailLevel 由自适应深度覆盖
    const mealExplanations = allRecs.map((rec, i) =>
      this.buildMealExplanations(
        rec,
        userProfileConstraints,
        goalType,
        buildBudget(normalizedRatios[mealTypes[i]] || 0),
        mealTypes[i],
        explainPolicy,
        userId,
        resolvedDetailLevel,
        locale,
      ),
    );

    // V6.3 P1-4: 仅为活跃餐次生成 plan 数据，非活跃餐次存 null
    const plan = await this.prisma.dailyPlans.create({
      data: {
        userId: userId,
        date: new Date(date),
        morningPlan: activeMealTypes.includes('breakfast')
          ? (toMealPlan(allRecs[0], mealExplanations[0]) as any)
          : undefined,
        lunchPlan: activeMealTypes.includes('lunch')
          ? (toMealPlan(allRecs[1], mealExplanations[1]) as any)
          : undefined,
        dinnerPlan: activeMealTypes.includes('dinner')
          ? (toMealPlan(allRecs[2], mealExplanations[2]) as any)
          : undefined,
        snackPlan: activeMealTypes.includes('snack')
          ? (toMealPlan(allRecs[3], mealExplanations[3]) as any)
          : undefined,
        strategy,
        totalBudget: goals.calories,
        adjustments: [],
      },
    });

    // V6.5 Phase 2L: 同步写入 daily_plan_items 规范化表
    const itemMealMap: Record<string, MealRecommendation> = {};
    const mealTypeToKey: [string, string][] = [
      ['breakfast', 'breakfast'],
      ['lunch', 'lunch'],
      ['dinner', 'dinner'],
      ['snack', 'snack'],
    ];
    for (const [mt] of mealTypeToKey) {
      if (activeMealTypes.includes(mt) && mealRecMap[mt]) {
        itemMealMap[mt] = mealRecMap[mt];
      }
    }
    await this.writePlanItems(plan.id, itemMealMap);

    return plan;
  }

  /**
   * 动态调整计划（记录偏离后调用，基于食物库推荐）
   */
  async adjustPlan(
    userId: string,
    reason: string,
    mealType?: MealType,
  ): Promise<{ updatedPlan: any; adjustmentNote: string }> {
    const profile = await this.userProfileService.getProfile(userId);
    const tz = profile?.timezone || DEFAULT_TIMEZONE;
    const hour = getUserLocalHour(tz);
    const targetMeal = (mealType || this.resolveMealTypeByHour(hour)) as
      | 'breakfast'
      | 'lunch'
      | 'dinner'
      | 'snack';

    // 直接复用单餐重生能力，确保“对应餐次”被替换
    const regeneratedPlan = await this.regenerateMeal(userId, targetMeal);

    const adjustedMeals: Partial<
      Record<'morning' | 'lunch' | 'dinner' | 'snack', MealPlan>
    > = {};
    if (targetMeal === 'breakfast') {
      adjustedMeals.morning = regeneratedPlan.morningPlan as MealPlan;
    } else if (targetMeal === 'lunch') {
      adjustedMeals.lunch = regeneratedPlan.lunchPlan as MealPlan;
    } else if (targetMeal === 'dinner') {
      adjustedMeals.dinner = regeneratedPlan.dinnerPlan as MealPlan;
    } else {
      adjustedMeals.snack = regeneratedPlan.snackPlan as MealPlan;
    }

    const adjustment: PlanAdjustment = {
      time: new Date().toISOString(),
      reason,
      newPlan: adjustedMeals,
    };
    const existingAdjustments = (regeneratedPlan.adjustments as any[]) || [];

    const updatedPlan = await this.prisma.dailyPlans.update({
      where: { id: regeneratedPlan.id },
      data: {
        adjustments: [...existingAdjustments, adjustment],
      },
    });

    // 替换后主动失效推荐粘性缓存，确保下一次 meal-suggestion 返回新结果
    this.foodService.invalidateMealSuggestionCache(userId, targetMeal);

    const locale = this.getCurrentLocale();
    const mealLabel = t(`meal.label.${targetMeal}`, {}, locale);
    const adjustmentNote = t(
      'response.replacedMealRecommendation',
      {
        meal: mealLabel === `meal.label.${targetMeal}` ? targetMeal : mealLabel,
      },
      locale,
    );

    return { updatedPlan: updatedPlan as any, adjustmentNote };
  }

  /**
   * 按时间推断当前应调整的餐次（与 getMealSuggestion 保持一致）
   */
  private resolveMealTypeByHour(hour: number): MealType {
    if (hour < 9) return MealType.BREAKFAST;
    if (hour < 14) return MealType.LUNCH;
    if (hour < 17) return MealType.SNACK;
    return MealType.DINNER;
  }

  /**
   * V5 3.6: 为一餐推荐结果生成用户可读解释（可序列化格式）
   * V6 2.7: 同时生成 ExplainV2 可视化数据结构（嵌套在 v2 字段中）
   * V6.3 P2-3: 根据 ExplainPolicyConfig 控制解释输出级别
   *   - simple:   仅 V1 基础解释（primaryReason 缩短，无 scoreBreakdown）
   *   - standard: V1 + V2（当前默认行为）
   *   - detailed: V1 + V2 + 完整 scoreBreakdown
   *   - showNutritionRadar: 控制是否附带雷达图数据
   *
   * 将 ExplanationGeneratorService 的输出转为 MealFoodExplanation（轻量 JSONB 友好）
   */
  private buildMealExplanations(
    rec: MealRecommendation,
    userProfileConstraints?: UserProfileConstraints,
    goalType?: string,
    /** V6 2.7: 餐次目标（用于进度条计算） */
    target?: MealTarget,
    /** V6 2.7: 餐次类型（用于雷达图权重计算） */
    mealType?: string,
    /** V6.3 P2-3: 解释策略配置（控制详细程度和雷达图可见性） */
    explainPolicy?: ExplainPolicyConfig,
    userId?: string,
    /** V6.5 Phase 3K: 自适应覆盖后的 detailLevel（如果已预计算） */
    resolvedDetailLevel?: 'simple' | 'standard' | 'detailed',
    locale?: Locale,
  ): Record<string, MealFoodExplanation> | undefined {
    const detailLevel =
      resolvedDetailLevel ?? explainPolicy?.detailLevel ?? 'standard';
    const showNutritionRadar = explainPolicy?.showNutritionRadar ?? true;
    const styleVariant = this.explanationGenerator.resolveStyleVariant(userId);

    // V1 基础解释 — 所有级别都生成
    const map = this.explanationGenerator.generateBatch(
      rec.foods,
      userProfileConstraints,
      goalType,
      locale,
      styleVariant,
    );
    if (map.size === 0) return undefined;

    // V6.3 P2-3: simple 级别不生成 V2 可视化数据
    // V6 2.7: standard/detailed 级别同时生成 V2 可视化解释
    const v2Map =
      target && detailLevel !== 'simple'
        ? this.explanationGenerator.generateV2Batch(
            rec.foods,
            target,
            userProfileConstraints,
            goalType,
            mealType,
            locale,
            styleVariant,
          )
        : null;

    const result: Record<string, MealFoodExplanation> = {};
    for (const [foodId, exp] of map) {
      // V6.3 P2-3: simple 级别 — 截断 primaryReason，省略 scoreBreakdown
      const primaryReason =
        detailLevel === 'simple'
          ? exp.primaryReason.split('；')[0] || exp.primaryReason
          : exp.primaryReason;

      const scoreBreakdown =
        detailLevel === 'simple' ? undefined : exp.scoreBreakdown;

      // V6.3 P2-3: 如果 showNutritionRadar=false，从 V2 数据中去除雷达图
      let v2Data = v2Map?.get(foodId);
      if (v2Data && !showNutritionRadar) {
        v2Data = {
          ...v2Data,
          radarChart: { dimensions: [] },
        };
      }

      result[foodId] = {
        primaryReason,
        nutritionHighlights: exp.nutritionHighlights,
        healthTip: exp.healthTip,
        scoreBreakdown,
        locale,
        // V6 2.7: 附带 V2 可视化数据（前端支持时使用）
        v2: v2Data,
      };
    }
    return result;
  }

  // ── V6.5 Phase 2L: daily_plan_items 规范化写入 ──

  /**
   * 将一餐的 MealRecommendation 拆成 daily_plan_items 行
   */
  private buildItemRows(
    planId: string,
    mealType: string,
    rec: MealRecommendation,
  ): Array<{
    dailyPlanId: string;
    mealType: string;
    role: string;
    foodId: string | null;
    recipeId: string | null;
    foodName: string;
    calories: number | null;
    protein: number | null;
    fat: number | null;
    carbs: number | null;
    score: number | null;
    sortOrder: number;
  }> {
    return rec.foods.map((sf, idx) => ({
      dailyPlanId: planId,
      mealType: mealType,
      role: categoryToRole(sf.food.category || ''),
      foodId: sf.food.id || null,
      recipeId: null,
      foodName: sf.food.name,
      calories: sf.servingCalories ?? null,
      protein: sf.servingProtein ?? null,
      fat: sf.servingFat ?? null,
      carbs: sf.servingCarbs ?? null,
      score: sf.score ?? null,
      sortOrder: idx,
    }));
  }

  /**
   * 为一个 plan 批量写入 daily_plan_items（多餐）
   * mealRecMap: mealType → MealRecommendation
   */
  private async writePlanItems(
    planId: string,
    mealRecMap: Record<string, MealRecommendation>,
  ): Promise<void> {
    const rows = Object.entries(mealRecMap).flatMap(([mt, rec]) =>
      rec.foods.length > 0 ? this.buildItemRows(planId, mt, rec) : [],
    );
    if (rows.length === 0) return;
    try {
      await this.prisma.dailyPlanItems.createMany({ data: rows });
    } catch (err) {
      this.logger.warn(
        `daily_plan_items 写入失败 (planId=${planId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * 删除指定 plan 指定餐次的 items（单餐替换/调整时使用）
   * 如果不传 mealTypes 则删除该 plan 全部 items
   */
  private async deletePlanItems(
    planId: string,
    mealTypes?: string[],
  ): Promise<void> {
    try {
      const where: any = { dailyPlanId: planId };
      if (mealTypes && mealTypes.length > 0) {
        where.mealType = { in: mealTypes };
      }
      await this.prisma.dailyPlanItems.deleteMany({ where });
    } catch (err) {
      this.logger.warn(
        `daily_plan_items 删除失败 (planId=${planId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * 根据用户档案和目标类型生成今日策略
   * V4: profile: any → 明确类型 (修复 D1)
   */
  private buildStrategy(
    goal: number,
    _profile: { goal?: string } | null | undefined,
    goalType: string,
    timezone?: string,
    locale?: Locale,
  ): string {
    const strategies: string[] = [];

    const strategyKey = `strategy.${goalType}`;
    strategies.push(
      t(strategyKey, {}, locale) !== strategyKey
        ? t(strategyKey, {}, locale)
        : t('strategy.health', {}, locale),
    );

    if (goal < 1600) strategies.push(t('strategy.lowCalorie', {}, locale));
    else if (goal >= 2500)
      strategies.push(t('strategy.highCalorie', {}, locale));

    const hour = getUserLocalHour(timezone || DEFAULT_TIMEZONE);
    if (hour < 10) strategies.push(t('strategy.morningWater', {}, locale));
    if (hour >= 14 && hour < 17)
      strategies.push(t('strategy.afternoonHydration', {}, locale));

    return strategies.join('；');
  }

  async localizePlan(plan: any, userId: string): Promise<any> {
    if (!plan) return plan;

    const locale = this.getCurrentLocale();
    const profile = await this.userProfileService.getProfile(userId);
    const goalType = profile?.goal || 'health';
    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const mealRatios = MEAL_RATIOS[goalType] || MEAL_RATIOS.health;

    const localizedPlan = {
      ...plan,
      strategy: this.buildStrategy(
        goals.calories,
        profile,
        goalType,
        profile?.timezone ?? undefined,
        locale,
      ),
    };

    const meals: Array<{
      key: 'morningPlan' | 'lunchPlan' | 'dinnerPlan' | 'snackPlan';
      mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    }> = [
      { key: 'morningPlan', mealType: 'breakfast' },
      { key: 'lunchPlan', mealType: 'lunch' },
      { key: 'dinnerPlan', mealType: 'dinner' },
      { key: 'snackPlan', mealType: 'snack' },
    ];

    const foodIds = meals
      .flatMap(({ key }) => localizedPlan[key]?.foodItems || [])
      .map((item: MealFoodItem) => item.foodId)
      .filter((foodId: string | undefined): foodId is string => !!foodId);
    const foodLocalizationMap = await this.foodI18nService.loadLocalizedDetails(
      [...new Set(foodIds)],
      locale,
    );

    for (const { key, mealType } of meals) {
      const meal = localizedPlan[key];
      if (!meal) continue;

      const ratio = mealRatios[mealType] || 0.25;
      const target: MealTarget = {
        calories: Math.round(goals.calories * ratio),
        protein: Math.round(goals.protein * ratio),
        fat: Math.round(goals.fat * ratio),
        carbs: Math.round(goals.carbs * ratio),
      };

      localizedPlan[key] = {
        ...meal,
        foodItems: this.localizeMealFoodItems(
          meal.foodItems,
          foodLocalizationMap,
        ),
        foods: this.rebuildMealFoodsText(
          meal.foodItems,
          foodLocalizationMap,
          locale,
        ),
        tip: this.rebuildMealTip(
          mealType,
          goalType,
          target,
          meal.calories ?? 0,
          locale,
        ),
        explanations: this.localizeMealExplanations(meal.explanations, locale),
      };
    }

    return localizedPlan;
  }

  private rebuildMealTip(
    mealType: string,
    goalType: string,
    target: MealTarget,
    actualCal: number,
    locale: Locale,
  ): string {
    const tips: string[] = [];

    if (actualCal > target.calories * 1.1) {
      tips.push(t('tip.caloriesOver', {}, locale));
    } else if (actualCal < target.calories * 0.7) {
      tips.push(t('tip.caloriesUnder', {}, locale));
    }

    const goalTipKey = `tip.goal.${goalType}`;
    tips.push(
      t(goalTipKey, {}, locale) !== goalTipKey
        ? t(goalTipKey, {}, locale)
        : t('tip.goal.health', {}, locale),
    );

    const mealTipKey = `tip.meal.${mealType}`;
    const mealTip = t(mealTipKey, {}, locale);
    if (mealTip !== mealTipKey) tips.push(mealTip);

    return tips.filter(Boolean).join('；');
  }

  private localizeMealFoodItems(
    foodItems: MealFoodItem[] | undefined,
    foodLocalizationMap: Map<string, { name: string; servingDesc?: string }>,
  ): MealFoodItem[] | undefined {
    if (!foodItems) return foodItems;

    return foodItems.map((item) => {
      const localized = item.foodId
        ? foodLocalizationMap.get(item.foodId)
        : undefined;
      if (!localized) return item;

      return {
        ...item,
        name: localized.name,
        servingDesc: localized.servingDesc ?? item.servingDesc,
      };
    });
  }

  private rebuildMealFoodsText(
    foodItems: MealFoodItem[] | undefined,
    foodLocalizationMap: Map<string, { name: string; servingDesc?: string }>,
    locale: Locale,
  ): string | undefined {
    if (!foodItems?.length) return undefined;

    return foodItems
      .map((item) => {
        const localized = item.foodId
          ? foodLocalizationMap.get(item.foodId)
          : undefined;
        return t(
          'display.foodItem',
          {
            name: localized?.name || item.name,
            serving: localized?.servingDesc ?? item.servingDesc ?? '',
            calories: item.calories ?? 0,
          },
          locale,
        );
      })
      .join(' + ');
  }

  private buildLocalizedAliasMap(
    keys: string[],
    locale: Locale,
  ): Map<string, string> {
    const map = new Map<string, string>();

    for (const key of keys) {
      const localized = t(key, {}, locale);
      for (const sourceLocale of getSupportedLocales()) {
        const alias = t(key, {}, sourceLocale);
        if (alias && alias !== key) {
          map.set(alias, localized);
        }
      }
    }

    return map;
  }

  private localizeByAlias(
    value: string | undefined,
    aliasMap: Map<string, string>,
  ): string | undefined {
    if (!value) return value;
    return aliasMap.get(value) || value;
  }

  private localizeMealExplanations(
    explanations: Record<string, MealFoodExplanation> | undefined,
    locale: Locale,
  ): Record<string, MealFoodExplanation> | undefined {
    if (!explanations) return explanations;

    const hasLocaleMismatch = Object.values(explanations).some((explanation) => {
      const storedLocale = explanation.locale || explanation.v2?.locale;
      return storedLocale && storedLocale !== locale;
    });
    if (hasLocaleMismatch) {
      return undefined;
    }

    const tagAliasMap = this.buildLocalizedAliasMap(
      [
        'explain.tag.lowGI',
        'explain.tag.naturalFood',
        'explain.tag.highProtein',
        'explain.tag.richFiber',
        'explain.tag.highNutrientDensity',
        'explain.tag.lowSaturatedFat',
        'explain.tag.lowSodium',
        'explain.tag.lowFODMAP',
        'explain.tag.highCalcium',
        'explain.tag.richIron',
      ],
      locale,
    );
    const reasonAliasMap = this.buildLocalizedAliasMap(
      [
        'explain.reason.antiInflammation',
        'explain.reason.naturalFood',
        'explain.reason.balancedNutrition',
        'explain.reason.glycemicGood',
        'explain.reason.proteinModerate',
        'explain.reason.richFiber',
        'explain.reason.highNutrientDensity',
        'explain.reason.highSatiety',
        'explain.reason.fatBalanced',
        'explain.reason.carbsMatch',
      ],
      locale,
    );
    const dimensionAliasMap = this.buildLocalizedAliasMap(
      [
        'explain.dim.calories',
        'explain.dim.protein',
        'explain.dim.carbs',
        'explain.dim.fat',
        'explain.dim.quality',
        'explain.dim.satiety',
        'explain.dim.glycemic',
        'explain.dim.nutrientDensity',
        'explain.dim.inflammation',
        'explain.dim.fiber',
        'explain.dim.seasonality',
        'explain.dim.executability',
        'explain.dim.popularity',
        'explain.dim.acquisition',
      ],
      locale,
    );
    const nutrientAliasMap = this.buildLocalizedAliasMap(
      [
        'explain.nutrient.calories',
        'explain.nutrient.protein',
        'explain.nutrient.carbs',
        'explain.nutrient.fat',
        'explain.nutrient.fiber',
      ],
      locale,
    );

    return Object.fromEntries(
      Object.entries(explanations).map(([foodId, explanation]) => [
        foodId,
        {
          ...explanation,
          primaryReason: this.localizeByAlias(
            explanation.primaryReason,
            reasonAliasMap,
          )!,
          nutritionHighlights: (explanation.nutritionHighlights || []).map(
            (item) => ({
              ...item,
              label:
                this.localizeByAlias(item.label, tagAliasMap) || item.label,
            }),
          ),
          healthTip: explanation.healthTip
            ? this.localizeByAlias(explanation.healthTip, reasonAliasMap) ||
              explanation.healthTip
            : explanation.healthTip,
          scoreBreakdown: explanation.scoreBreakdown?.map((item) => ({
            ...item,
            dimension:
              this.localizeByAlias(item.dimension, dimensionAliasMap) ||
              item.dimension,
          })),
          v2: explanation.v2
            ? {
                ...explanation.v2,
                summary:
                  this.localizeByAlias(
                    explanation.v2.summary,
                    reasonAliasMap,
                  ) || explanation.v2.summary,
                primaryReason:
                  this.localizeByAlias(
                    explanation.v2.primaryReason,
                    reasonAliasMap,
                  ) || explanation.v2.primaryReason,
                healthTip: explanation.v2.healthTip
                  ? this.localizeByAlias(
                      explanation.v2.healthTip,
                      reasonAliasMap,
                    ) || explanation.v2.healthTip
                  : explanation.v2.healthTip,
                radarChart: {
                  ...explanation.v2.radarChart,
                  dimensions: explanation.v2.radarChart.dimensions.map(
                    (item) => ({
                      ...item,
                      label:
                        this.localizeByAlias(item.label, dimensionAliasMap) ||
                        item.label,
                    }),
                  ),
                },
                progressBars: explanation.v2.progressBars.map((item) => ({
                  ...item,
                  nutrient:
                    this.localizeByAlias(item.nutrient, nutrientAliasMap) ||
                    item.nutrient,
                })),
                locale,
              }
            : explanation.v2,
        },
      ]),
    );
  }
}
