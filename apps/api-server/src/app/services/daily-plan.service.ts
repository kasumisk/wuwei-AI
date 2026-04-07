import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyPlan, MealPlan, PlanAdjustment } from '../../entities/daily-plan.entity';
import { FoodService } from './food.service';
import { UserProfileService } from './user-profile.service';
import { NutritionScoreService } from './nutrition-score.service';

@Injectable()
export class DailyPlanService {
  private readonly logger = new Logger(DailyPlanService.name);

  constructor(
    @InjectRepository(DailyPlan)
    private readonly planRepo: Repository<DailyPlan>,
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
    private readonly nutritionScoreService: NutritionScoreService,
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
   * 规则引擎生成每日计划（零 AI 成本）
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

    const buildBudget = (r: number) => ({
      calories: Math.round(goals.calories * r),
      protein: Math.round(goals.protein * r),
      fat: Math.round(goals.fat * r),
      carbs: Math.round(goals.carbs * r),
    });

    const morningPlan = this.buildMealPlan('breakfast', buildBudget(mealRatios.morning), goalType);
    const lunchPlan = this.buildMealPlan('lunch', buildBudget(mealRatios.lunch), goalType);
    const dinnerPlan = this.buildMealPlan('dinner', buildBudget(mealRatios.dinner), goalType);
    const snackPlan = this.buildMealPlan('snack', buildBudget(mealRatios.snack), goalType);

    const strategy = this.buildStrategy(goals.calories, profile, goalType);

    const plan = this.planRepo.create({
      userId,
      date,
      morningPlan,
      lunchPlan,
      dinnerPlan,
      snackPlan,
      strategy,
      totalBudget: goals.calories,
      adjustments: [],
    });

    return this.planRepo.save(plan);
  }

  /**
   * 动态调整计划（记录偏离后调用）
   */
  async adjustPlan(userId: string, reason: string): Promise<{ updatedPlan: DailyPlan; adjustmentNote: string }> {
    const today = new Date().toISOString().split('T')[0];
    let plan = await this.planRepo.findOne({ where: { userId, date: today } });
    if (!plan) {
      plan = await this.generatePlan(userId, today);
    }

    const summary = await this.foodService.getTodaySummary(userId);
    const goal = plan.totalBudget || 2000;
    const remaining = Math.max(0, goal - summary.totalCalories);
    const hour = new Date().getHours();

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
      adjustedMeals.lunch = this.buildMealPlan('lunch', { calories: lunchBudget, protein: 0, fat: 0, carbs: 0 }, 'health');
      adjustedMeals.dinner = this.buildMealPlan('dinner', { calories: dinnerBudget, protein: 0, fat: 0, carbs: 0 }, 'health');
      plan.lunchPlan = adjustedMeals.lunch;
      plan.dinnerPlan = adjustedMeals.dinner;
      adjustmentNote = `午餐建议控制在 ${lunchBudget} kcal，晚餐 ${dinnerBudget} kcal`;
    } else if (hour < 18) {
      // 只调整晚餐
      const dinnerBudget = remaining;
      adjustedMeals.dinner = this.buildMealPlan('dinner', { calories: dinnerBudget, protein: 0, fat: 0, carbs: 0 }, 'health');
      plan.dinnerPlan = adjustedMeals.dinner;
      adjustmentNote = `晚餐预算调整为 ${dinnerBudget} kcal`;
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
   * 根据多维预算构建单餐计划
   */
  private buildMealPlan(
    mealType: string,
    budget: { calories: number; protein: number; fat: number; carbs: number },
    goalType: string,
  ): MealPlan {
    const presets: Record<string, Array<{ min: number; foods: string; cal: number; protein: number; fat: number; carbs: number; tip: string }>> = {
      breakfast: [
        { min: 500, foods: '燕麦粥 + 水煮蛋×2 + 苹果 + 坚果', cal: 480, protein: 22, fat: 16, carbs: 58, tip: '高蛋白充能早餐' },
        { min: 400, foods: '燕麦粥 + 水煮蛋 + 苹果', cal: 380, protein: 15, fat: 10, carbs: 52, tip: '均衡营养的早餐' },
        { min: 300, foods: '全麦面包 + 牛奶', cal: 280, protein: 12, fat: 8, carbs: 38, tip: '简单营养搭配' },
        { min: 200, foods: '酸奶 + 香蕉', cal: 200, protein: 8, fat: 5, carbs: 30, tip: '轻食早餐' },
        { min: 0, foods: '脱脂牛奶', cal: 120, protein: 8, fat: 1, carbs: 12, tip: '极简补充' },
      ],
      lunch: [
        { min: 700, foods: '鸡胸肉 + 糙米饭 + 蔬菜沙拉 + 汤', cal: 650, protein: 40, fat: 15, carbs: 75, tip: '丰富午餐' },
        { min: 550, foods: '鸡胸肉沙拉 + 糙米饭', cal: 550, protein: 35, fat: 12, carbs: 60, tip: '高蛋白低脂午餐' },
        { min: 400, foods: '清蒸鱼 + 蒜炒青菜 + 半碗米饭', cal: 420, protein: 28, fat: 10, carbs: 45, tip: '清淡均衡' },
        { min: 300, foods: '蔬菜沙拉 + 鸡蛋', cal: 300, protein: 15, fat: 12, carbs: 28, tip: '控制午餐量' },
        { min: 0, foods: '蔬菜汤 + 全麦面包', cal: 200, protein: 8, fat: 5, carbs: 30, tip: '轻量午餐' },
      ],
      dinner: [
        { min: 600, foods: '清蒸鱼 + 蒜炒青菜 + 半碗米饭', cal: 520, protein: 32, fat: 12, carbs: 55, tip: '晚餐清淡为主' },
        { min: 450, foods: '水煮虾 + 西兰花 + 少量主食', cal: 420, protein: 30, fat: 8, carbs: 40, tip: '高蛋白低碳' },
        { min: 350, foods: '水煮虾 + 西兰花', cal: 350, protein: 28, fat: 6, carbs: 30, tip: '控碳晚餐' },
        { min: 250, foods: '凉拌豆腐 + 拍黄瓜', cal: 220, protein: 12, fat: 8, carbs: 22, tip: '额度不多轻食为好' },
        { min: 100, foods: '一碗清汤 + 蔬菜', cal: 150, protein: 5, fat: 3, carbs: 15, tip: '极简晚餐' },
        { min: 0, foods: '温水 + 少量坚果', cal: 80, protein: 3, fat: 6, carbs: 3, tip: '额度紧张' },
      ],
      snack: [
        { min: 250, foods: '坚果一小把 + 酸奶 + 水果', cal: 230, protein: 10, fat: 12, carbs: 22, tip: '健康加餐' },
        { min: 150, foods: '坚果一小把 + 酸奶', cal: 180, protein: 8, fat: 10, carbs: 14, tip: '控量加餐' },
        { min: 80, foods: '一个苹果', cal: 80, protein: 0, fat: 0, carbs: 20, tip: '水果补充' },
        { min: 0, foods: '黑咖啡或茶', cal: 5, protein: 0, fat: 0, carbs: 0, tip: '零卡饮品' },
      ],
    };

    // 根据目标类型微调 tip
    const goalTips: Record<string, string> = {
      fat_loss: '（减脂期优先蛋白质）',
      muscle_gain: '（增肌期注意碳水补充）',
      health: '',
      habit: '',
    };
    const suffix = goalTips[goalType] || '';

    const options = presets[mealType] || presets.dinner;
    const match = options.find((o) => budget.calories >= o.min) || options[options.length - 1];
    return {
      foods: match.foods,
      calories: match.cal,
      protein: match.protein,
      fat: match.fat,
      carbs: match.carbs,
      tip: match.tip + suffix,
    };
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
