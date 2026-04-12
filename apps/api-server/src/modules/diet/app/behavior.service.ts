import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FoodService } from './food.service';
import { UserProfileService } from '../../user/app/user-profile.service';
import {
  getUserLocalDate,
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../common/utils/timezone.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { BingeInterventionService } from '../admin/binge-intervention.service';
import { t } from './recommendation/i18n-messages';

export interface ProactiveReminder {
  type: 'binge_risk' | 'meal_reminder' | 'streak_warning' | 'pattern_alert';
  message: string;
  urgency: 'low' | 'medium' | 'high';
}

@Injectable()
export class BehaviorService {
  private readonly logger = new Logger(BehaviorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
    @Optional()
    private readonly bingeInterventionService?: BingeInterventionService,
  ) {}

  /**
   * 获取或创建用户行为画像
   */
  async getProfile(userId: string): Promise<any> {
    let profile = await this.prisma.user_behavior_profiles.findUnique({
      where: { user_id: userId },
    });
    if (!profile) {
      profile = await this.prisma.user_behavior_profiles.create({
        data: { user_id: userId },
      });
    }
    return profile;
  }

  /**
   * 更新教练风格
   */
  async updateCoachStyle(userId: string, style: string): Promise<any> {
    await this.getProfile(userId);
    return this.prisma.user_behavior_profiles.update({
      where: { user_id: userId },
      data: { coach_style: style },
    });
  }

  /**
   * 记录 AI 决策日志
   */
  async logDecision(data: {
    userId: string;
    recordId?: string;
    inputContext?: Record<string, any>;
    inputImageUrl?: string;
    decision?: string;
    riskLevel?: string;
    fullResponse?: Record<string, any>;
  }): Promise<any> {
    return this.prisma.ai_decision_logs.create({
      data: {
        user_id: data.userId,
        record_id: data.recordId || null,
        input_context: data.inputContext || Prisma.JsonNull,
        input_image_url: data.inputImageUrl || null,
        decision: data.decision || null,
        risk_level: data.riskLevel || null,
        full_response: data.fullResponse || Prisma.JsonNull,
      },
    }) as any;
  }

  /**
   * 记录用户对 AI 决策的反馈
   */
  async logFeedback(
    recordId: string,
    followed: boolean,
    feedback: string,
  ): Promise<void> {
    const log = await this.prisma.ai_decision_logs.findFirst({
      where: { record_id: recordId },
    });
    if (log) {
      await this.prisma.ai_decision_logs.update({
        where: { id: log.id },
        data: { user_followed: followed, user_feedback: feedback },
      });
    }
  }

  /**
   * 更新连胜天数（每次 saveRecord 后调用）
   *
   * V4 重写修复:
   * - B1: 使用 lastStreakDate 防止同一天重复递增 streakDays
   * - B2: 昨日未达标时 streakDays 归零
   * - B3: avgComplianceRate 按天计算（近 30 天窗口）
   */
  async updateStreak(userId: string): Promise<void> {
    const profile = await this.getProfile(userId);
    const tz = await this.userProfileService.getTimezone(userId);
    const today = getUserLocalDate(tz);

    // 递增总记录数（仍按记录计数，用于其他用途如 collection-trigger）
    let totalRecords = (profile.total_records || 0) + 1;
    let streakDays = profile.streak_days || 0;
    let longestStreak = profile.longest_streak || 0;
    let avgComplianceRate = profile.avg_compliance_rate || 0;
    let healthyRecords = profile.healthy_records || 0;

    // 防止同一天重复评估 streak（修复 B1）
    if (profile.last_streak_date === today) {
      await this.prisma.user_behavior_profiles.update({
        where: { user_id: userId },
        data: { total_records: totalRecords },
      });
      return;
    }

    // 查询昨日汇总判断是否达标
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getUserLocalDate(tz, yesterday);

    const yesterdaySummary = await this.prisma.daily_summaries.findFirst({
      where: { user_id: userId, date: yesterdayStr },
    });

    if (yesterdaySummary) {
      const goal = yesterdaySummary.calorie_goal || 2000;
      const actual = yesterdaySummary.total_calories || 0;
      // 达标条件：有进食记录 && 热量在目标的 80%~110% 之间
      const isCompliant =
        actual > 0 && actual >= goal * 0.8 && actual <= goal * 1.1;

      if (isCompliant) {
        streakDays += 1;
        if (streakDays > longestStreak) {
          longestStreak = streakDays;
        }
      } else {
        // 修复 B2: 不达标归零
        streakDays = 0;
      }
    }
    // 如果昨日无记录（首日或刚注册），不改变 streak

    // 修复 B3: 合规率按天计算（近 30 天滑动窗口）
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sinceDate = thirtyDaysAgo.toISOString().slice(0, 10);

    const complianceResult = await this.prisma.$queryRaw<
      [{ total_days: string; healthy_days: string }]
    >`
      SELECT COUNT(*) as total_days,
        SUM(CASE WHEN total_calories > 0
          AND calorie_goal IS NOT NULL
          AND total_calories >= calorie_goal * 0.8
          AND total_calories <= calorie_goal * 1.1
          THEN 1 ELSE 0 END) as healthy_days
      FROM daily_summaries
      WHERE user_id = ${userId}::uuid
        AND date >= ${sinceDate}
    `;

    const totalDays = Number(complianceResult?.[0]?.total_days) || 0;
    const healthyDays = Number(complianceResult?.[0]?.healthy_days) || 0;

    avgComplianceRate =
      totalDays > 0 ? Number((healthyDays / totalDays).toFixed(2)) : 0;
    healthyRecords = healthyDays; // 现在表示健康天数

    await this.prisma.user_behavior_profiles.update({
      where: { user_id: userId },
      data: {
        total_records: totalRecords,
        streak_days: streakDays,
        longest_streak: longestStreak,
        avg_compliance_rate: avgComplianceRate,
        healthy_records: healthyRecords,
        last_streak_date: today,
      },
    });
  }

  /**
   * 获取行为上下文（注入 AI prompt）
   */
  async getBehaviorContext(userId: string): Promise<string> {
    const profile = await this.prisma.user_behavior_profiles.findUnique({
      where: { user_id: userId },
    });
    if (!profile) return '';

    const parts: string[] = [t('behavior.prompt.sectionHeader')];
    const foodPreferences = profile.food_preferences as any;
    if (foodPreferences?.loves?.length) {
      parts.push(
        `${t('behavior.prompt.preferredFoods')}${foodPreferences.loves.join(t('behavior.prompt.separator'))}`,
      );
    }
    const bingeRiskHours = profile.binge_risk_hours as any;
    if (bingeRiskHours?.length) {
      parts.push(
        `${t('behavior.prompt.bingePeriods')}${bingeRiskHours.map((h: number) => h + ':00').join(t('behavior.prompt.separator'))}`,
      );
    }
    parts.push(
      `${t('behavior.prompt.suggestionRate')}${Math.round((Number(profile.avg_compliance_rate) || 0) * 100)}%`,
    );
    parts.push(
      `${t('behavior.prompt.streakDays')}${profile.streak_days}${t('behavior.prompt.streakUnit')}`,
    );

    return parts.join('\n');
  }

  /**
   * 主动检查提醒
   */
  async proactiveCheck(userId: string): Promise<ProactiveReminder | null> {
    const tz = await this.userProfileService.getTimezone(userId);
    const hour = getUserLocalHour(tz);
    const profile = await this.prisma.user_behavior_profiles.findUnique({
      where: { user_id: userId },
    });
    const summary = await this.foodService.getTodaySummary(userId);

    // 场景1：高风险暴食时段
    const bingeRiskHours = profile?.binge_risk_hours as any;
    if (bingeRiskHours?.includes(hour)) {
      const reminder: ProactiveReminder = {
        type: 'binge_risk',
        message: t('behavior.notification.snackReminder'),
        urgency: 'high',
      };

      // V6.5 Phase 3J: 记录暴食干预事件（异步，不阻塞主流程）
      if (this.bingeInterventionService) {
        this.bingeInterventionService
          .recordIntervention(userId, hour, reminder.message)
          .catch((err) =>
            this.logger.warn(`Failed to record binge intervention: ${err}`),
          );
      }

      return reminder;
    }

    // 场景2：接近超标
    const goal = summary.calorieGoal || 2000;
    const remaining = goal - summary.totalCalories;
    if (remaining > 0 && remaining < goal * 0.15 && hour < 20) {
      return {
        type: 'pattern_alert',
        message: t('behavior.notification.remainingCalories', {
          remaining: String(remaining),
        }),
        urgency: 'medium',
      };
    }

    // 场景3：午餐时间未记录
    if (hour >= 12 && hour <= 14 && summary.mealCount === 0) {
      return {
        type: 'meal_reminder',
        message: t('behavior.notification.lunchReminder'),
        urgency: 'low',
      };
    }

    // 场景4：连胜即将断签
    if (profile && (profile.streak_days || 0) >= 3 && hour >= 20) {
      const caloriePercent = summary.totalCalories / goal;
      if (caloriePercent > 0.9 && caloriePercent <= 1.0) {
        return {
          type: 'streak_warning',
          message: t('behavior.notification.streakWarning', {
            streakDays: String(profile.streak_days),
          }),
          urgency: 'high',
        };
      }
    }

    return null;
  }

  /**
   * 分析用户行为模式（可由定时任务触发）
   */
  async analyzeUserBehavior(userId: string): Promise<void> {
    const logs = await this.prisma.ai_decision_logs.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    if (logs.length < 5) return; // 数据不足

    const profile = await this.getProfile(userId);
    const tz = await this.userProfileService.getTimezone(userId);

    // 识别常用食物
    const foodCounts: Record<string, number> = {};
    for (const log of logs) {
      const foods = (log.full_response as any)?.foods;
      if (Array.isArray(foods)) {
        for (const f of foods) {
          foodCounts[f.name] = (foodCounts[f.name] || 0) + 1;
        }
      }
    }
    const frequentFoods = Object.entries(foodCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    // 识别暴食时段（AVOID 决策出现的时段）
    const hourCounts: Record<number, number> = {};
    for (const log of logs) {
      if (log.decision === 'AVOID' || log.decision === 'LIMIT') {
        const h = getUserLocalHour(tz, new Date(log.created_at as any));
        hourCounts[h] = (hourCounts[h] || 0) + 1;
      }
    }
    const bingeHours = Object.entries(hourCounts)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([h]) => parseInt(h, 10));

    const existingPrefs = (profile.food_preferences as any) || {};
    const foodPreferences = {
      ...existingPrefs,
      frequentFoods,
    };
    const bingeRiskHours = bingeHours;

    // ── 推荐反馈分析（loves/avoids 带时间衰减）──
    const updatedPrefs = await this.analyzeRecommendationFeedback(
      userId,
      foodPreferences,
    );

    // ── 用餐时间模式推断 ──
    const mealTimingPatterns = await this.analyzeMealTimingPatterns(userId, tz);

    // ── 替换模式分析 ──
    const replacementPatterns = await this.analyzeReplacementPatterns(userId);

    await this.prisma.user_behavior_profiles.update({
      where: { user_id: userId },
      data: {
        food_preferences: updatedPrefs || foodPreferences,
        binge_risk_hours: bingeRiskHours,
        ...(mealTimingPatterns !== undefined
          ? { meal_timing_patterns: mealTimingPatterns }
          : {}),
        ...(replacementPatterns !== undefined
          ? { replacement_patterns: replacementPatterns }
          : {}),
      },
    });
    this.logger.log(
      `用户 ${userId} 行为分析完成，常用食物 ${frequentFoods.length} 种，风险时段 ${bingeHours.length} 个`,
    );
  }

  /**
   * 分析推荐反馈，提取 loves/avoids（指数时间衰减）
   * 衰减公式: weight = e^(-0.05 × days_since)
   * 30 天前权重 ≈ 0.22, 60 天前 ≈ 0.05
   */
  private async analyzeRecommendationFeedback(
    userId: string,
    foodPreferences: any,
  ): Promise<any> {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const feedbacks = await this.prisma.recommendation_feedbacks.findMany({
      where: {
        user_id: userId,
        created_at: { gte: sixtyDaysAgo },
      },
    });

    if (feedbacks.length < 5) return foodPreferences;

    const now = Date.now();
    const foodScores: Record<string, number> = {};

    for (const fb of feedbacks) {
      const daysSince = Math.floor(
        (now - new Date(fb.created_at as any).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const decayWeight = Math.exp(-0.05 * daysSince);

      let score: number;
      switch (fb.action) {
        case 'accepted':
          score = 1.0;
          break;
        case 'replaced':
          score = -0.5;
          break;
        case 'skipped':
          score = -0.8;
          break;
        default:
          score = 0;
      }

      const foodName = (fb as any).food_name;
      foodScores[foodName] = (foodScores[foodName] || 0) + score * decayWeight;
    }

    // 提取 loves（正分 Top 10）和 avoids（负分 Top 10）
    const sorted = Object.entries(foodScores).sort(([, a], [, b]) => b - a);
    const loves = sorted
      .filter(([, s]) => s > 0.3)
      .slice(0, 10)
      .map(([name]) => name);
    const avoids = sorted
      .filter(([, s]) => s < -0.3)
      .slice(-10)
      .map(([name]) => name);

    return {
      ...foodPreferences,
      loves,
      avoids,
    };
  }

  /**
   * 从食物记录推断用餐时间模式
   */
  private async analyzeMealTimingPatterns(
    userId: string,
    timezone: string,
  ): Promise<any | undefined> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const records = await this.prisma.food_records.findMany({
      where: {
        user_id: userId,
        created_at: { gte: thirtyDaysAgo },
      },
    });

    if (records.length < 10) return undefined;

    const mealTimes: Record<string, number[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    };

    for (const record of records) {
      const hour = getUserLocalHour(
        timezone,
        new Date(record.created_at as any),
      );
      if (hour >= 5 && hour < 10) mealTimes.breakfast.push(hour);
      else if (hour >= 10 && hour < 14) mealTimes.lunch.push(hour);
      else if (hour >= 16 && hour < 21) mealTimes.dinner.push(hour);
      else mealTimes.snack.push(hour);
    }

    const avgHour = (hours: number[]): string | undefined => {
      if (hours.length < 3) return undefined;
      const avg = Math.round(hours.reduce((a, b) => a + b, 0) / hours.length);
      return `${avg}:00`;
    };

    return {
      breakfast: avgHour(mealTimes.breakfast),
      lunch: avgHour(mealTimes.lunch),
      dinner: avgHour(mealTimes.dinner),
      snack: avgHour(mealTimes.snack),
    };
  }

  /**
   * 分析替换模式（A→B 的替换频率）
   */
  private async analyzeReplacementPatterns(
    userId: string,
  ): Promise<any | undefined> {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const replacements = await this.prisma.recommendation_feedbacks.findMany({
      where: {
        user_id: userId,
        action: 'replaced',
        replacement_food: { not: null },
        created_at: { gte: sixtyDaysAgo },
      },
    });

    if (replacements.length < 3) return undefined;

    const patterns: Record<string, number> = {};
    for (const fb of replacements) {
      const key = `${(fb as any).food_name}→${(fb as any).replacement_food}`;
      patterns[key] = (patterns[key] || 0) + 1;
    }

    // 保留出现 ≥ 2 次的替换模式
    const filtered: Record<string, number> = {};
    for (const [key, count] of Object.entries(patterns)) {
      if (count >= 2) {
        filtered[key] = count;
      }
    }

    return filtered;
  }
}
