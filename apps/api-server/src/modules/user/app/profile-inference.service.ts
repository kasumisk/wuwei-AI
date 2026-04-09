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

    // 用户分段
    inferred.userSegment = this.inferUserSegment(profile, behavior);
    inferred.confidenceScores = {
      ...inferred.confidenceScores,
      userSegment: behavior && behavior.totalRecords >= 14 ? 0.7 : 0.4,
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
    if (profile.targetWeightKg && profile.weightKg) {
      const startWeight =
        inferred.goalProgress?.startWeight || Number(profile.weightKg);
      const currentWeight = Number(profile.weightKg);
      const targetWeight = Number(profile.targetWeightKg);
      const totalDelta = Math.abs(startWeight - targetWeight);
      const currentDelta = Math.abs(startWeight - currentWeight);
      const progressPercent =
        totalDelta > 0
          ? Math.round((currentDelta / totalDelta) * 1000) / 10
          : 0;

      inferred.goalProgress = {
        startWeight: inferred.goalProgress?.startWeight || startWeight,
        currentWeight,
        progressPercent: Math.min(100, progressPercent),
        estimatedWeeksLeft: inferred.goalProgress?.estimatedWeeksLeft,
        trend:
          progressPercent >= 100
            ? 'ahead'
            : progressPercent > 0
              ? 'on_track'
              : 'behind',
      };
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

    // 长期停滞（进展缓慢）
    if (
      inferred?.goalProgress?.trend === 'behind' &&
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

  /**
   * 推断用户分段
   */
  private inferUserSegment(
    profile: UserProfile,
    behavior: UserBehaviorProfile | null,
  ): string {
    const complianceRate = Number(behavior?.avgComplianceRate ?? 0);
    const goal = profile.goal;

    if (goal === GoalType.MUSCLE_GAIN) return 'muscle_builder';

    if (complianceRate >= 0.7) {
      return goal === GoalType.FAT_LOSS
        ? 'disciplined_loser'
        : 'active_maintainer';
    }

    if (complianceRate < 0.4 && behavior && behavior.totalRecords >= 14) {
      return 'binge_risk';
    }

    return 'casual_maintainer';
  }
}
