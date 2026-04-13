import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  DailyGoalProfile,
  NutritionScoreService,
} from './nutrition-score.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { FoodRecordService } from './food-record.service';
import {
  getUserLocalDate,
  getUserLocalDayBounds,
} from '../../../../common/utils/timezone.util';

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
    const summary = await this.prisma.dailySummaries.findFirst({
      where: { userId: userId, date: new Date(today) },
    });

    if (!summary) {
      // 实时计算
      const records = await this.foodRecordService.getTodayRecords(userId, tz);
      const totalCalories = records.reduce(
        (sum, r) => sum + r.totalCalories,
        0,
      );
      return {
        totalCalories,
        calorieGoal: null,
        mealCount: records.length,
        remaining: 0,
        totalProtein: records.reduce(
          (s, r) => s + (Number(r.totalProtein) || 0),
          0,
        ),
        totalFat: records.reduce((s, r) => s + (Number(r.totalFat) || 0), 0),
        totalCarbs: records.reduce(
          (s, r) => s + (Number(r.totalCarbs) || 0),
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
      totalCalories: summary.totalCalories,
      calorieGoal: summary.calorieGoal ?? null,
      mealCount: summary.mealCount,
      remaining: summary.calorieGoal
        ? Math.max(0, summary.calorieGoal - summary.totalCalories)
        : 0,
      totalProtein: Number(summary.totalProtein) || 0,
      totalFat: Number(summary.totalFat) || 0,
      totalCarbs: Number(summary.totalCarbs) || 0,
      avgQuality: Number(summary.avgQuality) || 0,
      avgSatiety: Number(summary.avgSatiety) || 0,
      nutritionScore: Number(summary.nutritionScore) || 0,
      proteinGoal: Number(summary.proteinGoal) || 0,
      fatGoal: Number(summary.fatGoal) || 0,
      carbsGoal: Number(summary.carbsGoal) || 0,
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

    return this.prisma.dailySummaries.findMany({
      where: {
        userId: userId,
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

    const totalCalories = records.reduce((sum, r) => sum + r.totalCalories, 0);

    // V6: 多维汇总
    const totalProtein = records.reduce(
      (s, r) => s + (Number(r.totalProtein) || 0),
      0,
    );
    const totalFat = records.reduce(
      (s, r) => s + (Number(r.totalFat) || 0),
      0,
    );
    const totalCarbs = records.reduce(
      (s, r) => s + (Number(r.totalCarbs) || 0),
      0,
    );

    // 加权平均质量分和饱腹分（按热量权重）
    const totalCal = totalCalories || 1;
    const avgQuality =
      records.reduce(
        (s, r) => s + (Number(r.avgQuality) || 0) * r.totalCalories,
        0,
      ) / totalCal;
    const avgSatiety =
      records.reduce(
        (s, r) => s + (Number(r.avgSatiety) || 0) * r.totalCalories,
        0,
      ) / totalCal;

    // 营养目标（从用户档案计算）
    let profile: DailyGoalProfile | null = null;
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

    let summary = await this.prisma.dailySummaries.findFirst({
      where: { userId: userId, date: new Date(date) },
    });

    const summaryData = {
      totalCalories: totalCalories,
      mealCount: records.length,
      totalProtein: totalProtein,
      totalFat: totalFat,
      totalCarbs: totalCarbs,
      avgQuality: Math.round(avgQuality * 10) / 10,
      avgSatiety: Math.round(avgSatiety * 10) / 10,
      nutritionScore: scoreResult.score,
      proteinGoal: goals.protein,
      fatGoal: goals.fat,
      carbsGoal: goals.carbs,
      calorieGoal: goals.calories,
    };

    if (summary) {
      await this.prisma.dailySummaries.update({
        where: { id: summary.id },
        data: summaryData,
      });
    } else {
      await this.prisma.dailySummaries.create({
        data: {
          userId: userId,
          date: new Date(date),
          ...summaryData,
        },
      });
    }
  }
}
