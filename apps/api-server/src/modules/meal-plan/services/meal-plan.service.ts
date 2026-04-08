import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyPlan, MealPlan } from '../entities/daily-plan.entity';
import { UserProfileService } from '../../user-profile/services/user-profile.service';
import { RecommendationService } from '../../recommendation/services/recommendation.service';
import { NutritionService } from '../../nutrition/services/nutrition.service';
import { todayStr } from '../../../shared/utils/date.utils';

@Injectable()
export class MealPlanService {
  private readonly logger = new Logger(MealPlanService.name);

  constructor(
    @InjectRepository(DailyPlan)
    private planRepo: Repository<DailyPlan>,
    private profileService: UserProfileService,
    private recommendationService: RecommendationService,
    private nutritionService: NutritionService,
  ) {}

  async getTodayPlan(userId: string): Promise<DailyPlan | null> {
    return this.planRepo.findOne({
      where: { userId, date: todayStr() },
    });
  }

  async generatePlan(userId: string, date?: string): Promise<DailyPlan> {
    const d = date || todayStr();
    const profile = await this.profileService.getOrCreate(userId);
    const totalBudget = profile.dailyCalorieGoal || 2000;

    // Generate recommendations for each meal
    const [breakfastRecs, lunchRecs, dinnerRecs, snackRecs] = await Promise.all([
      this.recommendationService.recommend(userId, 'breakfast', 3),
      this.recommendationService.recommend(userId, 'lunch', 3),
      this.recommendationService.recommend(userId, 'dinner', 3),
      this.recommendationService.recommend(userId, 'snack', 2),
    ]);

    const morningPlan = this.buildMealPlan(breakfastRecs, totalBudget * 0.25);
    const lunchPlan = this.buildMealPlan(lunchRecs, totalBudget * 0.35);
    const dinnerPlan = this.buildMealPlan(dinnerRecs, totalBudget * 0.3);
    const snackPlan = this.buildMealPlan(snackRecs, totalBudget * 0.1);

    const plan = this.planRepo.create({
      userId,
      date: d,
      morningPlan,
      lunchPlan,
      dinnerPlan,
      snackPlan,
      totalBudget,
      strategy: `Target ${totalBudget}kcal, goal: ${profile.goal}`,
    });

    return this.planRepo.save(plan);
  }

  async adjustPlan(userId: string, adjustment: { reason: string; changes: Partial<Record<'morning' | 'lunch' | 'dinner' | 'snack', MealPlan>> }): Promise<DailyPlan> {
    let plan = await this.getTodayPlan(userId);
    if (!plan) {
      plan = await this.generatePlan(userId);
    }

    plan.adjustments = [
      ...plan.adjustments,
      {
        time: new Date().toISOString(),
        reason: adjustment.reason,
        newPlan: adjustment.changes,
      },
    ];

    // Apply changes
    if (adjustment.changes.morning) plan.morningPlan = adjustment.changes.morning;
    if (adjustment.changes.lunch) plan.lunchPlan = adjustment.changes.lunch;
    if (adjustment.changes.dinner) plan.dinnerPlan = adjustment.changes.dinner;
    if (adjustment.changes.snack) plan.snackPlan = adjustment.changes.snack;

    return this.planRepo.save(plan);
  }

  private buildMealPlan(recs: any[], calorieTarget: number): MealPlan {
    if (recs.length === 0) {
      return { foods: '', calories: 0, protein: 0, fat: 0, carbs: 0, tip: '暂无推荐' };
    }

    const topFood = recs[0].food;
    return {
      foods: recs.map((r) => r.food.name).join(', '),
      calories: Math.round(calorieTarget),
      protein: Number(topFood.protein) || 0,
      fat: Number(topFood.fat) || 0,
      carbs: Number(topFood.carbs) || 0,
      tip: `推荐评分: ${recs[0].score}`,
    };
  }
}
