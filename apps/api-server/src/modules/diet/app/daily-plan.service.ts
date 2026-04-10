import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DailyPlan,
  MealPlan,
  MealFoodItem,
  MealFoodExplanation,
  PlanAdjustment,
} from '../entities/daily-plan.entity';
import { FoodLibrary } from '../../food/entities/food-library.entity';
import { FoodService } from './food.service';
import { UserProfileService } from '../../user/app/user-profile.service';
import { UserProfile } from '../../user/entities/user-profile.entity';
import { NutritionScoreService } from './nutrition-score.service';
import {
  RecommendationEngineService,
  MealTarget,
} from './recommendation-engine.service';
import { ExplanationGeneratorService } from './recommendation/explanation-generator.service';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';
import {
  MEAL_RATIOS,
  FoodFeedbackStats,
  UserPreferenceProfile,
  UserProfileConstraints,
  MealRecommendation,
} from './recommendation/recommendation.types';
import { optimizeDailyPlan, MealSlot } from './recommendation/global-optimizer';
import { t } from './recommendation/i18n-messages';
import {
  getUserLocalDate,
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../common/utils/timezone.util';

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
            name: sf.food?.name ?? '',
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

@Injectable()
export class DailyPlanService {
  private readonly logger = new Logger(DailyPlanService.name);

  constructor(
    @InjectRepository(DailyPlan)
    private readonly planRepo: Repository<DailyPlan>,
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly recommendationEngine: RecommendationEngineService,
    private readonly explanationGenerator: ExplanationGeneratorService,
    private readonly redis: RedisCacheService,
  ) {}

  /**
   * 获取今日计划（惰性生成：不存在则自动创建）
   * 使用 Redis setNX 幂等锁防止并发重复生成
   */
  async getPlan(userId: string): Promise<DailyPlan> {
    const tz = await this.userProfileService.getTimezone(userId);
    const today = getUserLocalDate(tz);
    let plan = await this.planRepo.findOne({ where: { userId, date: today } });
    if (plan) return plan;

    // 幂等锁：30 秒过期，防止并发生成
    const lockKey = this.redis.buildKey('diet', 'plan_gen', userId, today);
    const acquired = await this.redis.setNX(lockKey, '1', 30000);
    if (!acquired) {
      // 锁已被占用，等待后重试读取
      await this.waitForPlan(userId, today);
      plan = await this.planRepo.findOne({ where: { userId, date: today } });
      if (plan) return plan;
      // 超时后 fallback：直接生成（极端情况）
    }

    try {
      plan = await this.generatePlan(userId, today);
    } finally {
      await this.redis.del(lockKey);
    }
    return plan;
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
      const plan = await this.planRepo.findOne({
        where: { userId, date },
      });
      if (plan) return;
    }
  }

  /**
   * 强制重新生成今日计划（删除缓存后重新生成）
   */
  async regeneratePlan(userId: string): Promise<DailyPlan> {
    const tz = await this.userProfileService.getTimezone(userId);
    const today = getUserLocalDate(tz);
    await this.planRepo.delete({ userId, date: today });
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
  ): Promise<DailyPlan> {
    const tz = await this.userProfileService.getTimezone(userId);
    const today = getUserLocalDate(tz);

    // 确保今日计划存在
    let plan = await this.planRepo.findOne({ where: { userId, date: today } });
    if (!plan) {
      plan = await this.generatePlan(userId, today);
    }

    const [summary, profile] = await Promise.all([
      this.foodService.getTodaySummary(userId),
      this.userProfileService.getProfile(userId),
    ]);

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const goalType = profile?.goal || 'health';

    const userProfileConstraints = profile
      ? {
          dietaryRestrictions: profile.dietaryRestrictions || [],
          weakTimeSlots: profile.weakTimeSlots || [],
          discipline: profile.discipline,
          allergens: profile.allergens || [],
          healthConditions: profile.healthConditions || [],
          regionCode: profile.regionCode || 'CN',
          timezone: profile.timezone,
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
    const dailyTarget = { calories: goals.calories, protein: goals.protein };
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
      this.recommendationEngine.getRecentFoodNames(userId, 3),
      this.recommendationEngine.getUserFeedbackStats(userId),
      this.recommendationEngine.getUserPreferenceProfile(userId),
      this.recommendationEngine.getRegionalBoostMap(
        userProfileConstraints?.regionCode || 'CN',
      ),
    ]);

    const fullExcludeNames = [
      ...new Set([...excludeNames, ...recentFoodNames]),
    ];

    // 使用推荐引擎生成新的单餐
    const newRec = this.recommendationEngine.recommendMealFromPool(
      allFoods,
      mealType,
      goalType,
      consumed,
      mealTarget,
      dailyTarget,
      fullExcludeNames,
      undefined,
      feedbackStats,
      userProfileConstraints,
      preferenceProfile,
      regionalBoostMap,
    );

    // V5 3.6 + V6 2.7: 为单餐生成用户可读解释（含 V2 可视化数据）
    const explanations = this.buildMealExplanations(
      newRec,
      userProfileConstraints,
      goalType,
      mealTarget,
      mealType,
    );

    // 仅更新指定餐次
    plan[planKey] = toMealPlan(newRec, explanations);

    return this.planRepo.save(plan);
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
  ): Promise<DailyPlan> {
    const existing = await this.planRepo.findOne({ where: { userId, date } });
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
  ): Promise<DailyPlan> {
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
    const userProfileConstraints = profile
      ? {
          dietaryRestrictions: profile.dietaryRestrictions || [],
          weakTimeSlots: profile.weakTimeSlots || [],
          discipline: profile.discipline,
          allergens: profile.allergens || [],
          healthConditions: profile.healthConditions || [],
          regionCode: profile.regionCode || 'CN',
          timezone: profile.timezone,
        }
      : undefined;

    // V4: 按目标类型使用自适应餐次比例 (修复 E3)
    const mealRatios = MEAL_RATIOS[goalType] || MEAL_RATIOS.health;

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
    const dailyTarget = { calories: goals.calories, protein: goals.protein };

    // V5 2.5: 使用预加载数据或现场查询（避免周计划 N 天重复查询）
    const allFoods =
      preloaded?.allFoods ?? (await this.recommendationEngine.getAllFoods());
    const recentFoodNames =
      preloaded?.recentFoodNames ??
      (await this.recommendationEngine.getRecentFoodNames(userId, 3));
    const feedbackStats =
      preloaded?.feedbackStats ??
      (await this.recommendationEngine.getUserFeedbackStats(userId));
    const preferenceProfile =
      preloaded?.preferenceProfile ??
      (await this.recommendationEngine.getUserPreferenceProfile(userId));
    const regionalBoostMap =
      preloaded?.regionalBoostMap ??
      (await this.recommendationEngine.getRegionalBoostMap(
        userProfileConstraints?.regionCode || 'CN',
      ));

    // 用户偏好提取（loves/avoids）
    const foodPreferences = profile?.foodPreferences || [];
    const userPreferences: { loves?: string[]; avoids?: string[] } = {};
    // 从 foodPreferences 和 behaviorProfile 提取偏好，暂时保持简单
    if (foodPreferences.length > 0) {
      // foodPreferences 是用户标记的偏好类型（如 'sweet', 'fried' 等）
      // 后续可从 behaviorProfile.foodPreferences.loves/avoids 获取更精准的食物名
    }

    // 串行生成4餐，每餐选完后排除已选食物
    // V5 2.3: 合并跨天排除集，保证周内食物多样性
    const excludeNames: string[] = [
      ...recentFoodNames,
      ...(weekExcludeNames ?? []),
    ];

    const morningRec = this.recommendationEngine.recommendMealFromPool(
      allFoods,
      'breakfast',
      goalType,
      consumed,
      buildBudget(mealRatios.breakfast),
      dailyTarget,
      excludeNames,
      userPreferences,
      feedbackStats,
      userProfileConstraints,
      preferenceProfile,
      regionalBoostMap,
    );
    excludeNames.push(...morningRec.foods.map((f) => f.food.name));

    const lunchRec = this.recommendationEngine.recommendMealFromPool(
      allFoods,
      'lunch',
      goalType,
      consumed,
      buildBudget(mealRatios.lunch),
      dailyTarget,
      excludeNames,
      userPreferences,
      feedbackStats,
      userProfileConstraints,
      preferenceProfile,
      regionalBoostMap,
    );
    excludeNames.push(...lunchRec.foods.map((f) => f.food.name));

    const dinnerRec = this.recommendationEngine.recommendMealFromPool(
      allFoods,
      'dinner',
      goalType,
      consumed,
      buildBudget(mealRatios.dinner),
      dailyTarget,
      excludeNames,
      userPreferences,
      feedbackStats,
      userProfileConstraints,
      preferenceProfile,
      regionalBoostMap,
    );
    excludeNames.push(...dinnerRec.foods.map((f) => f.food.name));

    const snackRec = this.recommendationEngine.recommendMealFromPool(
      allFoods,
      'snack',
      goalType,
      consumed,
      buildBudget(mealRatios.snack),
      dailyTarget,
      excludeNames,
      userPreferences,
      feedbackStats,
      userProfileConstraints,
      preferenceProfile,
      regionalBoostMap,
    );

    // ── V5 Phase 2.1: 全局优化器集成 ──
    // 替代 V4 的单餐补偿逻辑，使用迭代贪心改进在全天 4 餐间做食物替换
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

    // 将 4 餐推荐结果 → MealSlot[] 供优化器使用
    const mealSlots: MealSlot[] = allRecs.map((rec, i) => ({
      mealType: mealTypes[i],
      picks: [...rec.foods],
      candidates: rec.candidates || [],
      target: buildBudget(mealRatios[mealTypes[i]]),
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
      compensationTip = t('compensation.lowProtein');
    } else if (calDeviation > 0.1) {
      compensationTip = t('compensation.highCalories');
    }

    const strategy =
      this.buildStrategy(goals.calories, profile, goalType, profile?.timezone) +
      (compensationTip ? `；${compensationTip}` : '');

    // V5 3.6 + V6 2.7: 为每餐生成用户可读解释（含 V2 可视化数据）
    const mealExplanations = allRecs.map((rec, i) =>
      this.buildMealExplanations(
        rec,
        userProfileConstraints,
        goalType,
        buildBudget(mealRatios[mealTypes[i]]),
        mealTypes[i],
      ),
    );

    const plan = this.planRepo.create({
      userId,
      date,
      morningPlan: toMealPlan(allRecs[0], mealExplanations[0]),
      lunchPlan: toMealPlan(allRecs[1], mealExplanations[1]),
      dinnerPlan: toMealPlan(allRecs[2], mealExplanations[2]),
      snackPlan: toMealPlan(allRecs[3], mealExplanations[3]),
      strategy,
      totalBudget: goals.calories,
      adjustments: [],
    });

    return this.planRepo.save(plan);
  }

  /**
   * 动态调整计划（记录偏离后调用，基于食物库推荐）
   */
  async adjustPlan(
    userId: string,
    reason: string,
  ): Promise<{ updatedPlan: DailyPlan; adjustmentNote: string }> {
    const [summary, profile] = await Promise.all([
      this.foodService.getTodaySummary(userId),
      this.userProfileService.getProfile(userId),
    ]);
    const tz = profile?.timezone || DEFAULT_TIMEZONE;
    const today = getUserLocalDate(tz);
    let plan = await this.planRepo.findOne({ where: { userId, date: today } });
    if (!plan) {
      plan = await this.generatePlan(userId, today);
    }

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const goalType = profile?.goal || 'health';
    const goal = plan.totalBudget || goals.calories;
    const remaining = Math.max(0, goal - summary.totalCalories);
    const hour = getUserLocalHour(tz);

    // 提取用户档案约束
    const userProfileConstraints = profile
      ? {
          dietaryRestrictions: profile.dietaryRestrictions || [],
          weakTimeSlots: profile.weakTimeSlots || [],
          discipline: profile.discipline,
          allergens: profile.allergens || [],
          healthConditions: profile.healthConditions || [],
          regionCode: profile.regionCode || 'CN',
          timezone: profile.timezone,
        }
      : undefined;

    const consumed = {
      calories: summary.totalCalories || 0,
      protein: summary.totalProtein || 0,
    };
    const dailyTarget = { calories: goals.calories, protein: goals.protein };

    // 根据剩余时段重新分配
    const adjustedMeals: Partial<
      Record<'morning' | 'lunch' | 'dinner' | 'snack', MealPlan>
    > = {};
    let adjustmentNote = '';

    if (remaining <= 0) {
      adjustmentNote = t('adjust.caloriesReached');
      if (hour < 18) {
        adjustedMeals.dinner = {
          foods: t('adjust.fallbackDinnerFoods'),
          calories: 150,
          protein: 5,
          fat: 3,
          carbs: 15,
          tip: t('adjust.fallbackDinnerTip'),
        };
        plan.dinnerPlan = adjustedMeals.dinner;
      }
    } else if (hour < 12) {
      // 午餐+晚餐重新分配
      const lunchBudget = Math.round(remaining * 0.55);
      const dinnerBudget = Math.round(remaining * 0.45);
      const proteinRem = Math.max(
        0,
        goals.protein - (summary.totalProtein || 0),
      );
      const allFoods = await this.recommendationEngine.getAllFoods();
      const recentNames = await this.recommendationEngine.getRecentFoodNames(
        userId,
        3,
      );
      const excludeNames = [...recentNames];

      const lunchRec = this.recommendationEngine.recommendMealFromPool(
        allFoods,
        'lunch',
        goalType,
        consumed,
        {
          calories: lunchBudget,
          protein: Math.round(proteinRem * 0.55),
          fat: Math.round(goals.fat * 0.35),
          carbs: Math.round(goals.carbs * 0.35),
        },
        dailyTarget,
        excludeNames,
        undefined,
        undefined,
        userProfileConstraints,
      );
      excludeNames.push(...lunchRec.foods.map((f) => f.food.name));

      const dinnerRec = this.recommendationEngine.recommendMealFromPool(
        allFoods,
        'dinner',
        goalType,
        consumed,
        {
          calories: dinnerBudget,
          protein: Math.round(proteinRem * 0.45),
          fat: Math.round(goals.fat * 0.3),
          carbs: Math.round(goals.carbs * 0.3),
        },
        dailyTarget,
        excludeNames,
        undefined,
        undefined,
        userProfileConstraints,
      );

      adjustedMeals.lunch = toMealPlan(lunchRec);
      adjustedMeals.dinner = toMealPlan(dinnerRec);
      plan.lunchPlan = adjustedMeals.lunch;
      plan.dinnerPlan = adjustedMeals.dinner;
      adjustmentNote = t('adjust.lunchDinner', { lunchBudget, dinnerBudget });
    } else if (hour < 18) {
      // 只调整晚餐
      const proteinRem = Math.max(
        0,
        goals.protein - (summary.totalProtein || 0),
      );
      const allFoods = await this.recommendationEngine.getAllFoods();
      const recentNames = await this.recommendationEngine.getRecentFoodNames(
        userId,
        3,
      );
      const dinnerRec = this.recommendationEngine.recommendMealFromPool(
        allFoods,
        'dinner',
        goalType,
        consumed,
        {
          calories: remaining,
          protein: proteinRem,
          fat: Math.round(goals.fat * 0.3),
          carbs: Math.round(goals.carbs * 0.3),
        },
        dailyTarget,
        recentNames,
        undefined,
        undefined,
        userProfileConstraints,
      );
      adjustedMeals.dinner = toMealPlan(dinnerRec);
      plan.dinnerPlan = adjustedMeals.dinner;
      adjustmentNote = t('adjust.dinnerBudget', { remaining });
    } else {
      adjustmentNote = t('adjust.nightSnack', { remaining });
    }

    const adjustment: PlanAdjustment = {
      time: new Date().toISOString(),
      reason,
      newPlan: adjustedMeals,
    };
    plan.adjustments = [...(plan.adjustments || []), adjustment];

    const updatedPlan = await this.planRepo.save(plan);
    return { updatedPlan, adjustmentNote };
  }

  /**
   * V5 3.6: 为一餐推荐结果生成用户可读解释（可序列化格式）
   * V6 2.7: 同时生成 ExplainV2 可视化数据结构（嵌套在 v2 字段中）
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
  ): Record<string, MealFoodExplanation> | undefined {
    const map = this.explanationGenerator.generateBatch(
      rec.foods,
      userProfileConstraints,
      goalType,
    );
    if (map.size === 0) return undefined;

    // V6 2.7: 同时生成 V2 可视化解释（如果有 target 参数）
    const v2Map = target
      ? this.explanationGenerator.generateV2Batch(
          rec.foods,
          target,
          userProfileConstraints,
          goalType,
          mealType,
        )
      : null;

    const result: Record<string, MealFoodExplanation> = {};
    for (const [foodId, exp] of map) {
      result[foodId] = {
        primaryReason: exp.primaryReason,
        nutritionHighlights: exp.nutritionHighlights,
        healthTip: exp.healthTip,
        scoreBreakdown: exp.scoreBreakdown,
        // V6 2.7: 附带 V2 可视化数据（前端支持时使用）
        v2: v2Map?.get(foodId),
      };
    }
    return result;
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
  ): string {
    const strategies: string[] = [];

    const strategyKey = `strategy.${goalType}`;
    strategies.push(
      t(strategyKey) !== strategyKey ? t(strategyKey) : t('strategy.health'),
    );

    if (goal < 1600) strategies.push(t('strategy.lowCalorie'));
    else if (goal >= 2500) strategies.push(t('strategy.highCalorie'));

    const hour = getUserLocalHour(timezone || DEFAULT_TIMEZONE);
    if (hour < 10) strategies.push(t('strategy.morningWater'));
    if (hour >= 14 && hour < 17)
      strategies.push(t('strategy.afternoonHydration'));

    return strategies.join('；');
  }
}
