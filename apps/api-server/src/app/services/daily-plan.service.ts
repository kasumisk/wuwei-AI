import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyPlan, MealPlan, PlanAdjustment } from '../../entities/daily-plan.entity';
import { FoodService } from './food.service';
import { UserProfileService } from './user-profile.service';
import { NutritionScoreService } from './nutrition-score.service';
import { RecommendationEngineService, MealTarget } from './recommendation-engine.service';

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
   * 规则引擎生成每日计划（基于食物库推荐，零 AI 成本）
   */
  private async generatePlan(userId: string, date: string): Promise<DailyPlan> {
    const [summary, profile] = await Promise.all([
      this.foodService.getTodaySummary(userId),
      this.userProfileService.getProfile(userId),
    ]);

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const goalType = profile?.goal || 'health';

    // 按比例分配各餐「多维预算」
    const mealRatios = { morning: 0.25, lunch: 0.35, dinner: 0.30, snack: 0.10 };

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

    // 一次性获取食物库 + 最近记录（减少查询：8次→2次）
    const [allFoods, recentFoodNames] = await Promise.all([
      this.recommendationEngine.getAllFoods(),
      this.recommendationEngine.getRecentFoodNames(userId, 3),
    ]);

    // 串行生成4餐，每餐选完后排除已选食物
    const excludeNames: string[] = [...recentFoodNames];

    const morningRec = this.recommendationEngine.recommendMealFromPool(
      allFoods, 'breakfast', goalType, consumed, buildBudget(mealRatios.morning), dailyTarget, excludeNames,
    );
    excludeNames.push(...morningRec.foods.map(f => f.food.name));

    const lunchRec = this.recommendationEngine.recommendMealFromPool(
      allFoods, 'lunch', goalType, consumed, buildBudget(mealRatios.lunch), dailyTarget, excludeNames,
    );
    excludeNames.push(...lunchRec.foods.map(f => f.food.name));

    const dinnerRec = this.recommendationEngine.recommendMealFromPool(
      allFoods, 'dinner', goalType, consumed, buildBudget(mealRatios.dinner), dailyTarget, excludeNames,
    );
    excludeNames.push(...dinnerRec.foods.map(f => f.food.name));

    const snackRec = this.recommendationEngine.recommendMealFromPool(
      allFoods, 'snack', goalType, consumed, buildBudget(mealRatios.snack), dailyTarget, excludeNames,
    );

    const toMealPlan = (rec: typeof morningRec): MealPlan => ({
      foods: rec.displayText,
      calories: rec.totalCalories,
      protein: rec.totalProtein,
      fat: rec.totalFat,
      carbs: rec.totalCarbs,
      tip: rec.tip,
    });

    const strategy = this.buildStrategy(goals.calories, profile, goalType);

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
  async adjustPlan(userId: string, reason: string): Promise<{ updatedPlan: DailyPlan; adjustmentNote: string }> {
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

    const consumed = { calories: summary.totalCalories || 0, protein: summary.totalProtein || 0 };
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
    const adjustedMeals: Partial<Record<'morning' | 'lunch' | 'dinner' | 'snack', MealPlan>> = {};
    let adjustmentNote = '';

    if (remaining <= 0) {
      adjustmentNote = '今日热量已达标，建议不再进食';
      if (hour < 18) {
        adjustedMeals.dinner = { foods: '一碗清汤 + 蔬菜', calories: 150, protein: 5, fat: 3, carbs: 15, tip: '超标后清淡收口' };
        plan.dinnerPlan = adjustedMeals.dinner;
      }
    } else if (hour < 12) {
      // 午餐+晚餐重新分配
      const lunchBudget = Math.round(remaining * 0.55);
      const dinnerBudget = Math.round(remaining * 0.45);
      const proteinRem = Math.max(0, goals.protein - (summary.totalProtein || 0));
      const [lunchRec, dinnerRec] = await Promise.all([
        this.recommendationEngine.recommendMeal(userId, 'lunch', goalType, consumed,
          { calories: lunchBudget, protein: Math.round(proteinRem * 0.55), fat: Math.round(goals.fat * 0.35), carbs: Math.round(goals.carbs * 0.35) }, dailyTarget),
        this.recommendationEngine.recommendMeal(userId, 'dinner', goalType, consumed,
          { calories: dinnerBudget, protein: Math.round(proteinRem * 0.45), fat: Math.round(goals.fat * 0.30), carbs: Math.round(goals.carbs * 0.30) }, dailyTarget),
      ]);
      adjustedMeals.lunch = toMealPlan(lunchRec);
      adjustedMeals.dinner = toMealPlan(dinnerRec);
      plan.lunchPlan = adjustedMeals.lunch;
      plan.dinnerPlan = adjustedMeals.dinner;
      adjustmentNote = `午餐建议控制在 ${lunchBudget} kcal，晚餐 ${dinnerBudget} kcal`;
    } else if (hour < 18) {
      // 只调整晚餐
      const proteinRem = Math.max(0, goals.protein - (summary.totalProtein || 0));
      const dinnerRec = await this.recommendationEngine.recommendMeal(userId, 'dinner', goalType, consumed,
        { calories: remaining, protein: proteinRem, fat: Math.round(goals.fat * 0.30), carbs: Math.round(goals.carbs * 0.30) }, dailyTarget);
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
