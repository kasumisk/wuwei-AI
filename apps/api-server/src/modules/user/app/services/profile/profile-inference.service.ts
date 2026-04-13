import { Injectable, Logger } from '@nestjs/common';
import { GoalType, GoalSpeed } from '../../../user.types';
import {
  user_inferred_profiles as UserInferredProfile,
  user_behavior_profiles as UserBehaviorProfile,
} from '@prisma/client';
import { inferUserSegment } from '../segmentation.util';
import { PrismaService } from '../../../../../core/prisma/prisma.service';

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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取推断数据
   */
  async getInferred(userId: string): Promise<UserInferredProfile | null> {
    return this.prisma.user_inferred_profiles.findUnique({
      where: { user_id: userId },
    }) as any;
  }

  /**
   * 刷新推断数据（手动触发）
   */
  async refreshInference(userId: string): Promise<UserInferredProfile | null> {
    const profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });
    if (!profile) return null;

    const behavior = await this.prisma.user_behavior_profiles.findUnique({
      where: { user_id: userId },
    });
    let inferred = await this.prisma.user_inferred_profiles.findUnique({
      where: { user_id: userId },
    });

    // 用户分段 — 统一使用 segmentation.util (V4 A4, V5 3.4 升级)
    const segBehavior:
      | import('../segmentation.util').SegmentBehaviorInput
      | null = behavior
      ? {
          avgComplianceRate:
            behavior.avg_compliance_rate != null
              ? Number(behavior.avg_compliance_rate)
              : undefined,
          totalRecords: behavior.total_records ?? 0,
          // refreshInference 为手动触发，无法精确算 daysSinceLastRecord/usageDays
          // 此处留空，cron 会在批量更新时填充精确值
        }
      : null;
    const segResult = inferUserSegment(profile.goal as GoalType, segBehavior);

    const confidenceScores = {
      ...((inferred?.confidence_scores as any) || {}),
      userSegment: segResult.confidence,
    };

    // 最优餐次推断（基于行为数据）
    let optimalMealCount = inferred?.optimal_meal_count ?? null;
    if (behavior?.meal_timing_patterns) {
      const timingCount = Object.keys(
        behavior.meal_timing_patterns as any,
      ).filter((k) => (behavior.meal_timing_patterns as any)[k]).length;
      if (timingCount > 0) {
        optimalMealCount = timingCount;
        confidenceScores.optimalMealCount = Math.min(
          0.9,
          0.5 + (behavior.total_records ?? 0) * 0.01,
        );
      }
    }

    // 目标进展
    // V5 3.1: goalProgress 现在主要由 profile-cron.service 基于 weight_history 计算
    // 此处仅做简易回退：当 cron 尚未计算（无 weight_history 数据）时，基于 profile 体重粗略估算
    let goalProgress = (inferred?.goal_progress as any) || null;
    if (profile.target_weight_kg && profile.weight_kg) {
      const startWeight =
        goalProgress?.startWeight || Number(profile.weight_kg);
      const currentWeight = Number(profile.weight_kg);
      const targetWeight = Number(profile.target_weight_kg);
      const totalDelta = startWeight - targetWeight;
      const progressPercent =
        Math.abs(totalDelta) > 0.1
          ? Math.min(
              100,
              Math.max(0, ((startWeight - currentWeight) / totalDelta) * 100),
            )
          : 0;

      // 仅在 cron 尚未填充 trend 时设置简易值
      if (!goalProgress?.trend) {
        const weightDiff = currentWeight - startWeight;
        let trend: 'losing' | 'gaining' | 'plateau' | 'fluctuating' = 'plateau';
        if (weightDiff < -0.5) trend = 'losing';
        else if (weightDiff > 0.5) trend = 'gaining';

        goalProgress = {
          ...goalProgress,
          startWeight: goalProgress?.startWeight || startWeight,
          currentWeight,
          targetWeight,
          progressPercent: Number(Math.min(100, progressPercent).toFixed(1)),
          trend,
        };
      } else {
        // cron 已计算过，仅更新 currentWeight（用户可能刚改了体重）
        goalProgress = {
          ...goalProgress,
          currentWeight,
        };
      }
    }

    const now = new Date();

    if (inferred) {
      const updated = await this.prisma.user_inferred_profiles.update({
        where: { user_id: userId },
        data: {
          user_segment: segResult.segment,
          confidence_scores: confidenceScores,
          optimal_meal_count: optimalMealCount,
          goal_progress: goalProgress,
          last_computed_at: now,
        },
      });
      return updated as any;
    } else {
      const created = await this.prisma.user_inferred_profiles.create({
        data: {
          user_id: userId,
          user_segment: segResult.segment,
          confidence_scores: confidenceScores,
          optimal_meal_count: optimalMealCount,
          goal_progress: goalProgress,
          last_computed_at: now,
        },
      });
      return created as any;
    }
  }

  /**
   * 获取目标迁移建议
   */
  async getGoalTransitionSuggestion(
    userId: string,
  ): Promise<GoalTransitionSuggestion | null> {
    const profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
    });
    if (!profile) return null;

    const inferred = await this.prisma.user_inferred_profiles.findUnique({
      where: { user_id: userId },
    });

    // fat_loss 达成
    if (
      profile.goal === GoalType.FAT_LOSS &&
      profile.target_weight_kg &&
      Number(profile.weight_kg) <= Number(profile.target_weight_kg)
    ) {
      return {
        currentGoal: GoalType.FAT_LOSS,
        suggestedGoal: GoalType.HEALTH,
        reason: '恭喜！你已达到目标体重，建议切换到"保持健康"模式',
        suggestedCalories: inferred?.estimated_tdee ?? undefined,
      };
    }

    const goalProgress = inferred?.goal_progress as any;

    // 长期停滞（进展缓慢）— V5: 'behind' 映射为 plateau 或 fluctuating
    if (
      (goalProgress?.trend === 'plateau' ||
        goalProgress?.trend === 'fluctuating') &&
      goalProgress?.estimatedWeeksLeft &&
      goalProgress.estimatedWeeksLeft > 20
    ) {
      return {
        currentGoal: profile.goal as GoalType,
        suggestedGoal: profile.goal as GoalType,
        suggestedSpeed: GoalSpeed.RELAXED,
        reason: '进度有些慢，建议调整到"佛系"节奏，长期坚持更重要',
      };
    }

    // muscle_gain 达成
    if (
      profile.goal === GoalType.MUSCLE_GAIN &&
      profile.target_weight_kg &&
      Number(profile.weight_kg) >= Number(profile.target_weight_kg)
    ) {
      return {
        currentGoal: GoalType.MUSCLE_GAIN,
        suggestedGoal: GoalType.HEALTH,
        reason: '你已达到目标体重，建议切换到"保持健康"模式来巩固成果',
        suggestedCalories: inferred?.estimated_tdee ?? undefined,
      };
    }

    return null;
  }
}
