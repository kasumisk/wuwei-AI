import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { NutritionScoreService } from './nutrition-score.service';
import { UserProfileService } from '../../user/app/user-profile.service';
import { FoodRecordService } from './food-record.service';
import {
  getUserLocalDate,
  getUserLocalDayBounds,
} from '../../../common/utils/timezone.util';

@Injectable()
export class DailySummaryService {
  private readonly logger = new Logger(DailySummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly userProfileService: UserProfileService,
    private readonly foodRecordService: FoodRecordService,
  ) {}

  /**
   * 获取今日汇总
   */
  async getTodaySummary(userId: string): Promise<{
    totalCalories: number;
    calorieGoal: number | null;
    mealCount: number;
    remaining: number;
    totalProtein: number;
    totalFat: number;
    totalCarbs: number;
    avgQuality: number;
    avgSatiety: number;
    nutritionScore: number;
    proteinGoal: number;
    fatGoal: number;
    carbsGoal: number;
  }> {
    const tz = await this.userProfileService.getTimezone(userId);
    const today = getUserLocalDate(tz);
    const summary = await this.prisma.daily_summaries.findFirst({
      where: { user_id: userId, date: new Date(today) },
    });

    if (!summary) {
      // 实时计算
      const records = await this.foodRecordService.getTodayRecords(userId, tz);
      const totalCalories = records.reduce(
        (sum, r) => sum + r.total_calories,
        0,
      );
      return {
        totalCalories,
        calorieGoal: null,
        mealCount: records.length,
        remaining: 0,
        totalProtein: records.reduce(
          (s, r) => s + (Number(r.total_protein) || 0),
          0,
        ),
        totalFat: records.reduce((s, r) => s + (Number(r.total_fat) || 0), 0),
        totalCarbs: records.reduce(
          (s, r) => s + (Number(r.total_carbs) || 0),
          0,
        ),
        avgQuality: 0,
        avgSatiety: 0,
        nutritionScore: 0,
        proteinGoal: 0,
        fatGoal: 0,
        carbsGoal: 0,
      };
    }

    return {
      totalCalories: summary.total_calories,
      calorieGoal: summary.calorie_goal ?? null,
      mealCount: summary.meal_count,
      remaining: summary.calorie_goal
        ? Math.max(0, summary.calorie_goal - summary.total_calories)
        : 0,
      totalProtein: Number(summary.total_protein) || 0,
      totalFat: Number(summary.total_fat) || 0,
      totalCarbs: Number(summary.total_carbs) || 0,
      avgQuality: Number(summary.avg_quality) || 0,
      avgSatiety: Number(summary.avg_satiety) || 0,
      nutritionScore: Number(summary.nutrition_score) || 0,
      proteinGoal: Number(summary.protein_goal) || 0,
      fatGoal: Number(summary.fat_goal) || 0,
      carbsGoal: Number(summary.carbs_goal) || 0,
    };
  }

  /**
   * 获取最近 N 天的汇总数据（趋势图用）
   */
  async getRecentSummaries(userId: string, days: number = 7) {
    const tz = await this.userProfileService.getTimezone(userId);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceDate = getUserLocalDate(tz, since);

    return this.prisma.daily_summaries.findMany({
      where: {
        user_id: userId,
        date: { gte: new Date(sinceDate) },
      },
      orderBy: { date: 'asc' },
    });
  }

  /**
   * 更新某天的每日汇总
   */
  async updateDailySummary(userId: string, recordDate: Date): Promise<void> {
    const tz = await this.userProfileService.getTimezone(userId);
    const date = getUserLocalDate(tz, recordDate);
    const { startOfDay, endOfDay } = getUserLocalDayBounds(tz, recordDate);

    const records = await this.foodRecordService.getRecordsByDateRange(
      userId,
      startOfDay,
      endOfDay,
    );

    const totalCalories = records.reduce((sum, r) => sum + r.total_calories, 0);

    // V6: 多维汇总
    const totalProtein = records.reduce(
      (s, r) => s + (Number(r.total_protein) || 0),
      0,
    );
    const totalFat = records.reduce(
      (s, r) => s + (Number(r.total_fat) || 0),
      0,
    );
    const totalCarbs = records.reduce(
      (s, r) => s + (Number(r.total_carbs) || 0),
      0,
    );

    // 加权平均质量分和饱腹分（按热量权重）
    const totalCal = totalCalories || 1;
    const avgQuality =
      records.reduce(
        (s, r) => s + (Number(r.avg_quality) || 0) * r.total_calories,
        0,
      ) / totalCal;
    const avgSatiety =
      records.reduce(
        (s, r) => s + (Number(r.avg_satiety) || 0) * r.total_calories,
        0,
      ) / totalCal;

    // 营养目标（从用户档案计算）
    let profile: {
      goal?: string;
      weightKg?: number | null;
      dailyCalorieGoal?: number | null;
    } | null = null;
    let goals = {
      calories: 2000,
      protein: 0,
      fat: 0,
      carbs: 0,
      quality: 7,
      satiety: 6,
    };
    try {
      profile = await this.userProfileService.getProfile(userId);
      goals = this.nutritionScoreService.calculateDailyGoals(profile);
    } catch {
      /* ignore */
    }

    // 综合评分
    const goalType = profile?.goal || 'health';
    const scoreResult = this.nutritionScoreService.calculateScore(
      {
        calories: totalCalories,
        targetCalories: goals.calories,
        protein: totalProtein,
        fat: totalFat,
        carbs: totalCarbs,
        foodQuality: avgQuality || 3,
        satiety: avgSatiety || 3,
      },
      goalType,
    );

    let summary = await this.prisma.daily_summaries.findFirst({
      where: { user_id: userId, date: new Date(date) },
    });

    const summaryData = {
      total_calories: totalCalories,
      meal_count: records.length,
      total_protein: totalProtein,
      total_fat: totalFat,
      total_carbs: totalCarbs,
      avg_quality: Math.round(avgQuality * 10) / 10,
      avg_satiety: Math.round(avgSatiety * 10) / 10,
      nutrition_score: scoreResult.score,
      protein_goal: goals.protein,
      fat_goal: goals.fat,
      carbs_goal: goals.carbs,
      calorie_goal: goals.calories,
    };

    if (summary) {
      await this.prisma.daily_summaries.update({
        where: { id: summary.id },
        data: summaryData,
      });
    } else {
      await this.prisma.daily_summaries.create({
        data: {
          user_id: userId,
          date: new Date(date),
          ...summaryData,
        },
      });
    }
  }
}
