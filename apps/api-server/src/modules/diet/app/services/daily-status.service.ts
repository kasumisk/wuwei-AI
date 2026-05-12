import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { FoodRecordService } from './food-record.service';
import {
  NutritionScoreService,
  DailyGoalProfile,
} from './nutrition-score.service';
import { BehaviorService } from './behavior.service';
import {
  getUserLocalDate,
  getUserLocalDayBoundsForDateKey,
  getUserLocalHour,
} from '../../../../common/utils/timezone.util';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../core/cache/tiered-cache-manager';
import { I18nService } from '../../../../core/i18n';

type DailyStatusResponse = {
  date: string;
  timezone: string;
  computedAt: string;
  summary: Record<string, unknown>;
  score: Record<string, unknown>;
  records: Record<string, unknown>;
};

@Injectable()
export class DailyStatusService implements OnModuleInit {
  private cache!: TieredCacheNamespace<DailyStatusResponse>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly userProfileService: UserProfileService,
    private readonly foodRecordService: FoodRecordService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly behaviorService: BehaviorService,
    private readonly cacheManager: TieredCacheManager,
    private readonly i18n: I18nService,
  ) {}

  onModuleInit(): void {
    this.cache = this.cacheManager.createNamespace<DailyStatusResponse>({
      namespace: 'daily_status_v1',
      l1MaxEntries: 1000,
      l1TtlMs: 60 * 1000,
      l2TtlMs: 24 * 60 * 60 * 1000,
      refreshAheadMs: 15 * 1000,
    });
  }

  async getStatus(
    userId: string,
    date: string,
    opts: {
      timezone?: string;
      records?: 'compact' | 'full';
      force?: boolean;
    } = {},
  ): Promise<DailyStatusResponse> {
    const profile = await this.userProfileService.getProfile(userId);
    const timezone =
      opts.timezone ||
      profile?.timezone ||
      (await this.userProfileService.getTimezone(userId));
    const profileVersion = (profile as any)?.profileVersion ?? 1;
    const cacheKey = [
      userId,
      date,
      timezone,
      profileVersion,
      opts.records ?? 'compact',
    ].join(':');

    if (opts.force) {
      await this.cache.invalidate(cacheKey);
    }

    return this.cache.getOrSet(cacheKey, () =>
      this.computeStatus(
        userId,
        date,
        timezone,
        profile,
        opts.records ?? 'compact',
      ),
    );
  }

  async invalidateUserDate(userId: string, date: string): Promise<void> {
    await this.cache.invalidateByPrefix(`${userId}:${date}:`);
  }

  private async computeStatus(
    userId: string,
    date: string,
    timezone: string,
    profile: any,
    recordsMode: 'compact' | 'full',
  ): Promise<DailyStatusResponse> {
    const { startOfDay, endOfDay } = getUserLocalDayBoundsForDateKey(
      timezone,
      date,
    );
    const today = getUserLocalDate(timezone);
    const isToday = date === today;

    const [records, behaviorProfile] = await Promise.all([
      this.foodRecordService.getRecordsByDateRange(
        userId,
        startOfDay,
        endOfDay,
      ),
      this.behaviorService.getProfile(userId).catch(() => null),
    ]);

    const goals = this.nutritionScoreService.calculateDailyGoals(
      profile as DailyGoalProfile | null | undefined,
    );
    const summary = await this.buildSummary(userId, date, records, goals);
    const score = await this.buildScore(
      records,
      summary,
      goals,
      profile,
      behaviorProfile,
      timezone,
      isToday,
    );

    return {
      date,
      timezone,
      computedAt: new Date().toISOString(),
      summary,
      score,
      records: {
        items:
          recordsMode === 'compact'
            ? records.map((r) => this.compactRecord(r))
            : records,
        total: records.length,
        page: 1,
        limit: records.length,
        date,
        summary: {
          totalCalories: summary.totalCalories,
          totalProtein: summary.totalProtein,
          totalFat: summary.totalFat,
          totalCarbs: summary.totalCarbs,
          mealCount: summary.mealCount,
        },
      },
    };
  }

  private async buildSummary(
    userId: string,
    date: string,
    records: any[],
    goals: { calories: number; protein: number; fat: number; carbs: number },
  ) {
    const totalCalories = records.reduce((sum, r) => sum + r.totalCalories, 0);
    const totalProtein = records.reduce(
      (sum, r) => sum + (Number(r.totalProtein) || 0),
      0,
    );
    const totalFat = records.reduce(
      (sum, r) => sum + (Number(r.totalFat) || 0),
      0,
    );
    const totalCarbs = records.reduce(
      (sum, r) => sum + (Number(r.totalCarbs) || 0),
      0,
    );
    const totalCal = totalCalories || 1;
    const avgQuality =
      records.reduce(
        (sum, r) => sum + (Number(r.avgQuality) || 0) * r.totalCalories,
        0,
      ) / totalCal;
    const avgSatiety =
      records.reduce(
        (sum, r) => sum + (Number(r.avgSatiety) || 0) * r.totalCalories,
        0,
      ) / totalCal;

    return {
      totalCalories,
      calorieGoal: goals.calories,
      mealCount: records.length,
      remaining: Math.max(0, goals.calories - totalCalories),
      totalProtein,
      totalFat,
      totalCarbs,
      avgQuality: Math.round(avgQuality * 10) / 10,
      avgSatiety: Math.round(avgSatiety * 10) / 10,
      nutritionScore: 0,
      proteinGoal: goals.protein,
      fatGoal: goals.fat,
      carbsGoal: goals.carbs,
    };
  }

  private async buildScore(
    records: any[],
    summary: any,
    goals: { calories: number; protein: number; fat: number; carbs: number },
    profile: any,
    behaviorProfile: any,
    timezone: string,
    isToday: boolean,
  ) {
    await this.nutritionScoreService.preloadWeightsConfig();
    const localHour = isToday ? getUserLocalHour(timezone) : undefined;
    const mealSignals = this.nutritionScoreService.aggregateMealSignals(
      records,
      Number(profile?.mealsPerDay) || 3,
    );
    const { avgGI, totalCarbsFromFoods } = this.aggregateGlycemicData(records);
    const stabilityData = {
      streakDays: behaviorProfile?.streakDays || 0,
      avgMealsPerDay: summary.mealCount,
      targetMeals: Number(profile?.mealsPerDay) || 3,
      complianceRate: Number(behaviorProfile?.avgComplianceRate) || 0,
    };
    const score =
      records.length > 0
        ? this.nutritionScoreService.calculateScore(
            {
              calories: summary.totalCalories,
              targetCalories: goals.calories,
              protein: summary.totalProtein || 0,
              fat: summary.totalFat || 0,
              carbs: summary.totalCarbs || 0,
              targetProtein: goals.protein,
              targetCarbs: goals.carbs,
              targetFat: goals.fat,
              foodQuality: summary.avgQuality > 0 ? summary.avgQuality : 3,
              satiety: summary.avgSatiety > 0 ? summary.avgSatiety : 3,
              glycemicIndex: avgGI || undefined,
              carbsPerServing: totalCarbsFromFoods || undefined,
            },
            profile?.goal || 'health',
            stabilityData,
            profile?.healthConditions as string[] | undefined,
            localHour,
            mealSignals,
          )
        : {
            score: 0,
            breakdown: {},
            highlights: [],
            decision: 'SAFE' as const,
          };

    const intake = {
      calories: summary.totalCalories,
      protein: summary.totalProtein || 0,
      fat: summary.totalFat || 0,
      carbs: summary.totalCarbs || 0,
    };
    const macroSlotStatus = this.nutritionScoreService.computeMacroSlotStatus(
      intake,
      goals,
      localHour,
    );
    const locale = this.resolveScoreLocale();

    return {
      totalScore: score.score,
      breakdown: score.breakdown,
      highlights: score.highlights,
      decision: score.decision,
      feedback: this.buildFeedback(
        summary.mealCount,
        score.highlights,
        profile?.goal || 'health',
      ),
      goals,
      intake,
      statusLabel: this.getStatusLabel(score.score, summary.mealCount),
      macroSlotStatus,
      issueHighlights: this.nutritionScoreService.detectIssueHighlights(
        intake,
        goals,
        score.breakdown as any,
        summary.mealCount,
        locale,
        localHour,
      ),
      mealSignals,
      decisionAlignment: this.nutritionScoreService.buildDecisionAlignment(
        mealSignals,
        locale,
        intake,
        goals,
      ),
      dailyProgress: {
        localHour: localHour ?? 24,
        expectedProgress:
          localHour == null
            ? 1
            : Math.round(
                this.nutritionScoreService.getExpectedProgress(localHour) * 100,
              ) / 100,
        actualProgress:
          goals.calories > 0
            ? Math.round((summary.totalCalories / goals.calories) * 100) / 100
            : 0,
        isOnTrack:
          goals.calories > 0
            ? summary.totalCalories / goals.calories <= 1.3
            : true,
      },
      weights: (score as any).weights,
      weightsSource: (score as any).weightsSource,
    };
  }

  private compactRecord(record: any) {
    return {
      id: record.id,
      userId: record.userId,
      imageUrl: record.imageUrl,
      source: record.source,
      foods: record.foods,
      totalCalories: record.totalCalories,
      mealType: record.mealType,
      advice: record.advice,
      isHealthy: record.isHealthy,
      decision: record.decision,
      riskLevel: record.riskLevel,
      reason: record.reason,
      suggestion: record.suggestion,
      totalProtein: Number(record.totalProtein) || 0,
      totalFat: Number(record.totalFat) || 0,
      totalCarbs: Number(record.totalCarbs) || 0,
      avgQuality: Number(record.avgQuality) || 0,
      avgSatiety: Number(record.avgSatiety) || 0,
      nutritionScore: record.nutritionScore,
      recordedAt: record.recordedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      analysisId: record.analysisId,
      recommendationTraceId: record.recommendationTraceId,
    };
  }

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

  private getStatusLabel(score: number, mealCount: number): string {
    if (mealCount <= 0) return 'no_data';
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 55) return 'fair';
    return 'needs_improvement';
  }

  private buildFeedback(
    mealCount: number,
    highlights: string[],
    goal: string,
  ): string {
    if (mealCount <= 0) return this.i18n.t('diet.trend.summary.noRecord');
    return this.nutritionScoreService.generateFeedback(highlights, goal);
  }

  private resolveScoreLocale(): 'zh' | 'en' | 'ja' {
    const raw = this.i18n.currentLocale();
    if (raw === 'ja-JP') return 'ja';
    if (raw === 'en-US') return 'en';
    return 'zh';
  }
}
