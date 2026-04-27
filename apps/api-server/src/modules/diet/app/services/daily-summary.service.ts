import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  DailyGoalProfile,
  NutritionScoreService,
} from './nutrition-score.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { FoodRecordService } from './food-record.service';
import { BehaviorService } from './behavior.service';
import {
  getUserLocalDate,
  getUserLocalDayBounds,
  getUserLocalHour,
} from '../../../../common/utils/timezone.util';

@Injectable()
export class DailySummaryService {
  private readonly logger = new Logger(DailySummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly userProfileService: UserProfileService,
    private readonly foodRecordService: FoodRecordService,
    @Inject(forwardRef(() => BehaviorService))
    private readonly behaviorService: BehaviorService,
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
      // 实时计算（含真实目标和评分）
      const records = await this.foodRecordService.getTodayRecords(userId, tz);
      const totalCalories = records.reduce(
        (sum, r) => sum + r.totalCalories,
        0,
      );
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

      // 从用户档案计算真实目标
      let goals = {
        calories: 2000,
        protein: 0,
        fat: 0,
        carbs: 0,
        quality: 7,
        satiety: 6,
      };
      let profile: DailyGoalProfile | null = null;
      try {
        profile = await this.userProfileService.getProfile(userId);
        goals = this.nutritionScoreService.calculateDailyGoals(profile);
      } catch {
        /* ignore */
      }

      // 加权平均质量分和饱腹分
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

      // 计算真实评分（有记录时）
      let nutritionScore = 0;
      if (records.length > 0) {
        try {
          const goalType = profile?.goal || 'health';
          const localHour = getUserLocalHour(tz);
          const mealSignals = this.nutritionScoreService.aggregateMealSignals(
            records,
            Number((profile as any)?.mealsPerDay) || 3,
          );
          const { avgGI, totalCarbsFromFoods } =
            this.aggregateGlycemicData(records);
          const scoreResult = this.nutritionScoreService.calculateScore(
            {
              calories: totalCalories,
              targetCalories: goals.calories,
              protein: totalProtein,
              fat: totalFat,
              carbs: totalCarbs,
              // Bug-Fix: 传入宏量绝对量目标
              targetProtein: goals.protein,
              targetCarbs: goals.carbs,
              targetFat: goals.fat,
              foodQuality: avgQuality || 3,
              satiety: avgSatiety || 3,
              glycemicIndex: avgGI || undefined,
              carbsPerServing: totalCarbsFromFoods || undefined,
            },
            goalType,
            undefined,
            (profile as any)?.healthConditions || undefined,
            localHour,
            mealSignals,
          );
          nutritionScore = scoreResult.score;
        } catch {
          /* score calculation failed — keep 0 */
        }
      }

      const remaining = Math.max(0, goals.calories - totalCalories);

      return {
        totalCalories,
        calorieGoal: goals.calories,
        mealCount: records.length,
        remaining,
        totalProtein,
        totalFat,
        totalCarbs,
        avgQuality: Math.round(avgQuality * 10) / 10,
        avgSatiety: Math.round(avgSatiety * 10) / 10,
        nutritionScore,
        proteinGoal: goals.protein,
        fatGoal: goals.fat,
        carbsGoal: goals.carbs,
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
    const totalFat = records.reduce((s, r) => s + (Number(r.totalFat) || 0), 0);
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

    // P1.1: 注入真实 stabilityData（从 BehaviorService 获取）
    let stabilityData:
      | {
          streakDays: number;
          avgMealsPerDay: number;
          targetMeals: number;
          complianceRate?: number;
        }
      | undefined;
    try {
      const behaviorProfile = await this.behaviorService.getProfile(userId);
      stabilityData = {
        streakDays: behaviorProfile.streakDays || 0,
        avgMealsPerDay: records.length,
        targetMeals: Number((profile as any)?.mealsPerDay) || 3,
        complianceRate: Number(behaviorProfile.avgComplianceRate) || 0,
      };
    } catch {
      /* behavior profile unavailable — use default */
    }

    // P1.2: 修复 fallback — 有记录时用真实值，无记录不虚高
    // V1.3: 注入 localHour 实现时间感知评分
    const localHour = getUserLocalHour(tz);
    // V1.4: 聚合每餐决策信号
    const mealSignals = this.nutritionScoreService.aggregateMealSignals(
      records,
      Number((profile as any)?.mealsPerDay) || 3,
    );
    const scoreResult = this.nutritionScoreService.calculateScore(
      {
        calories: totalCalories,
        targetCalories: goals.calories,
        protein: totalProtein,
        fat: totalFat,
        carbs: totalCarbs,
        // Bug-Fix: 传入宏量绝对量目标
        targetProtein: goals.protein,
        targetCarbs: goals.carbs,
        targetFat: goals.fat,
        foodQuality: records.length > 0 ? avgQuality || 3 : 0,
        satiety: records.length > 0 ? avgSatiety || 3 : 0,
      },
      goalType,
      stabilityData,
      (profile as any)?.healthConditions || undefined,
      localHour,
      mealSignals,
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
      // V8: 来源统计
      sourceBreakdown: records.reduce(
        (acc, r) => {
          const src = (r as any).source || 'manual';
          acc[src] = (acc[src] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      recommendExecutionCount: records.filter(
        (r) => (r as any).source === 'recommend',
      ).length,
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

  /**
   * 从食物记录的 foods JSON 聚合加权平均 GI 和总碳水
   */
  private aggregateGlycemicData(records: any[]): {
    avgGI: number;
    totalCarbsFromFoods: number;
  } {
    let totalCarbs = 0;
    let weightedGISum = 0;
    for (const record of records) {
      const foods = Array.isArray(record.foods) ? record.foods : [];
      for (const food of foods) {
        const gi = Number(food.glycemicIndex) || 0;
        const carbs = Number(food.carbs) || Number(food.carbsG) || 0;
        if (gi > 0 && carbs > 0) {
          weightedGISum += gi * carbs;
          totalCarbs += carbs;
        }
      }
    }
    return {
      avgGI: totalCarbs > 0 ? Math.round(weightedGISum / totalCarbs) : 0,
      totalCarbsFromFoods: Math.round(totalCarbs),
    };
  }
}
