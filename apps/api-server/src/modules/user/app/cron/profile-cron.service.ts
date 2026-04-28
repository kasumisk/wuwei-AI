import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProfileCacheService } from '../services/profile/profile-cache.service';
import { inferUserSegment } from '../services/segmentation.util';
import {
  getUserLocalDate,
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../../common/utils/timezone.util';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { StrategySelectorService } from '../../../strategy/app/strategy-selector.service';
import { ChurnPredictionService } from '../services/churn-prediction.service';
import {
  updateInferred,
  updateBehavior,
  getBehavior,
} from '../../user-profile-merge.helper';

/**
 * 用户画像定时任务
 *
 * - 每日 02:00 → 更新 avgComplianceRate, streakDays, mealTimingPatterns
 * - 每周一 03:00 → 更新 userSegment, churnRisk, nutritionGaps
 */
@Injectable()
export class ProfileCronService {
  private readonly logger = new Logger(ProfileCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileCacheService: ProfileCacheService,
    private readonly redisCacheService: RedisCacheService,
    /** V6.3 P2-2: 分群→策略自动映射 */
    private readonly strategySelectorService: StrategySelectorService,
    /** V6.5 Phase 3L: 多维特征流失预测 */
    private readonly churnPredictionService: ChurnPredictionService,
  ) {}

  // ================================================================
  //  每日 02:00 — 行为数据滑动窗口更新
  // ================================================================

  @Cron('0 2 * * *')
  async dailyProfileUpdate(): Promise<void> {
    // V5 1.11: 分布式锁，多实例部署时只有一个实例执行
    await this.redisCacheService.runWithLock(
      'daily_profile_update',
      10 * 60 * 1000, // 10 分钟过期
      () => this.doDailyProfileUpdate(),
    );
  }

  private async doDailyProfileUpdate(): Promise<void> {
    this.logger.log('开始每日画像更新...');
    const startTime = Date.now();

    try {
      // V6.2 3.6: 游标分页替代全量 findMany
      const behaviorResult = await this.processCursorPaged(
        'user_behavior_profiles',
        (behavior: any) => this.updateDailyBehavior(behavior),
        '每日行为更新',
      );

      // V5 3.1/3.2: 更新 goalProgress + optimalMealCount
      let goalProgressUpdated = 0;
      let optimalMealCountUpdated = 0;

      const inferredResult = await this.processCursorPaged(
        'user_inferred_profiles',
        async (inf: any) => {
          const gpChanged = await this.updateGoalProgress(inf);
          if (gpChanged) goalProgressUpdated++;

          // optimalMealCount: 基于对应 behavior 的 mealTimingPatterns
          const _behaviorProfile = await this.prisma.userProfiles.findUnique({
            where: { userId: inf.userId },
          });
          const behavior = _behaviorProfile ? getBehavior(_behaviorProfile) : null;
          if (behavior?.mealTimingPatterns) {
            const stableSlots = (
              ['breakfast', 'lunch', 'dinner', 'snack'] as const
            ).filter((k) => (behavior.mealTimingPatterns as any)[k]).length;
            if (stableSlots > 0) {
              const newCount = Math.max(3, stableSlots);
              if (inf.optimalMealCount !== newCount) {
                await updateInferred(this.prisma, inf.userId, {
                  optimalMealCount: newCount,
                  confidenceScores: {
                    ...((inf.confidenceScores as any) || {}),
                    optimalMealCount: Math.min(
                      0.9,
                      0.5 + (behavior.totalRecords || 0) * 0.01,
                    ),
                  },
                  lastComputedAt: new Date(),
                });
                optimalMealCountUpdated++;
              }
            }
          }
        },
        '推断画像更新',
      );

      // 失效全部缓存
      this.profileCacheService.invalidateAll();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `每日画像更新完成: 行为=${behaviorResult.succeeded}/${behaviorResult.total}(失败${behaviorResult.failed}), ` +
          `goalProgress=${goalProgressUpdated}, optimalMealCount=${optimalMealCountUpdated}, ` +
          `推断=${inferredResult.succeeded}/${inferredResult.total}(失败${inferredResult.failed}), 耗时 ${elapsed}s`,
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
  private async updateDailyBehavior(behavior: any): Promise<void> {
    const userId = behavior.userId;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 30 天窗口内的食物记录
    const records = await this.prisma.foodRecords.findMany({
      where: {
        userId: userId,
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    if (records.length === 0) return;

    // 更新执行率（30 天窗口）
    const profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });
    const dailyGoal = profile?.dailyCalorieGoal || 2000;
    const tz = profile?.timezone || DEFAULT_TIMEZONE;

    // 按用户本地日期聚合（避免 UTC 日期跨时区偏移）
    const dailyCalories: Record<string, number> = {};
    for (const record of records) {
      const day = getUserLocalDate(tz, record.createdAt as Date);
      dailyCalories[day] =
        (dailyCalories[day] || 0) + (Number(record.totalCalories) || 0);
    }

    const totalDays = Object.keys(dailyCalories).length;
    const healthyDays = Object.values(dailyCalories).filter(
      (cal) => cal <= dailyGoal,
    ).length;
    const avgComplianceRate =
      totalDays > 0 ? Number((healthyDays / totalDays).toFixed(2)) : 0;

    // 推断用餐时间模式（使用用户本地时区的小时数）
    const mealTimes: Record<string, number[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    };
    for (const record of records) {
      const hour = getUserLocalHour(tz, record.createdAt as Date);
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

    const mealTimingPatterns = {
      breakfast: avgHour(mealTimes.breakfast),
      lunch: avgHour(mealTimes.lunch),
      dinner: avgHour(mealTimes.dinner),
      snack: avgHour(mealTimes.snack),
    };

    // V5 3.2: 填充 bingeRiskHours — 卡路里密度 >150% 日均的小时桶
    const dailyAvgCal =
      totalDays > 0
        ? Object.values(dailyCalories).reduce((a, b) => a + b, 0) / totalDays
        : dailyGoal;
    // 按小时桶统计卡路里
    const hourlyCalories: Record<number, number[]> = {};
    for (const record of records) {
      const hour = getUserLocalHour(tz, record.createdAt as Date);
      if (!hourlyCalories[hour]) hourlyCalories[hour] = [];
      hourlyCalories[hour].push(Number(record.totalCalories) || 0);
    }
    // 日均小时桶均值 = dailyAvgCal / 活跃餐次数（以3为默认）
    const activeMealSlots = Math.max(3, Object.keys(hourlyCalories).length);
    const perSlotAvg = dailyAvgCal / activeMealSlots;
    const threshold150 = perSlotAvg * 1.5;

    const bingeRiskHours: number[] = [];
    for (const [hourStr, cals] of Object.entries(hourlyCalories)) {
      // 该小时桶出现过高卡路里的次数 >= 3 次，标记为暴食风险
      const highCalCount = cals.filter((c) => c > threshold150).length;
      if (highCalCount >= 3) {
        bingeRiskHours.push(Number(hourStr));
      }
    }

    // V5 3.2: 填充 portionTendency — 实际每餐卡路里 vs 计划每餐卡路里
    const mealsPerDay = profile?.mealsPerDay || 3;
    const plannedPerMeal = dailyGoal / mealsPerDay;
    let portionTendency = behavior.portionTendency;
    if (plannedPerMeal > 0 && records.length >= 5) {
      const avgActualPerMeal =
        records.reduce((sum, r) => sum + (Number(r.totalCalories) || 0), 0) /
        records.length;
      const ratio = avgActualPerMeal / plannedPerMeal;
      if (ratio > 1.15) {
        portionTendency = 'large';
      } else if (ratio < 0.85) {
        portionTendency = 'small';
      } else {
        portionTendency = 'normal';
      }
    }

    await updateBehavior(this.prisma, userId, {
      avgComplianceRate: avgComplianceRate,
      mealTimingPatterns: mealTimingPatterns as any,
      bingeRiskHours: bingeRiskHours.sort((a, b) => a - b),
      portionTendency: portionTendency,
    });
  }

  // ================================================================
  //  每周一 03:00 — 用户分段 + 流失风险 + 营养缺口
  // ================================================================

  @Cron('0 3 * * 1')
  async weeklySegmentationUpdate(): Promise<void> {
    // V5 1.11: 分布式锁
    await this.redisCacheService.runWithLock(
      'weekly_segmentation_update',
      15 * 60 * 1000, // 15 分钟过期
      () => this.doWeeklySegmentationUpdate(),
    );
  }

  private async doWeeklySegmentationUpdate(): Promise<void> {
    this.logger.log('开始每周分段更新...');
    const startTime = Date.now();

    try {
      // V6.2 3.6: 游标分页替代全量 findMany
      const result = await this.processCursorPaged(
        'user_inferred_profiles',
        (inf: any) => this.updateWeeklySegmentation(inf),
        '每周分段更新',
      );

      this.profileCacheService.invalidateAll();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `每周分段更新完成: ${result.succeeded}/${result.total}(失败${result.failed}), 耗时 ${elapsed}s`,
      );
    } catch (err) {
      this.logger.error(
        `每周分段更新失败: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async updateWeeklySegmentation(inferred: any): Promise<void> {
    const userId = inferred.userId;
    const profile = await this.prisma.userProfiles.findUnique({ where: { userId: userId } });
    const behavior = profile ? getBehavior(profile) : null;

    if (!profile) return;

    const complianceRate = Number(behavior?.avgComplianceRate ?? 0);

    // V5 3.4: 计算 daysSinceLastRecord 和 usageDays 供分段使用
    const lastRecordDate = await this.getLastRecordDate(userId);
    const daysSinceLastRecord = lastRecordDate
      ? Math.floor(
          (Date.now() - lastRecordDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 999;

    // usageDays: 首条记录到现在的天数
    const firstRecord = await this.prisma.foodRecords.findFirst({
      where: { userId: userId },
      orderBy: { createdAt: 'asc' },
    });
    const usageDays = firstRecord
      ? Math.floor(
          (Date.now() - (firstRecord.createdAt as Date).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 0;

    // 用户分段 — V5 3.4: 升级版 segmentation (含 new_user/returning_user/交叉分类)
    const segmentResult = inferUserSegment(profile.goal as any, {
      avgComplianceRate:
        behavior?.avgComplianceRate != null
          ? Number(behavior.avgComplianceRate)
          : undefined,
      totalRecords: behavior?.totalRecords ?? undefined,
      daysSinceLastRecord,
      usageDays,
    });

    // V6.5 Phase 3L: 多维特征流失预测（替代简单 5 条规则）
    const churnResult = await this.churnPredictionService.computeChurnRisk(
      userId,
      daysSinceLastRecord,
      complianceRate,
      behavior?.streakDays ?? 0,
      behavior?.totalRecords ?? 0,
    );
    const churnRisk = churnResult.churnRisk;

    // 营养缺口分析（基于最近 7 天食物记录）
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weeklyRecords = await this.prisma.foodRecords.findMany({
      where: {
        userId: userId,
        createdAt: { gte: sevenDaysAgo },
      },
    });

    let nutritionGaps = inferred.nutritionGaps as any;
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

      nutritionGaps = gaps;
    }

    // 置信度 — V5 3.4: 使用 segmentResult 的 confidence; V6.5 Phase 3L: churn 置信度来自预测模型
    const confidenceScores = {
      ...((inferred.confidenceScores as any) || {}),
      userSegment: segmentResult.confidence,
      segmentSecondaryFlags: segmentResult.secondaryFlags.length,
      churnRisk: churnResult.confidence,
      nutritionGaps: weeklyRecords.length >= 10 ? 0.7 : 0.4,
    };

    await updateInferred(this.prisma, userId, {
      userSegment: segmentResult.segment,
      churnRisk: Number(churnRisk.toFixed(2)),
      nutritionGaps: nutritionGaps,
      confidenceScores: confidenceScores as any,
      lastComputedAt: new Date(),
    });

    // V6.3 P2-2: 分群变更时自动映射推荐策略
    try {
      await this.strategySelectorService.selectAndAssign(
        userId,
        segmentResult.segment,
      );
    } catch (err) {
      // 策略映射失败不应阻断画像更新
      this.logger.warn(
        `策略自动映射失败 (user=${userId}, segment=${segmentResult.segment}): ${(err as Error).message}`,
      );
    }
  }

  // ================================================================
  //  V4 Phase 3.2: 每 14 天（隔周日 04:30）— 偏好权重衰减
  // ================================================================

  /**
   * 偏好权重衰减调度器
   *
   * 设计动机:
   * - Phase 3.1 的增量更新会持续累积权重变化，但用户口味会随时间漂移
   * - 每两周对所有增量权重施加 decay=0.95，使陈旧偏好自然回归基线 (1.0)
   * - 衰减公式: newWeight = 1.0 + (oldWeight - 1.0) * DECAY_FACTOR
   *   即只衰减偏离基线的部分，基线 1.0 本身不变
   * - 衰减后清理权重已回归到 [0.98, 1.02] 的键（视为无偏好）
   */
  @Cron('30 4 1,15 * *')
  async biweeklyPreferenceDecay(): Promise<void> {
    // V5 1.11: 分布式锁
    await this.redisCacheService.runWithLock(
      'biweekly_preference_decay',
      10 * 60 * 1000,
      () => this.doBiweeklyPreferenceDecay(),
    );
  }

  private async doBiweeklyPreferenceDecay(): Promise<void> {
    this.logger.log('开始偏好权重衰减...');
    const startTime = Date.now();
    const DECAY_FACTOR = 0.95;
    const NEUTRAL_THRESHOLD = 0.02; // |weight - 1.0| < 0.02 → 清理

    try {
      // V6.2 3.6: 游标分页替代全量 findMany
      const result = await this.processCursorPaged(
        'user_inferred_profiles',
        async (inf: any) => {
          if (!inf.preferenceWeights) return;

          const weights = inf.preferenceWeights as Record<
            string,
            Record<string, number> | string | number
          >;

          const dimensionKeys = [
            'categoryWeights',
            'ingredientWeights',
            'foodGroupWeights',
            'foodNameWeights',
          ] as const;

          let changed = false;
          for (const dimKey of dimensionKeys) {
            const dim = weights[dimKey];
            if (!dim || typeof dim !== 'object') continue;

            const dimMap = dim as Record<string, number>;
            for (const [key, value] of Object.entries(dimMap)) {
              if (typeof value !== 'number') continue;
              const decayed = 1.0 + (value - 1.0) * DECAY_FACTOR;
              if (Math.abs(decayed - 1.0) < NEUTRAL_THRESHOLD) {
                delete dimMap[key];
              } else {
                dimMap[key] = Number(decayed.toFixed(4));
              }
              changed = true;
            }
          }

          if (changed) {
            await updateInferred(this.prisma, inf.userId, {
              preferenceWeights: weights as any,
            });
          }
        },
        '偏好权重衰减',
      );

      this.profileCacheService.invalidateAll();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `偏好权重衰减完成: ${result.succeeded}/${result.total}(失败${result.failed}), 耗时 ${elapsed}s`,
      );
    } catch (err) {
      this.logger.error(
        `偏好权重衰减失败: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  // ================================================================
  //  辅助方法
  // ================================================================

  /**
   * V5 Phase 3.1: 计算 goalProgress 并更新到 UserInferredProfile
   *
   * 计算逻辑:
   * - startWeight: weight_history 最早一条记录
   * - currentWeight: weight_history 最新一条记录
   * - targetWeight: user_profiles.targetWeightKg
   * - progressPercent: (start - current) / (start - target) * 100
   * - trend: 基于近 4 周滑动窗口计算 (losing/gaining/plateau/fluctuating)
   * - weeklyRateKg: 近 4 周平均周变化量
   * - estimatedWeeksLeft: 基于 weeklyRateKg 预估
   *
   * @returns 是否有实质更新
   */
  private async updateGoalProgress(inferred: any): Promise<boolean> {
    const userId = inferred.userId;

    // 获取用户档案（需要 targetWeightKg）
    const profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });
    if (!profile?.targetWeightKg) return false;

    // 查询体重历史（按时间升序）
    const weightRecords = await this.prisma.weightHistory.findMany({
      where: { userId: userId },
      orderBy: { recordedAt: 'asc' },
    });

    if (weightRecords.length === 0) return false;

    const startWeight = Number(weightRecords[0].weightKg);
    const currentWeight = Number(
      weightRecords[weightRecords.length - 1].weightKg,
    );
    const targetWeight = Number(profile.targetWeightKg);

    // 进度百分比: 避免除零
    const totalDelta = startWeight - targetWeight;
    const progressPercent =
      Math.abs(totalDelta) < 0.1
        ? 100
        : Math.min(
            100,
            Math.max(0, ((startWeight - currentWeight) / totalDelta) * 100),
          );

    // 趋势 & 周均变化量: 基于近 4 周（28 天）的记录
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    // NOTE: weightRecords come from Prisma (weight_history table) — uses snake_case fields
    const recentRecords = weightRecords.filter(
      (r) => (r.recordedAt as Date).getTime() >= fourWeeksAgo.getTime(),
    );

    let trend: 'losing' | 'gaining' | 'plateau' | 'fluctuating' = 'plateau';
    let weeklyRateKg = 0;

    if (recentRecords.length >= 2) {
      // 计算周均变化量
      const first = recentRecords[0];
      const last = recentRecords[recentRecords.length - 1];
      const daySpan = Math.max(
        1,
        ((last.recordedAt as Date).getTime() -
          (first.recordedAt as Date).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const totalChange = Number(last.weightKg) - Number(first.weightKg);
      weeklyRateKg = Number(((totalChange / daySpan) * 7).toFixed(2));

      // 趋势判断
      if (recentRecords.length >= 3) {
        // 计算波动度: 相邻记录变化方向不一致的次数
        let directionChanges = 0;
        for (let i = 2; i < recentRecords.length; i++) {
          const prev =
            Number(recentRecords[i - 1].weightKg) -
            Number(recentRecords[i - 2].weightKg);
          const curr =
            Number(recentRecords[i].weightKg) -
            Number(recentRecords[i - 1].weightKg);
          if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) {
            directionChanges++;
          }
        }
        const fluctuationRate = directionChanges / (recentRecords.length - 2);

        if (fluctuationRate > 0.5 && Math.abs(weeklyRateKg) < 0.3) {
          trend = 'fluctuating';
        } else if (weeklyRateKg < -0.1) {
          trend = 'losing';
        } else if (weeklyRateKg > 0.1) {
          trend = 'gaining';
        } else {
          trend = 'plateau';
        }
      } else {
        // 只有 2 条记录，简单判断
        if (weeklyRateKg < -0.1) trend = 'losing';
        else if (weeklyRateKg > 0.1) trend = 'gaining';
        else trend = 'plateau';
      }
    }

    // 预估剩余周数
    let estimatedWeeksLeft: number | null = null;
    const remaining = currentWeight - targetWeight;
    if (trend === 'losing' && weeklyRateKg < -0.05 && remaining > 0) {
      // weeklyRateKg 是负数，remaining 是正数
      estimatedWeeksLeft = Math.ceil(remaining / Math.abs(weeklyRateKg));
      // 上限 104 周（2 年），防止极端值
      estimatedWeeksLeft = Math.min(estimatedWeeksLeft, 104);
    } else if (trend === 'gaining' && weeklyRateKg > 0.05 && remaining < 0) {
      // 增重场景: remaining < 0, weeklyRateKg > 0
      estimatedWeeksLeft = Math.ceil(Math.abs(remaining) / weeklyRateKg);
      estimatedWeeksLeft = Math.min(estimatedWeeksLeft, 104);
    }

    // 更新 goalProgress
    const goalProgress = {
      startWeight,
      currentWeight,
      targetWeight,
      progressPercent: Number(progressPercent.toFixed(1)),
      trend,
      weeklyRateKg,
      estimatedWeeksLeft: estimatedWeeksLeft ?? undefined,
    };

    // 更新置信度: 数据越多越可信
    const confidenceScores = {
      ...((inferred.confidenceScores as any) || {}),
      goalProgress: Math.min(0.95, 0.3 + weightRecords.length * 0.05),
    };

    await updateInferred(this.prisma, userId, {
      goalProgress: goalProgress as any,
      confidenceScores: confidenceScores as any,
      lastComputedAt: new Date(),
    });
    return true;
  }

  private async getLastRecordDate(userId: string): Promise<Date | null> {
    const record = await this.prisma.foodRecords.findFirst({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return record ? (record.createdAt as Date) : null;
  }

  /**
   * V5 Phase 3.3: 通用批处理 + 并发限制器
   *
   * 将用户列表按 BATCH_SIZE 分批，每批内以 CONCURRENCY 并发执行，
   * 使用 Promise.allSettled 保证单个用户失败不影响整体。
   *
   * @param items 要处理的数据列表
   * @param processor 处理单个 item 的异步函数
   * @param label 日志标识
   * @returns { succeeded, failed } 统计
   */
  private async processBatched<T extends { userId?: string }>(
    items: T[],
    processor: (item: T) => Promise<void>,
    label: string,
  ): Promise<{ succeeded: number; failed: number }> {
    const BATCH_SIZE = 100;
    const CONCURRENCY = 5;
    let succeeded = 0;
    let failed = 0;

    for (let offset = 0; offset < items.length; offset += BATCH_SIZE) {
      const batch = items.slice(offset, offset + BATCH_SIZE);

      // 并发限制: 将 batch 分成 CONCURRENCY 大小的组
      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunk = batch.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map((item) => processor(item)),
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            succeeded++;
          } else {
            failed++;
          }
        }
      }

      // 每 100 用户记录进度
      if (items.length > BATCH_SIZE) {
        this.logger.log(
          `[${label}] 进度: ${Math.min(offset + BATCH_SIZE, items.length)}/${items.length}`,
        );
      }
    }

    return { succeeded, failed };
  }

  /**
   * V6.2 3.6: 游标分页批量处理 — 替代全量 findMany() + processBatched
   *
   * 使用 Prisma cursor-based pagination 逐页加载数据，
   * 避免一次性加载全量用户到内存。
   *
   * @param model Prisma model 名称（user_behavior_profiles / user_inferred_profiles）
   * @param processor 每条记录的处理函数
   * @param label 日志标签
   * @param pageSize 每页大小（默认 100）
   */
  async processCursorPaged<T extends { userId: string }>(
    model: 'user_behavior_profiles' | 'user_inferred_profiles',
    processor: (item: T) => Promise<void>,
    label: string,
    pageSize: number = 100,
  ): Promise<{ succeeded: number; failed: number; total: number }> {
    const CONCURRENCY = 5;
    let succeeded = 0;
    let failed = 0;
    let total = 0;
    let cursor: string | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = (await (this.prisma.userProfiles as any).findMany({
        take: pageSize,
        ...(cursor ? { skip: 1, cursor: { userId: cursor } } : {}),
        orderBy: { userId: 'asc' },
      })) as T[];

      if (page.length === 0) break;

      total += page.length;
      cursor = page[page.length - 1].userId;

      // 并发限制处理
      for (let i = 0; i < page.length; i += CONCURRENCY) {
        const chunk = page.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map((item) => processor(item)),
        );
        for (const result of results) {
          if (result.status === 'fulfilled') {
            succeeded++;
          } else {
            failed++;
          }
        }
      }

      this.logger.log(`[${label}] 进度: ${total} 条已处理`);

      // 如果返回不足一页，说明已到末尾
      if (page.length < pageSize) break;
    }

    return { succeeded, failed, total };
  }
}
