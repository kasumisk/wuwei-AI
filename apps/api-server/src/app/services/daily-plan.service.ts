import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyPlan, MealPlan, PlanAdjustment } from '../../entities/daily-plan.entity';
import { FoodService } from './food.service';
import { UserProfileService } from './user-profile.service';

@Injectable()
export class DailyPlanService {
  private readonly logger = new Logger(DailyPlanService.name);

  constructor(
    @InjectRepository(DailyPlan)
    private readonly planRepo: Repository<DailyPlan>,
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
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

    const goal = summary.calorieGoal || (
      await this.userProfileService.getDailyCalorieGoal(userId)
    ) || 2000;

    // 按比例分配各餐预算
    const morningBudget = Math.round(goal * 0.25);
    const lunchBudget = Math.round(goal * 0.35);
    const dinnerBudget = Math.round(goal * 0.30);
    const snackBudget = Math.round(goal * 0.10);

    const morningPlan = this.buildMealPlan('breakfast', morningBudget, profile);
    const lunchPlan = this.buildMealPlan('lunch', lunchBudget, profile);
    const dinnerPlan = this.buildMealPlan('dinner', dinnerBudget, profile);
    const snackPlan = this.buildMealPlan('snack', snackBudget, profile);

    const strategy = this.buildStrategy(goal, profile);

    const plan = this.planRepo.create({
      userId,
      date,
      morningPlan,
      lunchPlan,
      dinnerPlan,
      snackPlan,
      strategy,
      totalBudget: goal,
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
        adjustedMeals.dinner = { foods: '一碗清汤 + 蔬菜', calories: 150, tip: '超标后清淡收口' };
        plan.dinnerPlan = adjustedMeals.dinner;
      }
    } else if (hour < 12) {
      // 午餐+晚餐重新分配
      const lunchBudget = Math.round(remaining * 0.55);
      const dinnerBudget = Math.round(remaining * 0.45);
      adjustedMeals.lunch = this.buildMealPlan('lunch', lunchBudget, null);
      adjustedMeals.dinner = this.buildMealPlan('dinner', dinnerBudget, null);
      plan.lunchPlan = adjustedMeals.lunch;
      plan.dinnerPlan = adjustedMeals.dinner;
      adjustmentNote = `午餐建议控制在 ${lunchBudget} kcal，晚餐 ${dinnerBudget} kcal`;
    } else if (hour < 18) {
      // 只调整晚餐
      const dinnerBudget = remaining;
      adjustedMeals.dinner = this.buildMealPlan('dinner', dinnerBudget, null);
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
   * 根据预算和用户档案构建单餐计划
   */
  private buildMealPlan(mealType: string, budget: number, profile: any): MealPlan {
    const presets: Record<string, Array<{ min: number; foods: string; cal: number; tip: string }>> = {
      breakfast: [
        { min: 500, foods: '燕麦粥 + 水煮蛋×2 + 苹果 + 坚果', cal: 480, tip: '高蛋白充能早餐' },
        { min: 400, foods: '燕麦粥 + 水煮蛋 + 苹果', cal: 380, tip: '均衡营养的早餐' },
        { min: 300, foods: '全麦面包 + 牛奶', cal: 280, tip: '简单营养搭配' },
        { min: 200, foods: '酸奶 + 香蕉', cal: 200, tip: '轻食早餐' },
        { min: 0, foods: '脱脂牛奶', cal: 120, tip: '极简补充' },
      ],
      lunch: [
        { min: 700, foods: '鸡胸肉 + 糙米饭 + 蔬菜沙拉 + 汤', cal: 650, tip: '丰富午餐' },
        { min: 550, foods: '鸡胸肉沙拉 + 糙米饭', cal: 550, tip: '高蛋白低脂午餐' },
        { min: 400, foods: '清蒸鱼 + 蒜炒青菜 + 半碗米饭', cal: 420, tip: '清淡均衡' },
        { min: 300, foods: '蔬菜沙拉 + 鸡蛋', cal: 300, tip: '控制午餐量' },
        { min: 0, foods: '蔬菜汤 + 全麦面包', cal: 200, tip: '轻量午餐' },
      ],
      dinner: [
        { min: 600, foods: '清蒸鱼 + 蒜炒青菜 + 半碗米饭', cal: 520, tip: '晚餐清淡为主' },
        { min: 450, foods: '水煮虾 + 西兰花 + 少量主食', cal: 420, tip: '高蛋白低碳' },
        { min: 350, foods: '水煮虾 + 西兰花', cal: 350, tip: '控碳晚餐' },
        { min: 250, foods: '凉拌豆腐 + 拍黄瓜', cal: 220, tip: '额度不多轻食为好' },
        { min: 100, foods: '一碗清汤 + 蔬菜', cal: 150, tip: '极简晚餐' },
        { min: 0, foods: '温水 + 少量坚果', cal: 80, tip: '额度紧张' },
      ],
      snack: [
        { min: 250, foods: '坚果一小把 + 酸奶 + 水果', cal: 230, tip: '健康加餐' },
        { min: 150, foods: '坚果一小把 + 酸奶', cal: 180, tip: '控量加餐' },
        { min: 80, foods: '一个苹果', cal: 80, tip: '水果补充' },
        { min: 0, foods: '黑咖啡或茶', cal: 5, tip: '零卡饮品' },
      ],
    };

    const options = presets[mealType] || presets.dinner;
    const match = options.find((o) => budget >= o.min) || options[options.length - 1];
    return { foods: match.foods, calories: match.cal, tip: match.tip };
  }

  /**
   * 根据用户档案生成今日策略
   */
  private buildStrategy(goal: number, profile: any): string {
    if (!profile) return `今日热量预算 ${goal} kcal，注意各餐均衡分配`;

    const strategies: string[] = [];
    if (goal < 1800) strategies.push('减脂阶段，优先蛋白质');
    if (goal >= 1800 && goal < 2200) strategies.push('维持阶段，均衡搭配');
    if (goal >= 2200) strategies.push('增肌阶段，碳水蛋白并重');

    const hour = new Date().getHours();
    if (hour < 10) strategies.push('早起先喝一杯水');
    if (hour >= 14 && hour < 17) strategies.push('下午注意补水，防止假饥饿');

    return strategies.join('；') || `今日预算 ${goal} kcal`;
  }
}
