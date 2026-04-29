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
import { I18nService } from '../../../../core/i18n';
import { RequestContextService } from '../../../../core/context/request-context.service';
import type { I18nLocale } from '../../../../core/i18n';

type DailyMetricStatus = 'no_data' | 'low' | 'normal' | 'high';
type DailyScoreStatus = 'no_data' | 'needs_work' | 'fair' | 'good';
type DailyTrendDirection = 'insufficient' | 'up' | 'down' | 'stable';

interface DailyMetricView {
  value: number;
  goal: number;
  ratio: number | null;
  diff: number;
  status: DailyMetricStatus;
}

interface DailySummaryInsightView {
  calories: DailyMetricView;
  macros: {
    protein: DailyMetricView;
    fat: DailyMetricView;
    carbs: DailyMetricView;
  };
  score: number;
  scoreStatus: DailyScoreStatus;
  dataStatus: 'empty' | 'recorded';
  tags: string[];
  summary: string;
  trend: {
    calories: DailyTrendDirection;
    caloriesDelta: number | null;
    score: DailyTrendDirection;
    scoreDelta: number | null;
  };
}

@Injectable()
export class DailySummaryService {
  private readonly logger = new Logger(DailySummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly userProfileService: UserProfileService,
    private readonly foodRecordService: FoodRecordService,
    private readonly i18n: I18nService,
    private readonly requestCtx: RequestContextService,
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
    const locale = I18nService.normalizeLocale(this.requestCtx.locale);
    const tz = await this.userProfileService.getTimezone(userId);
    const safeDays = Math.min(Math.max(Math.trunc(days) || 7, 1), 90);
    const todayKey = getUserLocalDate(tz);
    const startKey = this.addDaysToDateKey(todayKey, -(safeDays - 1));

    let goals = {
      calories: 2000,
      protein: 0,
      fat: 0,
      carbs: 0,
      quality: 7,
      satiety: 6,
    };
    try {
      const profile = await this.userProfileService.getProfile(userId);
      goals = this.nutritionScoreService.calculateDailyGoals(profile);
    } catch {
      /* keep default goals */
    }

    const rows = await this.prisma.dailySummaries.findMany({
      where: {
        userId: userId,
        date: {
          gte: new Date(`${startKey}T00:00:00.000Z`),
          lte: new Date(`${todayKey}T00:00:00.000Z`),
        },
      },
      orderBy: { date: 'asc' },
    });

    const byDate = new Map(
      rows.map((row) => [this.toDateKey(row.date), row] as const),
    );
    let previousRecorded: DailySummaryInsightView | null = null;

    return Array.from({ length: safeDays }, (_, index) => {
      const dateKey = this.addDaysToDateKey(startKey, index);
      const row = byDate.get(dateKey);
      const mealCount = row?.mealCount ?? 0;
      const calorieGoal = row?.calorieGoal ?? goals.calories;
      const proteinGoal = this.toNumber(row?.proteinGoal) || goals.protein;
      const fatGoal = this.toNumber(row?.fatGoal) || goals.fat;
      const carbsGoal = this.toNumber(row?.carbsGoal) || goals.carbs;

      const base = {
        id: row?.id ?? '',
        userId,
        date: row?.date ?? new Date(`${dateKey}T00:00:00.000Z`),
        totalCalories: row?.totalCalories ?? 0,
        calorieGoal,
        mealCount,
        totalProtein: this.round(this.toNumber(row?.totalProtein), 1),
        totalFat: this.round(this.toNumber(row?.totalFat), 1),
        totalCarbs: this.round(this.toNumber(row?.totalCarbs), 1),
        avgQuality: this.round(this.toNumber(row?.avgQuality), 1),
        avgSatiety: this.round(this.toNumber(row?.avgSatiety), 1),
        nutritionScore: row?.nutritionScore ?? 0,
        proteinGoal,
        fatGoal,
        carbsGoal,
        createdAt: row?.createdAt ?? null,
        updatedAt: row?.updatedAt ?? null,
        sourceBreakdown: this.normalizeSourceBreakdown(row?.sourceBreakdown),
        recommendExecutionCount: row?.recommendExecutionCount ?? 0,
      };
      const insight = this.buildDailyInsight(base, previousRecorded, locale);
      if (mealCount > 0) previousRecorded = insight;
      return { ...base, ...insight };
    });
  }

  private buildDailyInsight(
    day: {
      totalCalories: number;
      calorieGoal: number;
      mealCount: number;
      totalProtein: number;
      totalFat: number;
      totalCarbs: number;
      nutritionScore: number;
      proteinGoal: number;
      fatGoal: number;
      carbsGoal: number;
      recommendExecutionCount: number;
    },
    previous: DailySummaryInsightView | null,
    locale: I18nLocale,
  ): DailySummaryInsightView {
    const hasData = day.mealCount > 0;
    const calories = this.buildMetric(
      day.totalCalories,
      day.calorieGoal,
      hasData,
      0.85,
      1.1,
    );
    const protein = this.buildMetric(
      day.totalProtein,
      day.proteinGoal,
      hasData,
      0.8,
      1.2,
    );
    const fat = this.buildMetric(day.totalFat, day.fatGoal, hasData, 0.6, 1.15);
    const carbs = this.buildMetric(
      day.totalCarbs,
      day.carbsGoal,
      hasData,
      0.6,
      1.15,
    );
    const score = hasData ? day.nutritionScore || 0 : 0;
    const scoreStatus = this.getScoreStatus(score, hasData);
    const tags = this.buildTags(
      day,
      calories,
      protein,
      fat,
      carbs,
      scoreStatus,
    );
    const trend = {
      calories: this.getTrendDirection(
        previous?.calories.value ?? null,
        hasData ? calories.value : null,
        80,
      ),
      caloriesDelta:
        previous && hasData
          ? Math.round(calories.value - previous.calories.value)
          : null,
      score: this.getTrendDirection(
        previous?.score ?? null,
        hasData ? score : null,
        5,
      ),
      scoreDelta:
        previous && hasData ? Math.round(score - previous.score) : null,
    };

    return {
      calories,
      macros: { protein, fat, carbs },
      score,
      scoreStatus,
      dataStatus: hasData ? 'recorded' : 'empty',
      tags,
      summary: this.buildSummary(tags, calories, protein, fat, carbs, locale),
      trend,
    };
  }

  private buildMetric(
    value: number,
    goal: number,
    hasData: boolean,
    lowRatio: number,
    highRatio: number,
  ): DailyMetricView {
    const safeValue = this.round(value, 1);
    const safeGoal = this.round(goal, 1);
    if (!hasData || safeGoal <= 0) {
      return {
        value: safeValue,
        goal: safeGoal,
        ratio: null,
        diff: this.round(safeValue - safeGoal, 1),
        status: 'no_data',
      };
    }
    const ratio = safeValue / safeGoal;
    const status: DailyMetricStatus =
      ratio < lowRatio ? 'low' : ratio <= highRatio ? 'normal' : 'high';
    return {
      value: safeValue,
      goal: safeGoal,
      ratio: this.round(ratio, 3),
      diff: this.round(safeValue - safeGoal, 1),
      status,
    };
  }

  private buildTags(
    day: { mealCount: number; recommendExecutionCount: number },
    calories: DailyMetricView,
    protein: DailyMetricView,
    fat: DailyMetricView,
    carbs: DailyMetricView,
    scoreStatus: DailyScoreStatus,
  ): string[] {
    if (day.mealCount <= 0) return ['no_record'];
    const tags: string[] = [];
    if (calories.status === 'high') tags.push('calories_high');
    if (calories.status === 'low') tags.push('calories_low');
    if (protein.status === 'low') tags.push('low_protein');
    if (fat.status === 'high') tags.push('high_fat');
    if (carbs.status === 'high') tags.push('high_carbs');
    if (scoreStatus === 'needs_work') tags.push('low_score');
    if (day.mealCount < 3) tags.push('low_meal_count');
    if (day.recommendExecutionCount > 0) tags.push('ai_recommend_used');
    if (tags.length === 0) tags.push('balanced_day');
    return tags;
  }

  private buildSummary(
    tags: string[],
    calories: DailyMetricView,
    protein: DailyMetricView,
    fat: DailyMetricView,
    carbs: DailyMetricView,
    locale: I18nLocale,
  ): string {
    if (tags.includes('no_record')) {
      return this.i18n.translate('diet.trend.summary.noRecord', locale);
    }
    if (tags.includes('balanced_day')) {
      return this.i18n.translate('diet.trend.summary.balanced', locale);
    }

    const parts: string[] = [];
    if (tags.includes('calories_high')) {
      parts.push(
        this.i18n.translate('diet.trend.summary.caloriesHigh', locale, {
          amount: Math.abs(Math.round(calories.diff)),
        }),
      );
    } else if (tags.includes('calories_low')) {
      parts.push(
        this.i18n.translate('diet.trend.summary.caloriesLow', locale, {
          amount: Math.abs(Math.round(calories.diff)),
        }),
      );
    }
    if (tags.includes('low_protein') && protein.ratio !== null) {
      parts.push(
        this.i18n.translate('diet.trend.summary.proteinRatio', locale, {
          percent: Math.round(protein.ratio * 100),
        }),
      );
    }
    if (tags.includes('high_fat') && fat.ratio !== null) {
      parts.push(
        this.i18n.translate('diet.trend.summary.fatRatio', locale, {
          percent: Math.round(fat.ratio * 100),
        }),
      );
    }
    if (tags.includes('high_carbs') && carbs.ratio !== null) {
      parts.push(
        this.i18n.translate('diet.trend.summary.carbsRatio', locale, {
          percent: Math.round(carbs.ratio * 100),
        }),
      );
    }
    return parts.length > 0
      ? this.i18n.translate('diet.trend.summary.combined', locale, {
          parts: parts.join(
            this.i18n.translate('diet.trend.summary.separator', locale),
          ),
        })
      : this.i18n.translate('diet.trend.summary.generic', locale);
  }

  private getScoreStatus(score: number, hasData: boolean): DailyScoreStatus {
    if (!hasData) return 'no_data';
    if (score < 60) return 'needs_work';
    if (score < 75) return 'fair';
    return 'good';
  }

  private getTrendDirection(
    previous: number | null,
    current: number | null,
    stableThreshold: number,
  ): DailyTrendDirection {
    if (previous === null || current === null) return 'insufficient';
    const delta = current - previous;
    if (Math.abs(delta) <= stableThreshold) return 'stable';
    return delta > 0 ? 'up' : 'down';
  }

  private addDaysToDateKey(dateKey: string, days: number): string {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    return Number(value) || 0;
  }

  private round(value: number, digits = 0): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private normalizeSourceBreakdown(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.entries(value as Record<string, unknown>).reduce(
      (acc, [key, raw]) => {
        const count = Number(raw) || 0;
        if (count > 0) acc[key] = count;
        return acc;
      },
      {} as Record<string, number>,
    );
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

    const summary = await this.prisma.dailySummaries.findFirst({
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
