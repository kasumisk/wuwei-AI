import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UserProfile,
  GoalType,
  GoalSpeed,
} from '../entities/user-profile.entity';
import { UserInferredProfile } from '../entities/user-inferred-profile.entity';
import { UserBehaviorProfile } from '../entities/user-behavior-profile.entity';
import { inferUserSegment } from './segmentation.util';

export interface GoalTransitionSuggestion {
  currentGoal: GoalType;
  suggestedGoal: GoalType;
  suggestedSpeed?: GoalSpeed;
  reason: string;
  suggestedCalories?: number;
}

@Injectable()
export class ProfileInferenceService {
  private readonly logger = new Logger(ProfileInferenceService.name);

  constructor(
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    @InjectRepository(UserInferredProfile)
    private readonly inferredRepo: Repository<UserInferredProfile>,
    @InjectRepository(UserBehaviorProfile)
    private readonly behaviorRepo: Repository<UserBehaviorProfile>,
  ) {}

  /**
   * 获取推断数据
   */
  async getInferred(userId: string): Promise<UserInferredProfile | null> {
    return this.inferredRepo.findOne({ where: { userId } });
  }

  /**
   * 刷新推断数据（手动触发）
   */
  async refreshInference(userId: string): Promise<UserInferredProfile | null> {
    const profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) return null;

    const behavior = await this.behaviorRepo.findOne({ where: { userId } });
    let inferred = await this.inferredRepo.findOne({ where: { userId } });
    if (!inferred) {
      inferred = this.inferredRepo.create({ userId });
    }

    // 用户分段 — 统一使用 segmentation.util (V4 A4, V5 3.4 升级)
    const segBehavior:
      | import('./segmentation.util').SegmentBehaviorInput
      | null = behavior
      ? {
          avgComplianceRate: behavior.avgComplianceRate ?? undefined,
          totalRecords: behavior.totalRecords ?? 0,
          // refreshInference 为手动触发，无法精确算 daysSinceLastRecord/usageDays
          // 此处留空，cron 会在批量更新时填充精确值
        }
      : null;
    const segResult = inferUserSegment(profile.goal, segBehavior);
    inferred.userSegment = segResult.segment;
    inferred.confidenceScores = {
      ...inferred.confidenceScores,
      userSegment: segResult.confidence,
    };

    // 最优餐次推断（基于行为数据）
    if (behavior?.mealTimingPatterns) {
      const timingCount = Object.keys(behavior.mealTimingPatterns).filter(
        (k) => (behavior.mealTimingPatterns as any)[k],
      ).length;
      if (timingCount > 0) {
        inferred.optimalMealCount = timingCount;
        inferred.confidenceScores = {
          ...inferred.confidenceScores,
          optimalMealCount: Math.min(0.9, 0.5 + behavior.totalRecords * 0.01),
        };
      }
    }

    // 目标进展
    // V5 3.1: goalProgress 现在主要由 profile-cron.service 基于 weight_history 计算
    // 此处仅做简易回退：当 cron 尚未计算（无 weight_history 数据）时，基于 profile 体重粗略估算
    if (profile.targetWeightKg && profile.weightKg) {
      const startWeight =
        inferred.goalProgress?.startWeight || Number(profile.weightKg);
      const currentWeight = Number(profile.weightKg);
      const targetWeight = Number(profile.targetWeightKg);
      const totalDelta = startWeight - targetWeight;
      const progressPercent =
        Math.abs(totalDelta) > 0.1
          ? Math.min(
              100,
              Math.max(0, ((startWeight - currentWeight) / totalDelta) * 100),
            )
          : 0;

      // 仅在 cron 尚未填充 trend 时设置简易值
      if (!inferred.goalProgress?.trend) {
        const weightDiff = currentWeight - startWeight;
        let trend: 'losing' | 'gaining' | 'plateau' | 'fluctuating' = 'plateau';
        if (weightDiff < -0.5) trend = 'losing';
        else if (weightDiff > 0.5) trend = 'gaining';

        inferred.goalProgress = {
          ...inferred.goalProgress,
          startWeight: inferred.goalProgress?.startWeight || startWeight,
          currentWeight,
          targetWeight,
          progressPercent: Number(Math.min(100, progressPercent).toFixed(1)),
          trend,
        };
      } else {
        // cron 已计算过，仅更新 currentWeight（用户可能刚改了体重）
        inferred.goalProgress = {
          ...inferred.goalProgress,
          currentWeight,
        };
      }
    }

    inferred.lastComputedAt = new Date();
    return this.inferredRepo.save(inferred);
  }

  /**
   * 获取目标迁移建议
   */
  async getGoalTransitionSuggestion(
    userId: string,
  ): Promise<GoalTransitionSuggestion | null> {
    const profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) return null;

    const inferred = await this.inferredRepo.findOne({ where: { userId } });

    // fat_loss 达成
    if (
      profile.goal === GoalType.FAT_LOSS &&
      profile.targetWeightKg &&
      Number(profile.weightKg) <= Number(profile.targetWeightKg)
    ) {
      return {
        currentGoal: GoalType.FAT_LOSS,
        suggestedGoal: GoalType.HEALTH,
        reason: '恭喜！你已达到目标体重，建议切换到"保持健康"模式',
        suggestedCalories: inferred?.estimatedTDEE,
      };
    }

    // 长期停滞（进展缓慢）— V5: 'behind' 映射为 plateau 或 fluctuating
    if (
      (inferred?.goalProgress?.trend === 'plateau' ||
        inferred?.goalProgress?.trend === 'fluctuating') &&
      inferred?.goalProgress?.estimatedWeeksLeft &&
      inferred.goalProgress.estimatedWeeksLeft > 20
    ) {
      return {
        currentGoal: profile.goal,
        suggestedGoal: profile.goal,
        suggestedSpeed: GoalSpeed.RELAXED,
        reason: '进度有些慢，建议调整到"佛系"节奏，长期坚持更重要',
      };
    }

    // muscle_gain 达成
    if (
      profile.goal === GoalType.MUSCLE_GAIN &&
      profile.targetWeightKg &&
      Number(profile.weightKg) >= Number(profile.targetWeightKg)
    ) {
      return {
        currentGoal: GoalType.MUSCLE_GAIN,
        suggestedGoal: GoalType.HEALTH,
        reason: '你已达到目标体重，建议切换到"保持健康"模式来巩固成果',
        suggestedCalories: inferred?.estimatedTDEE,
      };
    }

    return null;
  }
}
