import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserBehaviorProfile } from '../../user/entities/user-behavior-profile.entity';
import { AiDecisionLog } from '../entities/ai-decision-log.entity';
import { RecommendationFeedback } from '../entities/recommendation-feedback.entity';
import { FoodRecord } from '../entities/food-record.entity';
import { DailySummary } from '../entities/daily-summary.entity';
import { FoodService } from './food.service';
import { UserProfileService } from '../../user/app/user-profile.service';
import {
  getUserLocalDate,
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../common/utils/timezone.util';

export interface ProactiveReminder {
  type: 'binge_risk' | 'meal_reminder' | 'streak_warning' | 'pattern_alert';
  message: string;
  urgency: 'low' | 'medium' | 'high';
}

@Injectable()
export class BehaviorService {
  private readonly logger = new Logger(BehaviorService.name);

  constructor(
    @InjectRepository(UserBehaviorProfile)
    private readonly behaviorRepo: Repository<UserBehaviorProfile>,
    @InjectRepository(AiDecisionLog)
    private readonly logRepo: Repository<AiDecisionLog>,
    @InjectRepository(RecommendationFeedback)
    private readonly feedbackRepo: Repository<RecommendationFeedback>,
    @InjectRepository(FoodRecord)
    private readonly foodRecordRepo: Repository<FoodRecord>,
    @InjectRepository(DailySummary)
    private readonly dailySummaryRepo: Repository<DailySummary>,
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
  ) {}

  /**
   * 获取或创建用户行为画像
   */
  async getProfile(userId: string): Promise<UserBehaviorProfile> {
    let profile = await this.behaviorRepo.findOne({ where: { userId } });
    if (!profile) {
      profile = this.behaviorRepo.create({ userId });
      profile = await this.behaviorRepo.save(profile);
    }
    return profile;
  }

  /**
   * 更新教练风格
   */
  async updateCoachStyle(
    userId: string,
    style: string,
  ): Promise<UserBehaviorProfile> {
    let profile = await this.getProfile(userId);
    profile.coachStyle = style;
    return this.behaviorRepo.save(profile);
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
  }): Promise<AiDecisionLog> {
    const log = this.logRepo.create({
      userId: data.userId,
      recordId: data.recordId || null,
      inputContext: data.inputContext || null,
      inputImageUrl: data.inputImageUrl || null,
      decision: data.decision || null,
      riskLevel: data.riskLevel || null,
      fullResponse: data.fullResponse || null,
    });
    return this.logRepo.save(log);
  }

  /**
   * 记录用户对 AI 决策的反馈
   */
  async logFeedback(
    recordId: string,
    followed: boolean,
    feedback: string,
  ): Promise<void> {
    const log = await this.logRepo.findOne({ where: { recordId } });
    if (log) {
      log.userFollowed = followed;
      log.userFeedback = feedback;
      await this.logRepo.save(log);
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
    profile.totalRecords += 1;

    // 防止同一天重复评估 streak（修复 B1）
    if (profile.lastStreakDate === today) {
      await this.behaviorRepo.save(profile);
      return;
    }

    // 查询昨日汇总判断是否达标
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getUserLocalDate(tz, yesterday);

    const yesterdaySummary = await this.dailySummaryRepo.findOne({
      where: { userId, date: yesterdayStr },
    });

    if (yesterdaySummary) {
      const goal = yesterdaySummary.calorieGoal || 2000;
      const actual = yesterdaySummary.totalCalories || 0;
      // 达标条件：有进食记录 && 热量在目标的 80%~110% 之间
      const isCompliant =
        actual > 0 && actual >= goal * 0.8 && actual <= goal * 1.1;

      if (isCompliant) {
        profile.streakDays += 1;
        if (profile.streakDays > profile.longestStreak) {
          profile.longestStreak = profile.streakDays;
        }
      } else {
        // 修复 B2: 不达标归零
        profile.streakDays = 0;
      }
    }
    // 如果昨日无记录（首日或刚注册），不改变 streak

    // 修复 B3: 合规率按天计算（近 30 天滑动窗口）
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sinceDate = thirtyDaysAgo.toISOString().slice(0, 10);

    const complianceResult = await this.dailySummaryRepo
      .createQueryBuilder('s')
      .select('COUNT(*)', 'total_days')
      .addSelect(
        `SUM(CASE WHEN s.total_calories > 0
          AND s.calorie_goal IS NOT NULL
          AND s.total_calories >= s.calorie_goal * 0.8
          AND s.total_calories <= s.calorie_goal * 1.1
          THEN 1 ELSE 0 END)`,
        'healthy_days',
      )
      .where('s.user_id = :userId', { userId })
      .andWhere('s.date >= :sinceDate', { sinceDate })
      .getRawOne();

    const totalDays = Number(complianceResult?.total_days) || 0;
    const healthyDays = Number(complianceResult?.healthy_days) || 0;

    profile.avgComplianceRate =
      totalDays > 0 ? Number((healthyDays / totalDays).toFixed(2)) : 0;
    profile.healthyRecords = healthyDays; // 现在表示健康天数

    profile.lastStreakDate = today;
    await this.behaviorRepo.save(profile);
  }

  /**
   * 获取行为上下文（注入 AI prompt）
   */
  async getBehaviorContext(userId: string): Promise<string> {
    const profile = await this.behaviorRepo.findOne({ where: { userId } });
    if (!profile) return '';

    const parts: string[] = ['【用户行为画像】'];
    if (profile.foodPreferences?.loves?.length) {
      parts.push(`- 偏好食物：${profile.foodPreferences.loves.join('、')}`);
    }
    if (profile.bingeRiskHours?.length) {
      parts.push(
        `- 容易暴食时段：${profile.bingeRiskHours.map((h) => h + ':00').join('、')}`,
      );
    }
    parts.push(
      `- 建议执行率：${Math.round((Number(profile.avgComplianceRate) || 0) * 100)}%`,
    );
    parts.push(`- 连续达标天数：${profile.streakDays} 天`);

    return parts.join('\n');
  }

  /**
   * 主动检查提醒
   */
  async proactiveCheck(userId: string): Promise<ProactiveReminder | null> {
    const tz = await this.userProfileService.getTimezone(userId);
    const hour = getUserLocalHour(tz);
    const profile = await this.behaviorRepo.findOne({ where: { userId } });
    const summary = await this.foodService.getTodaySummary(userId);

    // 场景1：高风险暴食时段
    if (profile?.bingeRiskHours?.includes(hour)) {
      return {
        type: 'binge_risk',
        message: '你这个时间容易想吃零食，可以提前喝杯水或准备低热量替代',
        urgency: 'high',
      };
    }

    // 场景2：接近超标
    const goal = summary.calorieGoal || 2000;
    const remaining = goal - summary.totalCalories;
    if (remaining > 0 && remaining < goal * 0.15 && hour < 20) {
      return {
        type: 'pattern_alert',
        message: `剩余 ${remaining} kcal，注意控制后续饮食`,
        urgency: 'medium',
      };
    }

    // 场景3：午餐时间未记录
    if (hour >= 12 && hour <= 14 && summary.mealCount === 0) {
      return {
        type: 'meal_reminder',
        message: '别忘了记录午餐，让 AI 帮你规划下午和晚上的饮食',
        urgency: 'low',
      };
    }

    // 场景4：连胜即将断签
    if (profile && profile.streakDays >= 3 && hour >= 20) {
      const caloriePercent = summary.totalCalories / goal;
      if (caloriePercent > 0.9 && caloriePercent <= 1.0) {
        return {
          type: 'streak_warning',
          message: `已连续达标 ${profile.streakDays} 天，今天差一点就超标了，注意控制！`,
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
    const logs = await this.logRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    if (logs.length < 5) return; // 数据不足

    const profile = await this.getProfile(userId);
    const tz = await this.userProfileService.getTimezone(userId);

    // 识别常用食物
    const foodCounts: Record<string, number> = {};
    for (const log of logs) {
      const foods = (log.fullResponse as any)?.foods;
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
        const h = getUserLocalHour(tz, new Date(log.createdAt));
        hourCounts[h] = (hourCounts[h] || 0) + 1;
      }
    }
    const bingeHours = Object.entries(hourCounts)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([h]) => parseInt(h, 10));

    profile.foodPreferences = {
      ...profile.foodPreferences,
      frequentFoods,
    };
    profile.bingeRiskHours = bingeHours;

    // ── 推荐反馈分析（loves/avoids 带时间衰减）──
    await this.analyzeRecommendationFeedback(userId, profile);

    // ── 用餐时间模式推断 ──
    await this.analyzeMealTimingPatterns(userId, profile, tz);

    // ── 替换模式分析 ──
    await this.analyzeReplacementPatterns(userId, profile);

    await this.behaviorRepo.save(profile);
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
    profile: UserBehaviorProfile,
  ): Promise<void> {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const feedbacks = await this.feedbackRepo
      .createQueryBuilder('f')
      .where('f.user_id = :userId', { userId })
      .andWhere('f.created_at >= :since', { since: sixtyDaysAgo })
      .getMany();

    if (feedbacks.length < 5) return;

    const now = Date.now();
    const foodScores: Record<string, number> = {};

    for (const fb of feedbacks) {
      const daysSince = Math.floor(
        (now - (fb.createdAt as Date).getTime()) / (1000 * 60 * 60 * 24),
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

      foodScores[fb.foodName] =
        (foodScores[fb.foodName] || 0) + score * decayWeight;
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

    profile.foodPreferences = {
      ...profile.foodPreferences,
      loves,
      avoids,
    };
  }

  /**
   * 从食物记录推断用餐时间模式
   */
  private async analyzeMealTimingPatterns(
    userId: string,
    profile: UserBehaviorProfile,
    timezone: string,
  ): Promise<void> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const records = await this.foodRecordRepo
      .createQueryBuilder('r')
      .where('r.user_id = :userId', { userId })
      .andWhere('r.created_at >= :since', { since: thirtyDaysAgo })
      .getMany();

    if (records.length < 10) return;

    const mealTimes: Record<string, number[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    };

    for (const record of records) {
      const hour = getUserLocalHour(timezone, record.createdAt as Date);
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

    profile.mealTimingPatterns = {
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
    profile: UserBehaviorProfile,
  ): Promise<void> {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const replacements = await this.feedbackRepo
      .createQueryBuilder('f')
      .where('f.user_id = :userId', { userId })
      .andWhere('f.action = :action', { action: 'replaced' })
      .andWhere('f.replacement_food IS NOT NULL')
      .andWhere('f.created_at >= :since', { since: sixtyDaysAgo })
      .getMany();

    if (replacements.length < 3) return;

    const patterns: Record<string, number> = {};
    for (const fb of replacements) {
      const key = `${fb.foodName}→${fb.replacementFood}`;
      patterns[key] = (patterns[key] || 0) + 1;
    }

    // 保留出现 ≥ 2 次的替换模式
    const filtered: Record<string, number> = {};
    for (const [key, count] of Object.entries(patterns)) {
      if (count >= 2) {
        filtered[key] = count;
      }
    }

    profile.replacementPatterns = filtered;
  }
}
