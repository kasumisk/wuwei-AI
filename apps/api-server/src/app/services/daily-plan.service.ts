import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DailyPlan,
  MealPlan,
  PlanAdjustment,
} from '../../entities/daily-plan.entity';
import { FoodService } from './food.service';
import { UserProfileService } from './user-profile.service';
import { NutritionScoreService } from './nutrition-score.service';
import {
  RecommendationEngineService,
  MealTarget,
} from './recommendation-engine.service';

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
  ) {}

  /**
   * 获取今日计划（惰性生成：不存在则自动创建）
   */
  async getPlan(userId: string): Promise<DailyPlan> {
    const today = new Date().toISOString().split('T')[0];
    let plan = await this.planRepo.findOne({ where: { userId, date: today } });
    if (!plan) {
      plan = await this.generatePlan(userId, today);
    }
    return plan;
  }

  /**
   * 强制重新生成今日计划（删除缓存后重新生成）
   */
  async regeneratePlan(userId: string): Promise<DailyPlan> {
    const today = new Date().toISOString().split('T')[0];
    await this.planRepo.delete({ userId, date: today });
    return this.generatePlan(userId, today);
  }

  /**
   * 规则引擎生成每日计划（基于食物库推荐，零 AI 成本）
   */
  private async generatePlan(userId: string, date: string): Promise<DailyPlan> {
    const [summary, profile] = await Promise.all([
      this.foodService.getTodaySummary(userId),
      this.userProfileService.getProfile(userId),
    ]);

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const goalType = profile?.goal || 'health';

    // 提取用户档案约束（过敏原、健康状况等传递给推荐引擎）
    const userProfileConstraints = profile ? {
      dietaryRestrictions: profile.dietaryRestrictions || [],
      weakTimeSlots: profile.weakTimeSlots || [],
      discipline: profile.discipline,
      allergens: profile.allergens || [],
      healthConditions: profile.healthConditions || [],
    } : undefined;

    // 按比例分配各餐「多维预算」
    const mealRatios = { morning: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 };

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

    // 一次性获取食物库 + 最近记录 + 反馈权重（减少查询）
    const [allFoods, recentFoodNames, feedbackWeights] = await Promise.all([
      this.recommendationEngine.getAllFoods(),
      this.recommendationEngine.getRecentFoodNames(userId, 3),
      this.recommendationEngine.getUserFeedbackWeights(userId),
    ]);

    // 用户偏好提取（loves/avoids）
    const foodPreferences = profile?.foodPreferences || [];
    const userPreferences: { loves?: string[]; avoids?: string[] } = {};
    // 从 foodPreferences 和 behaviorProfile 提取偏好，暂时保持简单
    if (foodPreferences.length > 0) {
      // foodPreferences 是用户标记的偏好类型（如 'sweet', 'fried' 等）
      // 后续可从 behaviorProfile.foodPreferences.loves/avoids 获取更精准的食物名
    }

    // 串行生成4餐，每餐选完后排除已选食物
    const excludeNames: string[] = [...recentFoodNames];

    const morningRec = this.recommendationEngine.recommendMealFromPool(
      allFoods,
      'breakfast',
      goalType,
      consumed,
      buildBudget(mealRatios.morning),
      dailyTarget,
      excludeNames,
      userPreferences,
      feedbackWeights,
      userProfileConstraints,
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
      feedbackWeights,
      userProfileConstraints,
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
      feedbackWeights,
      userProfileConstraints,
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
      feedbackWeights,
      userProfileConstraints,
    );

    const toMealPlan = (rec: typeof morningRec): MealPlan => ({
      foods: rec.displayText,
      calories: rec.totalCalories,
      protein: rec.totalProtein,
      fat: rec.totalFat,
      carbs: rec.totalCarbs,
      tip: rec.tip,
    });

    // ── 跨餐营养补偿校验 ──
    // 汇总 4 餐总宏量，检查是否严重偏离目标
    const allRecs = [morningRec, lunchRec, dinnerRec, snackRec];
    const planTotals = {
      calories: allRecs.reduce((s, r) => s + r.totalCalories, 0),
      protein: allRecs.reduce((s, r) => s + r.totalProtein, 0),
      carbs: allRecs.reduce((s, r) => s + r.totalCarbs, 0),
    };

    // 如果全天蛋白质严重不足（<70%目标），给晚餐追加高蛋白提示
    const proteinRatio = planTotals.protein / goals.protein;
    let compensationTip = '';
    if (proteinRatio < 0.7) {
      compensationTip = '全天蛋白质不足，建议晚餐加一份鸡蛋或豆腐';
    } else if (planTotals.calories > goals.calories * 1.15) {
      compensationTip = '全天热量偏高，建议减少加餐或晚餐份量';
    }

    const strategy = this.buildStrategy(goals.calories, profile, goalType)
      + (compensationTip ? `；${compensationTip}` : '');

    const plan = this.planRepo.create({
      userId,
      date,
      morningPlan: toMealPlan(morningRec),
      lunchPlan: toMealPlan(lunchRec),
      dinnerPlan: toMealPlan(dinnerRec),
      snackPlan: toMealPlan(snackRec),
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
    const today = new Date().toISOString().split('T')[0];
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
    const goal = plan.totalBudget || goals.calories;
    const remaining = Math.max(0, goal - summary.totalCalories);
    const hour = new Date().getHours();

    // 提取用户档案约束
    const userProfileConstraints = profile ? {
      dietaryRestrictions: profile.dietaryRestrictions || [],
      weakTimeSlots: profile.weakTimeSlots || [],
      discipline: profile.discipline,
      allergens: profile.allergens || [],
      healthConditions: profile.healthConditions || [],
    } : undefined;

    const consumed = {
      calories: summary.totalCalories || 0,
      protein: summary.totalProtein || 0,
    };
    const dailyTarget = { calories: goals.calories, protein: goals.protein };

    const toMealPlan = (rec: any): MealPlan => ({
      foods: rec.displayText,
      calories: rec.totalCalories,
      protein: rec.totalProtein,
      fat: rec.totalFat,
      carbs: rec.totalCarbs,
      tip: rec.tip,
    });

    // 根据剩余时段重新分配
    const adjustedMeals: Partial<
      Record<'morning' | 'lunch' | 'dinner' | 'snack', MealPlan>
    > = {};
    let adjustmentNote = '';

    if (remaining <= 0) {
      adjustmentNote = '今日热量已达标，建议不再进食';
      if (hour < 18) {
        adjustedMeals.dinner = {
          foods: '一碗清汤 + 蔬菜',
          calories: 150,
          protein: 5,
          fat: 3,
          carbs: 15,
          tip: '超标后清淡收口',
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
      adjustmentNote = `午餐建议控制在 ${lunchBudget} kcal，晚餐 ${dinnerBudget} kcal`;
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
      adjustmentNote = `晚餐预算调整为 ${remaining} kcal`;
    } else {
      adjustmentNote = `剩余 ${remaining} kcal，注意控制夜宵`;
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
   * 根据用户档案和目标类型生成今日策略
   */
  private buildStrategy(goal: number, profile: any, goalType: string): string {
    const strategies: string[] = [];

    const goalStrategies: Record<string, string> = {
      fat_loss: '减脂阶段：优先高蛋白食物，控制碳水，晚餐尽量清淡',
      muscle_gain: '增肌阶段：碳水蛋白并重，训练后及时补充',
      health: '健康维持：三餐均衡，注意蔬果摄入',
      habit: '习惯培养：保持规律饮食节奏，循序渐进',
    };
    strategies.push(goalStrategies[goalType] || goalStrategies.health);

    if (goal < 1600) strategies.push('低热量日，注意营养密度');
    else if (goal >= 2500) strategies.push('高热量日，分散进食避免积食');

    const hour = new Date().getHours();
    if (hour < 10) strategies.push('早起先喝一杯水');
    if (hour >= 14 && hour < 17) strategies.push('下午注意补水，防止假饥饿');

    return strategies.join('；');
  }
}
