/**
 * V7.0 Phase 2-A: GoalTrackerService — 目标进度追踪服务
 *
 * 基于 14 天行为数据计算目标达成度：
 * 1. calorieCompliance  — 热量达成率（14天均值 actual/goal）
 * 2. proteinCompliance  — 蛋白质达成率（14天均值）
 * 3. executionRate      — 推荐执行率（14天，复用 recommendation_executions）
 * 4. streakDays         — 连续健康天数（来自 user_behavior_profiles）
 * 5. phaseRemainingDays — 当前阶段剩余天数（如有 CompoundGoal.phases）
 * 6. phaseProgress      — 阶段进度百分比 (0-1)
 *
 * 数据源：daily_summaries + user_behavior_profiles + goal_phases + user_profiles.compound_goal
 * 缓存：Redis 4h TTL
 *
 * 依赖：PrismaService, RedisCacheService
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import { GoalPhase, GoalType, CompoundGoal } from '../../../user.types';

// ─── 常量 ───

/** 进度缓存 TTL: 4 小时 */
const PROGRESS_TTL_MS = 4 * 60 * 60 * 1000;

/** 计算达成率的窗口: 14 天 */
const COMPLIANCE_WINDOW_DAYS = 14;

/** 阶段转换建议的最低执行率阈值（低于此值不建议前进） */
const MIN_EXECUTION_RATE_FOR_ADVANCE = 0.6;

/** 热量达成率合格阈值（用于阶段转换判断） */
const CALORIE_COMPLIANCE_THRESHOLD = 0.75;

/** 蛋白质达成率合格阈值 */
const PROTEIN_COMPLIANCE_THRESHOLD = 0.7;

// ─── 接口 ───

/**
 * 目标进度快照
 */
export interface GoalProgress {
  /** 热量达成率（14天均值，actual/goal，理想值 ≈ 1.0） */
  calorieCompliance: number;
  /** 蛋白质达成率（14天均值） */
  proteinCompliance: number;
  /** 推荐执行率（14天均值，0-1） */
  executionRate: number;
  /** 连续健康天数 */
  streakDays: number;
  /** 当前阶段剩余天数（仅 CompoundGoal 有阶段时存在） */
  phaseRemainingDays?: number;
  /** 阶段进度百分比 0-1（仅有阶段时存在） */
  phaseProgress?: number;
}

/**
 * 阶段转换建议
 */
export interface PhaseTransitionSuggestion {
  /** 建议原因（中文描述） */
  reason: string;
  /** 建议的下一阶段 */
  suggestedPhase: GoalPhase;
  /** 置信度 (0-1) */
  confidence: number;
}

@Injectable()
export class GoalTrackerService {
  private readonly logger = new Logger(GoalTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  // ─── 公共方法 ───

  /**
   * 获取用户当前目标进度
   *
   * 优先从 Redis 读取缓存；缓存 miss 时计算并写入。
   */
  async getProgress(userId: string): Promise<GoalProgress> {
    const key = `goal_tracker:progress:${userId}`;
    const cached = await this.redis.get<GoalProgress>(key);
    if (cached) {
      return cached;
    }

    const progress = await this.computeProgress(userId);
    await this.redis.set(key, progress, PROGRESS_TTL_MS);
    return progress;
  }

  /**
   * 检查是否建议切换阶段（每日预计算调用）
   *
   * 条件：
   * 1. 用户有 CompoundGoal 且有 phases
   * 2. 当前阶段已到期 或 达成率足够好可提前进入下一阶段
   * 3. 存在下一阶段
   *
   * @returns 建议，或 null（不需要切换）
   */
  async checkPhaseTransition(
    userId: string,
  ): Promise<PhaseTransitionSuggestion | null> {
    try {
      const compoundGoal = await this.getUserCompoundGoal(userId);
      if (!compoundGoal?.phases?.length) {
        return null;
      }

      const currentIndex = compoundGoal.currentPhaseIndex ?? 0;
      const phases = compoundGoal.phases;

      // 没有下一阶段
      if (currentIndex >= phases.length - 1) {
        return null;
      }

      const currentPhase = phases[currentIndex];
      const nextPhase = phases[currentIndex + 1];

      // 计算当前阶段已经过去的天数
      const activeGoalPhase = await this.getActiveGoalPhase(userId);
      const elapsedDays = activeGoalPhase
        ? this.daysSince(activeGoalPhase.startedAt ?? new Date())
        : 0;
      const phaseDurationDays = currentPhase.durationWeeks * 7;

      // 情况 1: 阶段已到期
      if (elapsedDays >= phaseDurationDays) {
        return {
          reason: `当前阶段「${currentPhase.name}」已完成 ${currentPhase.durationWeeks} 周计划，建议进入下一阶段「${nextPhase.name}」`,
          suggestedPhase: nextPhase,
          confidence: 0.9,
        };
      }

      // 情况 2: 达成率优秀，可提前进入（至少过了 70% 的阶段时间）
      if (elapsedDays >= phaseDurationDays * 0.7) {
        const progress = await this.getProgress(userId);
        if (
          progress.calorieCompliance >= CALORIE_COMPLIANCE_THRESHOLD &&
          progress.proteinCompliance >= PROTEIN_COMPLIANCE_THRESHOLD &&
          progress.executionRate >= MIN_EXECUTION_RATE_FOR_ADVANCE
        ) {
          const confidence =
            0.6 +
            0.2 * Math.min(progress.calorieCompliance, 1.0) +
            0.2 * Math.min(progress.executionRate, 1.0);
          return {
            reason: `热量达成率 ${(progress.calorieCompliance * 100).toFixed(0)}%、蛋白质达成率 ${(progress.proteinCompliance * 100).toFixed(0)}%，表现优秀，可提前进入「${nextPhase.name}」`,
            suggestedPhase: nextPhase,
            confidence: Math.min(confidence, 0.85), // cap 低于自然到期
          };
        }
      }

      return null;
    } catch (err) {
      this.logger.warn(
        `checkPhaseTransition failed for user ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 清除用户进度缓存（外部修改目标/阶段后调用）
   */
  async invalidateProgress(userId: string): Promise<void> {
    const key = `goal_tracker:progress:${userId}`;
    await this.redis.del(key);
  }

  // ─── 私有方法 ───

  /**
   * 计算完整的目标进度快照
   */
  private async computeProgress(userId: string): Promise<GoalProgress> {
    const [
      { calorieCompliance, proteinCompliance },
      executionRate,
      behaviorProfile,
      phaseInfo,
    ] = await Promise.all([
      this.computeNutrientCompliance(userId),
      this.computeExecutionRate(userId),
      this.getBehaviorProfile(userId),
      this.computePhaseInfo(userId),
    ]);

    const progress: GoalProgress = {
      calorieCompliance,
      proteinCompliance,
      executionRate,
      streakDays: behaviorProfile?.streakDays ?? 0,
    };

    if (phaseInfo) {
      progress.phaseRemainingDays = phaseInfo.remainingDays;
      progress.phaseProgress = phaseInfo.progress;
    }

    return progress;
  }

  /**
   * 从 daily_summaries 计算 14 天热量/蛋白质达成率
   *
   * 达成率 = avg(actual / goal)，goal 为 0 或无记录时该天跳过。
   * 无有效天数时返回 0。
   */
  private async computeNutrientCompliance(
    userId: string,
  ): Promise<{ calorieCompliance: number; proteinCompliance: number }> {
    const since = new Date(Date.now() - COMPLIANCE_WINDOW_DAYS * 86400000);

    try {
      const summaries = await this.prisma.dailySummaries.findMany({
        where: {
          userId: userId,
          date: { gte: since },
        },
        select: {
          totalCalories: true,
          calorieGoal: true,
          totalProtein: true,
          proteinGoal: true,
        },
        orderBy: { date: 'desc' },
      });

      if (summaries.length === 0) {
        return { calorieCompliance: 0, proteinCompliance: 0 };
      }

      let calorieSum = 0;
      let calorieDays = 0;
      let proteinSum = 0;
      let proteinDays = 0;

      for (const s of summaries) {
        // 热量达成率
        if (s.calorieGoal && s.calorieGoal > 0) {
          const ratio = s.totalCalories / s.calorieGoal;
          // cap 到 [0, 2] 防止极端值污染均值
          calorieSum += Math.min(ratio, 2.0);
          calorieDays++;
        }

        // 蛋白质达成率
        const proteinGoal = Number(s.proteinGoal);
        const totalProtein = Number(s.totalProtein);
        if (proteinGoal > 0) {
          const ratio = totalProtein / proteinGoal;
          proteinSum += Math.min(ratio, 2.0);
          proteinDays++;
        }
      }

      return {
        calorieCompliance: calorieDays > 0 ? calorieSum / calorieDays : 0,
        proteinCompliance: proteinDays > 0 ? proteinSum / proteinDays : 0,
      };
    } catch (err) {
      this.logger.warn(
        `computeNutrientCompliance failed for user ${userId}: ${(err as Error).message}`,
      );
      return { calorieCompliance: 0, proteinCompliance: 0 };
    }
  }

  /**
   * 从 recommendation_executions 计算 14 天平均执行率
   *
   * 逻辑与 ExecutionTrackerService.getUserExecutionRate 一致，
   * 但不复用那个服务（避免循环依赖 + 那个有 1h 缓存而我们需 4h 独立缓存）。
   */
  private async computeExecutionRate(userId: string): Promise<number> {
    const since = new Date(Date.now() - COMPLIANCE_WINDOW_DAYS * 86400000);

    try {
      const result = await this.prisma.recommendationExecutions.aggregate({
        where: {
          userId: userId,
          executionRate: { not: null },
          createdAt: { gte: since },
        },
        _avg: { executionRate: true },
      });

      return result._avg.executionRate ?? 0;
    } catch (err) {
      this.logger.warn(
        `computeExecutionRate failed for user ${userId}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * 获取 user_behavior_profiles（连续天数等）
   */
  private async getBehaviorProfile(userId: string) {
    try {
      return await this.prisma.userBehaviorProfiles.findUnique({
        where: { userId: userId },
        select: {
          streakDays: true,
          longestStreak: true,
          avgComplianceRate: true,
        },
      });
    } catch (err) {
      this.logger.warn(
        `getBehaviorProfile failed for user ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 计算阶段进度（如果用户有 CompoundGoal.phases）
   */
  private async computePhaseInfo(
    userId: string,
  ): Promise<{ remainingDays: number; progress: number } | null> {
    const activePhase = await this.getActiveGoalPhase(userId);
    if (!activePhase?.startedAt) {
      return null;
    }

    // 从 CompoundGoal 获取阶段定义以拿到 durationWeeks
    const compoundGoal = await this.getUserCompoundGoal(userId);
    if (!compoundGoal?.phases?.length) {
      return null;
    }

    const currentIndex = compoundGoal.currentPhaseIndex ?? 0;
    const currentPhase = compoundGoal.phases[currentIndex];
    if (!currentPhase) {
      return null;
    }

    const phaseDurationDays = currentPhase.durationWeeks * 7;
    const elapsedDays = this.daysSince(activePhase.startedAt);
    const remainingDays = Math.max(phaseDurationDays - elapsedDays, 0);
    const progress =
      phaseDurationDays > 0
        ? Math.min(elapsedDays / phaseDurationDays, 1.0)
        : 0;

    return { remainingDays, progress };
  }

  /**
   * 从 goal_phases 表获取当前活跃阶段记录
   */
  private async getActiveGoalPhase(userId: string) {
    try {
      return await this.prisma.goalPhases.findFirst({
        where: {
          userId: userId,
          isActive: true,
        },
        orderBy: { phaseOrder: 'asc' },
      });
    } catch (err) {
      this.logger.warn(
        `getActiveGoalPhase failed for user ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 从 user_profiles.compound_goal JSON 字段获取复合目标
   */
  private async getUserCompoundGoal(
    userId: string,
  ): Promise<CompoundGoal | null> {
    try {
      const profile = await this.prisma.userProfiles.findUnique({
        where: { userId: userId },
        select: { compoundGoal: true },
      });

      if (!profile?.compoundGoal) {
        return null;
      }

      // compound_goal 是 Json 类型，需要类型断言
      return profile.compoundGoal as unknown as CompoundGoal;
    } catch (err) {
      this.logger.warn(
        `getUserCompoundGoal failed for user ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 计算从某个时间点到现在经过的天数
   */
  private daysSince(date: Date): number {
    const ms = Date.now() - new Date(date).getTime();
    return Math.floor(ms / 86400000);
  }
}
