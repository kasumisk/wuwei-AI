import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProfileCacheService } from './profile-cache.service';
import { inferUserSegment } from './segmentation.util';
import {
  getUserLocalDate,
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../common/utils/timezone.util';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

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
    private readonly prisma: PrismaService,
    private readonly profileCacheService: ProfileCacheService,
    private readonly redisCacheService: RedisCacheService,
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
      // V5 3.3: 批处理 + 并发优化
      const behaviors = await this.prisma.user_behavior_profiles.findMany();
      const behaviorResult = await this.processBatched(
        behaviors as any[],
        (behavior) => this.updateDailyBehavior(behavior),
        '每日行为更新',
      );

      // V5 3.1/3.2: 更新 goalProgress + optimalMealCount
      const inferred = await this.prisma.user_inferred_profiles.findMany();
      let goalProgressUpdated = 0;
      let optimalMealCountUpdated = 0;

      const inferredResult = await this.processBatched(
        inferred as any[],
        async (inf) => {
          const gpChanged = await this.updateGoalProgress(inf);
          if (gpChanged) goalProgressUpdated++;

          // optimalMealCount: 基于对应 behavior 的 mealTimingPatterns
          const behavior = behaviors.find((b) => b.user_id === inf.user_id);
          if (behavior?.meal_timing_patterns) {
            const stableSlots = (
              ['breakfast', 'lunch', 'dinner', 'snack'] as const
            ).filter((k) => (behavior.meal_timing_patterns as any)[k]).length;
            if (stableSlots > 0) {
              const newCount = Math.max(3, stableSlots);
              if (inf.optimal_meal_count !== newCount) {
                await this.prisma.user_inferred_profiles.update({
                  where: { user_id: inf.user_id },
                  data: {
                    optimal_meal_count: newCount,
                    confidence_scores: {
                      ...((inf.confidence_scores as any) || {}),
                      optimalMealCount: Math.min(
                        0.9,
                        0.5 + (behavior.total_records || 0) * 0.01,
                      ),
                    },
                    last_computed_at: new Date(),
                  },
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
        `每日画像更新完成: 行为=${behaviorResult.succeeded}/${behaviors.length}(失败${behaviorResult.failed}), ` +
          `goalProgress=${goalProgressUpdated}, optimalMealCount=${optimalMealCountUpdated}, ` +
          `推断=${inferredResult.succeeded}/${inferred.length}(失败${inferredResult.failed}), 耗时 ${elapsed}s`,
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
    const userId = behavior.user_id;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 30 天窗口内的食物记录
    const records = await this.prisma.food_records.findMany({
      where: {
        user_id: userId,
        created_at: { gte: thirtyDaysAgo },
      },
    });

    if (records.length === 0) return;

    // 更新执行率（30 天窗口）
    const profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });
    const dailyGoal = profile?.daily_calorie_goal || 2000;
    const tz = profile?.timezone || DEFAULT_TIMEZONE;

    // 按用户本地日期聚合（避免 UTC 日期跨时区偏移）
    const dailyCalories: Record<string, number> = {};
    for (const record of records) {
      const day = getUserLocalDate(tz, record.created_at as Date);
      dailyCalories[day] =
        (dailyCalories[day] || 0) + (Number(record.total_calories) || 0);
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
      const hour = getUserLocalHour(tz, record.created_at as Date);
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
      const hour = getUserLocalHour(tz, record.created_at as Date);
      if (!hourlyCalories[hour]) hourlyCalories[hour] = [];
      hourlyCalories[hour].push(Number(record.total_calories) || 0);
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
    const mealsPerDay = profile?.meals_per_day || 3;
    const plannedPerMeal = dailyGoal / mealsPerDay;
    let portionTendency = behavior.portion_tendency;
    if (plannedPerMeal > 0 && records.length >= 5) {
      const avgActualPerMeal =
        records.reduce((sum, r) => sum + (Number(r.total_calories) || 0), 0) /
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

    await this.prisma.user_behavior_profiles.update({
      where: { user_id: userId },
      data: {
        avg_compliance_rate: avgComplianceRate,
        meal_timing_patterns: mealTimingPatterns as any,
        binge_risk_hours: bingeRiskHours.sort((a, b) => a - b),
        portion_tendency: portionTendency,
      },
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
      const inferred = await this.prisma.user_inferred_profiles.findMany();

      // V5 3.3: 批处理 + 并发优化
      const result = await this.processBatched(
        inferred as any[],
        (inf) => this.updateWeeklySegmentation(inf),
        '每周分段更新',
      );

      this.profileCacheService.invalidateAll();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `每周分段更新完成: ${result.succeeded}/${inferred.length}(失败${result.failed}), 耗时 ${elapsed}s`,
      );
    } catch (err) {
      this.logger.error(
        `每周分段更新失败: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async updateWeeklySegmentation(inferred: any): Promise<void> {
    const userId = inferred.user_id;
    const [profile, behavior] = await Promise.all([
      this.prisma.user_profiles.findUnique({ where: { user_id: userId } }),
      this.prisma.user_behavior_profiles.findUnique({
        where: { user_id: userId },
      }),
    ]);

    if (!profile) return;

    const complianceRate = Number(behavior?.avg_compliance_rate ?? 0);

    // V5 3.4: 计算 daysSinceLastRecord 和 usageDays 供分段使用
    const lastRecordDate = await this.getLastRecordDate(userId);
    const daysSinceLastRecord = lastRecordDate
      ? Math.floor(
          (Date.now() - lastRecordDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 999;

    // usageDays: 首条记录到现在的天数
    const firstRecord = await this.prisma.food_records.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'asc' },
    });
    const usageDays = firstRecord
      ? Math.floor(
          (Date.now() - (firstRecord.created_at as Date).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 0;

    // 用户分段 — V5 3.4: 升级版 segmentation (含 new_user/returning_user/交叉分类)
    const segmentResult = inferUserSegment(profile.goal as any, {
      avgComplianceRate:
        behavior?.avg_compliance_rate != null
          ? Number(behavior.avg_compliance_rate)
          : undefined,
      totalRecords: behavior?.total_records ?? undefined,
      daysSinceLastRecord,
      usageDays,
    });

    let churnRisk = 0;
    if (daysSinceLastRecord >= 14) churnRisk = 0.9;
    else if (daysSinceLastRecord >= 7) churnRisk = 0.7;
    else if (daysSinceLastRecord >= 3) churnRisk = 0.4;
    else if (complianceRate < 0.3) churnRisk = 0.5;
    else churnRisk = 0.1;

    // 营养缺口分析（基于最近 7 天食物记录）
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weeklyRecords = await this.prisma.food_records.findMany({
      where: {
        user_id: userId,
        created_at: { gte: sevenDaysAgo },
      },
    });

    let nutritionGaps = inferred.nutrition_gaps as any;
    if (weeklyRecords.length >= 5) {
      const gaps: string[] = [];
      const avgProtein =
        weeklyRecords.reduce((s, r) => s + (Number(r.total_protein) || 0), 0) /
        weeklyRecords.length;
      const avgCalories =
        weeklyRecords.reduce((s, r) => s + (Number(r.total_calories) || 0), 0) /
        weeklyRecords.length;

      const macroTargets = (inferred.macro_targets as any) || {};
      if (macroTargets.proteinG && avgProtein < macroTargets.proteinG * 0.6) {
        gaps.push('protein');
      }
      const dailyGoal = Number(profile?.daily_calorie_goal) || 2000;
      if (avgCalories < dailyGoal * 0.5) gaps.push('calories_deficit');

      nutritionGaps = gaps;
    }

    // 置信度 — V5 3.4: 使用 segmentResult 的 confidence
    const confidenceScores = {
      ...((inferred.confidence_scores as any) || {}),
      userSegment: segmentResult.confidence,
      segmentSecondaryFlags: segmentResult.secondaryFlags.length,
      churnRisk: daysSinceLastRecord < 999 ? 0.8 : 0.3,
      nutritionGaps: weeklyRecords.length >= 10 ? 0.7 : 0.4,
    };

    await this.prisma.user_inferred_profiles.update({
      where: { user_id: userId },
      data: {
        user_segment: segmentResult.segment,
        churn_risk: Number(churnRisk.toFixed(2)),
        nutrition_gaps: nutritionGaps,
        confidence_scores: confidenceScores as any,
        last_computed_at: new Date(),
      },
    });
  }

  // ================================================================
  //  每 14 天（隔周日 04:00）— 口味偏好向量
  // ================================================================

  @Cron('0 4 1,15 * *')
  async biweeklyTastePrefUpdate(): Promise<void> {
    // V5 1.11: 分布式锁
    await this.redisCacheService.runWithLock(
      'biweekly_taste_pref_update',
      15 * 60 * 1000,
      () => this.doBiweeklyTastePrefUpdate(),
    );
  }

  private async doBiweeklyTastePrefUpdate(): Promise<void> {
    this.logger.log('开始口味偏好向量更新...');
    const startTime = Date.now();

    try {
      const inferred = await this.prisma.user_inferred_profiles.findMany();

      // V5 3.3: 批处理 + 并发优化
      const result = await this.processBatched(
        inferred as any[],
        (inf) => this.updateTastePrefVector(inf),
        '口味偏好更新',
      );

      this.profileCacheService.invalidateAll();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `口味偏好更新完成: ${result.succeeded}/${inferred.length}(失败${result.failed}), 耗时 ${elapsed}s`,
      );
    } catch (err) {
      this.logger.error(
        `口味偏好更新失败: ${(err as Error).message}`,
        (err as Error).stack,
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
      const allInferred = await this.prisma.user_inferred_profiles.findMany();

      // V5 3.3: 批处理 + 并发优化
      const result = await this.processBatched(
        allInferred as any[],
        async (inf) => {
          if (!inf.preference_weights) return;

          const weights = inf.preference_weights as Record<
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
            await this.prisma.user_inferred_profiles.update({
              where: { user_id: inf.user_id },
              data: {
                preference_weights: weights as any,
              },
            });
          }
        },
        '偏好权重衰减',
      );

      this.profileCacheService.invalidateAll();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `偏好权重衰减完成: ${result.succeeded}/${allInferred.length}(失败${result.failed}), 耗时 ${elapsed}s`,
      );
    } catch (err) {
      this.logger.error(
        `偏好权重衰减失败: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async updateTastePrefVector(inferred: any): Promise<void> {
    const userId = inferred.user_id;
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // 从反馈中提取接受的食物（带时间衰减）
    const feedbacks = await this.prisma.recommendation_feedbacks.findMany({
      where: {
        user_id: userId,
        created_at: { gte: sixtyDaysAgo },
      },
    });

    if (feedbacks.length < 10) return;

    // 按 tag 聚合加权统计（指数衰减: e^(-0.05 × days_since)）
    const tagWeights: Record<string, number> = {};
    const now = Date.now();

    for (const fb of feedbacks) {
      const daysSince = Math.floor(
        (now - (fb.created_at as Date).getTime()) / (1000 * 60 * 60 * 24),
      );
      const decayWeight = Math.exp(-0.05 * daysSince);
      const multiplier = fb.action === 'accepted' ? 1 : -0.5;

      // 使用食物名作为简化向量维度
      const key = fb.food_name || 'unknown';
      tagWeights[key] = (tagWeights[key] || 0) + multiplier * decayWeight;
    }

    // 归一化为 Top 20 偏好向量
    const sorted = Object.entries(tagWeights)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([name, weight]) => ({ name, weight: Number(weight.toFixed(3)) }));

    // 存储为权重数组（number[]），仅保存 Top 20 食物的衰减权重
    const tastePrefVector = sorted.map((item) => item.weight);

    const confidenceScores = {
      ...((inferred.confidence_scores as any) || {}),
      tastePrefVector: Math.min(0.9, 0.3 + feedbacks.length * 0.01),
    };

    await this.prisma.user_inferred_profiles.update({
      where: { user_id: userId },
      data: {
        taste_pref_vector: tastePrefVector,
        confidence_scores: confidenceScores as any,
        last_computed_at: new Date(),
      },
    });
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
    const userId = inferred.user_id;

    // 获取用户档案（需要 targetWeightKg）
    const profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });
    if (!profile?.target_weight_kg) return false;

    // 查询体重历史（按时间升序）
    const weightRecords = await this.prisma.weight_history.findMany({
      where: { user_id: userId },
      orderBy: { recorded_at: 'asc' },
    });

    if (weightRecords.length === 0) return false;

    const startWeight = Number(weightRecords[0].weight_kg);
    const currentWeight = Number(
      weightRecords[weightRecords.length - 1].weight_kg,
    );
    const targetWeight = Number(profile.target_weight_kg);

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
      (r) => (r.recorded_at as Date).getTime() >= fourWeeksAgo.getTime(),
    );

    let trend: 'losing' | 'gaining' | 'plateau' | 'fluctuating' = 'plateau';
    let weeklyRateKg = 0;

    if (recentRecords.length >= 2) {
      // 计算周均变化量
      const first = recentRecords[0];
      const last = recentRecords[recentRecords.length - 1];
      const daySpan = Math.max(
        1,
        ((last.recorded_at as Date).getTime() -
          (first.recorded_at as Date).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const totalChange = Number(last.weight_kg) - Number(first.weight_kg);
      weeklyRateKg = Number(((totalChange / daySpan) * 7).toFixed(2));

      // 趋势判断
      if (recentRecords.length >= 3) {
        // 计算波动度: 相邻记录变化方向不一致的次数
        let directionChanges = 0;
        for (let i = 2; i < recentRecords.length; i++) {
          const prev =
            Number(recentRecords[i - 1].weight_kg) -
            Number(recentRecords[i - 2].weight_kg);
          const curr =
            Number(recentRecords[i].weight_kg) -
            Number(recentRecords[i - 1].weight_kg);
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
      ...((inferred.confidence_scores as any) || {}),
      goalProgress: Math.min(0.95, 0.3 + weightRecords.length * 0.05),
    };

    await this.prisma.user_inferred_profiles.update({
      where: { user_id: userId },
      data: {
        goal_progress: goalProgress as any,
        confidence_scores: confidenceScores as any,
        last_computed_at: new Date(),
      },
    });
    return true;
  }

  private async getLastRecordDate(userId: string): Promise<Date | null> {
    const record = await this.prisma.food_records.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
    return record ? (record.created_at as Date) : null;
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
  private async processBatched<T extends { user_id?: string }>(
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
}
