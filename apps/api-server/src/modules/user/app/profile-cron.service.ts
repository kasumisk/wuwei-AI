import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from '../entities/user-profile.entity';
import { UserBehaviorProfile } from '../entities/user-behavior-profile.entity';
import { UserInferredProfile } from '../entities/user-inferred-profile.entity';
import { FoodRecord } from '../../diet/entities/food-record.entity';
import { RecommendationFeedback } from '../../diet/entities/recommendation-feedback.entity';
import { ProfileCacheService } from './profile-cache.service';

/**
 * 用户画像定时任务
 *
 * - 每日 02:00 → 更新 avgComplianceRate, streakDays, mealTimingPatterns
 * - 每周一 03:00 → 更新 userSegment, churnRisk, nutritionGaps
 * - 每 14 天 → 更新 tastePrefVector（口味偏好向量）
 */
@Injectable()
export class ProfileCronService {
  private readonly logger = new Logger(ProfileCronService.name);

  constructor(
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    @InjectRepository(UserBehaviorProfile)
    private readonly behaviorRepo: Repository<UserBehaviorProfile>,
    @InjectRepository(UserInferredProfile)
    private readonly inferredRepo: Repository<UserInferredProfile>,
    @InjectRepository(FoodRecord)
    private readonly foodRecordRepo: Repository<FoodRecord>,
    @InjectRepository(RecommendationFeedback)
    private readonly feedbackRepo: Repository<RecommendationFeedback>,
    private readonly profileCacheService: ProfileCacheService,
  ) {}

  // ================================================================
  //  每日 02:00 — 行为数据滑动窗口更新
  // ================================================================

  @Cron('0 2 * * *')
  async dailyProfileUpdate(): Promise<void> {
    this.logger.log('开始每日画像更新...');
    const startTime = Date.now();

    try {
      const behaviors = await this.behaviorRepo.find();
      let updated = 0;

      for (const behavior of behaviors) {
        try {
          await this.updateDailyBehavior(behavior);
          updated++;
        } catch (err) {
          this.logger.warn(
            `用户 ${behavior.userId} 每日更新失败: ${(err as Error).message}`,
          );
        }
      }

      // 失效全部缓存
      this.profileCacheService.invalidateAll();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `每日画像更新完成: ${updated}/${behaviors.length} 用户, 耗时 ${elapsed}s`,
      );
    } catch (err) {
      this.logger.error(
        `每日画像更新失败: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /**
   * 更新单个用户的行为数据（30 天滑动窗口）
   */
  private async updateDailyBehavior(
    behavior: UserBehaviorProfile,
  ): Promise<void> {
    const userId = behavior.userId;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 30 天窗口内的食物记录
    const records = await this.foodRecordRepo
      .createQueryBuilder('r')
      .where('r.user_id = :userId', { userId })
      .andWhere('r.created_at >= :since', { since: thirtyDaysAgo })
      .getMany();

    if (records.length === 0) return;

    // 更新执行率（30 天窗口）
    const profile = await this.profileRepo.findOne({ where: { userId } });
    const dailyGoal = profile?.dailyCalorieGoal || 2000;

    // 按日聚合
    const dailyCalories: Record<string, number> = {};
    for (const record of records) {
      const day = (record.createdAt as Date).toISOString().split('T')[0];
      dailyCalories[day] =
        (dailyCalories[day] || 0) + (record.totalCalories || 0);
    }

    const totalDays = Object.keys(dailyCalories).length;
    const healthyDays = Object.values(dailyCalories).filter(
      (cal) => cal <= dailyGoal,
    ).length;
    behavior.avgComplianceRate =
      totalDays > 0 ? Number((healthyDays / totalDays).toFixed(2)) : 0;

    // 推断用餐时间模式
    const mealTimes: Record<string, number[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    };
    for (const record of records) {
      const hour = (record.createdAt as Date).getHours();
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

    behavior.mealTimingPatterns = {
      breakfast: avgHour(mealTimes.breakfast),
      lunch: avgHour(mealTimes.lunch),
      dinner: avgHour(mealTimes.dinner),
      snack: avgHour(mealTimes.snack),
    };

    await this.behaviorRepo.save(behavior);
  }

  // ================================================================
  //  每周一 03:00 — 用户分段 + 流失风险 + 营养缺口
  // ================================================================

  @Cron('0 3 * * 1')
  async weeklySegmentationUpdate(): Promise<void> {
    this.logger.log('开始每周分段更新...');
    const startTime = Date.now();

    try {
      const inferred = await this.inferredRepo.find();
      let updated = 0;

      for (const inf of inferred) {
        try {
          await this.updateWeeklySegmentation(inf);
          updated++;
        } catch (err) {
          this.logger.warn(
            `用户 ${inf.userId} 分段更新失败: ${(err as Error).message}`,
          );
        }
      }

      this.profileCacheService.invalidateAll();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `每周分段更新完成: ${updated}/${inferred.length} 用户, 耗时 ${elapsed}s`,
      );
    } catch (err) {
      this.logger.error(
        `每周分段更新失败: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async updateWeeklySegmentation(
    inferred: UserInferredProfile,
  ): Promise<void> {
    const userId = inferred.userId;
    const [profile, behavior] = await Promise.all([
      this.profileRepo.findOne({ where: { userId } }),
      this.behaviorRepo.findOne({ where: { userId } }),
    ]);

    if (!profile) return;

    // 用户分段
    const complianceRate = Number(behavior?.avgComplianceRate ?? 0);
    const goal = profile.goal;

    if (goal === 'muscle_gain') {
      inferred.userSegment = 'muscle_builder';
    } else if (complianceRate >= 0.7) {
      inferred.userSegment =
        goal === 'fat_loss' ? 'disciplined_loser' : 'active_maintainer';
    } else if (
      complianceRate < 0.4 &&
      behavior &&
      behavior.totalRecords >= 14
    ) {
      inferred.userSegment = 'binge_risk';
    } else {
      inferred.userSegment = 'casual_maintainer';
    }

    // 流失风险评估
    const lastRecordDate = await this.getLastRecordDate(userId);
    const daysSinceLastRecord = lastRecordDate
      ? Math.floor(
          (Date.now() - lastRecordDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 999;

    let churnRisk = 0;
    if (daysSinceLastRecord >= 14) churnRisk = 0.9;
    else if (daysSinceLastRecord >= 7) churnRisk = 0.7;
    else if (daysSinceLastRecord >= 3) churnRisk = 0.4;
    else if (complianceRate < 0.3) churnRisk = 0.5;
    else churnRisk = 0.1;

    inferred.churnRisk = Number(churnRisk.toFixed(2));

    // 营养缺口分析（基于最近 7 天食物记录）
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weeklyRecords = await this.foodRecordRepo
      .createQueryBuilder('r')
      .where('r.user_id = :userId', { userId })
      .andWhere('r.created_at >= :since', { since: sevenDaysAgo })
      .getMany();

    if (weeklyRecords.length >= 5) {
      const gaps: string[] = [];
      const avgProtein =
        weeklyRecords.reduce((s, r) => s + (Number(r.totalProtein) || 0), 0) /
        weeklyRecords.length;
      const avgCalories =
        weeklyRecords.reduce((s, r) => s + (Number(r.totalCalories) || 0), 0) /
        weeklyRecords.length;

      const macroTargets = (inferred.macroTargets as any) || {};
      if (macroTargets.proteinG && avgProtein < macroTargets.proteinG * 0.6) {
        gaps.push('protein');
      }
      const dailyGoal = Number(profile?.dailyCalorieGoal) || 2000;
      if (avgCalories < dailyGoal * 0.5) gaps.push('calories_deficit');

      inferred.nutritionGaps = gaps;
    }

    // 置信度
    inferred.confidenceScores = {
      ...inferred.confidenceScores,
      userSegment: behavior && behavior.totalRecords >= 14 ? 0.7 : 0.4,
      churnRisk: daysSinceLastRecord < 999 ? 0.8 : 0.3,
      nutritionGaps: weeklyRecords.length >= 10 ? 0.7 : 0.4,
    };

    inferred.lastComputedAt = new Date();
    await this.inferredRepo.save(inferred);
  }

  // ================================================================
  //  每 14 天（隔周日 04:00）— 口味偏好向量
  // ================================================================

  @Cron('0 4 1,15 * *')
  async biweeklyTastePrefUpdate(): Promise<void> {
    this.logger.log('开始口味偏好向量更新...');
    const startTime = Date.now();

    try {
      const inferred = await this.inferredRepo.find();
      let updated = 0;

      for (const inf of inferred) {
        try {
          await this.updateTastePrefVector(inf);
          updated++;
        } catch (err) {
          this.logger.warn(
            `用户 ${inf.userId} 口味向量更新失败: ${(err as Error).message}`,
          );
        }
      }

      this.profileCacheService.invalidateAll();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `口味偏好更新完成: ${updated}/${inferred.length} 用户, 耗时 ${elapsed}s`,
      );
    } catch (err) {
      this.logger.error(
        `口味偏好更新失败: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async updateTastePrefVector(
    inferred: UserInferredProfile,
  ): Promise<void> {
    const userId = inferred.userId;
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // 从反馈中提取接受的食物（带时间衰减）
    const feedbacks = await this.feedbackRepo
      .createQueryBuilder('f')
      .where('f.user_id = :userId', { userId })
      .andWhere('f.created_at >= :since', { since: sixtyDaysAgo })
      .getMany();

    if (feedbacks.length < 10) return;

    // 按 tag 聚合加权统计（指数衰减: e^(-0.05 × days_since)）
    const tagWeights: Record<string, number> = {};
    const now = Date.now();

    for (const fb of feedbacks) {
      const daysSince = Math.floor(
        (now - (fb.createdAt as Date).getTime()) / (1000 * 60 * 60 * 24),
      );
      const decayWeight = Math.exp(-0.05 * daysSince);
      const multiplier = fb.action === 'accepted' ? 1 : -0.5;

      // 使用食物名作为简化向量维度
      const key = fb.foodName || 'unknown';
      tagWeights[key] = (tagWeights[key] || 0) + multiplier * decayWeight;
    }

    // 归一化为 Top 20 偏好向量
    const sorted = Object.entries(tagWeights)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([name, weight]) => ({ name, weight: Number(weight.toFixed(3)) }));

    // 存储为权重数组（number[]），仅保存 Top 20 食物的衰减权重
    inferred.tastePrefVector = sorted.map((item) => item.weight);

    inferred.confidenceScores = {
      ...inferred.confidenceScores,
      tastePrefVector: Math.min(0.9, 0.3 + feedbacks.length * 0.01),
    };

    inferred.lastComputedAt = new Date();
    await this.inferredRepo.save(inferred);
  }

  // ================================================================
  //  辅助方法
  // ================================================================

  private async getLastRecordDate(userId: string): Promise<Date | null> {
    const record = await this.foodRecordRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return record ? (record.createdAt as Date) : null;
  }
}
