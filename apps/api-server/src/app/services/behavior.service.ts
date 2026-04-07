import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserBehaviorProfile } from '../../entities/user-behavior-profile.entity';
import { AiDecisionLog } from '../../entities/ai-decision-log.entity';
import { FoodService } from './food.service';

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
    private readonly foodService: FoodService,
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
  async updateCoachStyle(userId: string, style: string): Promise<UserBehaviorProfile> {
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
  async logFeedback(recordId: string, followed: boolean, feedback: string): Promise<void> {
    const log = await this.logRepo.findOne({ where: { recordId } });
    if (log) {
      log.userFollowed = followed;
      log.userFeedback = feedback;
      await this.logRepo.save(log);
    }
  }

  /**
   * 更新连胜天数（每次 saveRecord 后调用）
   */
  async updateStreak(userId: string): Promise<void> {
    const summary = await this.foodService.getTodaySummary(userId);
    const goal = summary.calorieGoal || 2000;
    const profile = await this.getProfile(userId);

    profile.totalRecords += 1;

    if (summary.totalCalories <= goal) {
      profile.healthyRecords += 1;
    }

    // 简化的连胜逻辑：在 getTodaySummary 时判断当天是否达标
    if (summary.totalCalories > 0 && summary.totalCalories <= goal) {
      profile.streakDays += 1;
      if (profile.streakDays > profile.longestStreak) {
        profile.longestStreak = profile.streakDays;
      }
    }

    // 更新执行率
    if (profile.totalRecords > 0) {
      profile.avgComplianceRate = Number(
        (profile.healthyRecords / profile.totalRecords).toFixed(2),
      );
    }

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
      parts.push(`- 容易暴食时段：${profile.bingeRiskHours.map((h) => h + ':00').join('、')}`);
    }
    parts.push(`- 建议执行率：${Math.round((Number(profile.avgComplianceRate) || 0) * 100)}%`);
    parts.push(`- 连续达标天数：${profile.streakDays} 天`);

    return parts.join('\n');
  }

  /**
   * 主动检查提醒
   */
  async proactiveCheck(userId: string): Promise<ProactiveReminder | null> {
    const hour = new Date().getHours();
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
        const h = new Date(log.createdAt).getHours();
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

    await this.behaviorRepo.save(profile);
    this.logger.log(`用户 ${userId} 行为分析完成，常用食物 ${frequentFoods.length} 种，风险时段 ${bingeHours.length} 个`);
  }
}
