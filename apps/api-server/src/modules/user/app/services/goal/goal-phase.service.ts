/**
 * V7.0 Phase 2-B: GoalPhaseService — 分阶段目标管理服务
 *
 * 管理 CompoundGoal 的生命周期：
 * 1. getCurrentGoal()         — 获取当前有效目标（CompoundGoal 或回退到简单 GoalType）
 * 2. getPhaseWeightAdjustment() — 根据阶段类型计算评分维度权重调整
 * 3. setCompoundGoal()        — 设置复合目标（创建/更新 + 写入 goal_phases 表）
 * 4. advancePhase()           — 手动推进到下一阶段
 *
 * 存储:
 * - user_profiles.compound_goal (JSONB)  — 复合目标定义
 * - goal_phases 表                       — 各阶段的激活/完成时间追踪
 *
 * 依赖: PrismaService, RedisCacheService, GoalTrackerService（阶段推进时清缓存）
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import { GoalPhase, GoalType, CompoundGoal } from '../../../user.types';
import { GoalTrackerService } from './goal-tracker.service';
import { ScoreDimension } from '../../../../diet/app/recommendation/types/recommendation.types';

// ─── 常量 ───

/** 有效目标缓存 TTL: 2 小时 */
const EFFECTIVE_GOAL_TTL_MS = 2 * 60 * 60 * 1000;

/** 辅目标权重上限 */
const MAX_SECONDARY_WEIGHT = 0.3;

/** 默认辅目标权重 */
const DEFAULT_SECONDARY_WEIGHT = 0.15;

/**
 * 目标类型 → 评分维度权重调整映射
 *
 * 当阶段目标类型与主目标不同时，按此表调整部分维度的权重。
 * 值 > 1 表示增强，< 1 表示抑制。只列出需要调整的维度。
 */
const GOAL_TYPE_WEIGHT_ADJUSTMENTS: Record<
  GoalType,
  Partial<Record<ScoreDimension, number>>
> = {
  [GoalType.FAT_LOSS]: {
    calories: 1.3,
    satiety: 1.2,
    glycemic: 1.15,
    fat: 1.1,
    protein: 1.05,
  },
  [GoalType.MUSCLE_GAIN]: {
    protein: 1.35,
    calories: 0.9, // 增肌不需要严格控制热量
    satiety: 0.85,
  },
  [GoalType.HEALTH]: {
    quality: 1.25,
    nutrientDensity: 1.2,
    inflammation: 1.15,
    fiber: 1.1,
  },
  [GoalType.HABIT]: {
    executability: 1.3,
    popularity: 1.2,
    satiety: 1.1,
  },
};

// ─── 接口 ───

/**
 * 有效目标 — 合并 CompoundGoal + 当前阶段 + 辅目标后的最终生效目标
 */
export interface EffectiveGoal {
  /** 最终生效的目标类型（阶段覆盖 > 主目标） */
  goalType: GoalType;
  /** 复合目标配置（如有） */
  compound?: CompoundGoal;
  /** 当前阶段（如有） */
  currentPhase?: GoalPhase;
  /** 辅目标权重混合后的权重调整 */
  weightAdjustment?: Partial<Record<ScoreDimension, number>>;
}

@Injectable()
export class GoalPhaseService {
  private readonly logger = new Logger(GoalPhaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly goalTracker: GoalTrackerService,
  ) {}

  // ─── 公共方法 ───

  /**
   * 获取用户当前有效目标
   *
   * 解析优先级:
   * 1. CompoundGoal + 当前阶段 → 阶段的 goalType
   * 2. CompoundGoal 无阶段 → primary goalType
   * 3. 无 CompoundGoal → 回退到 user_profiles.goal（简单 GoalType）
   */
  async getCurrentGoal(userId: string): Promise<EffectiveGoal> {
    const key = `goal_phase:effective:${userId}`;
    const cached = await this.redis.get<EffectiveGoal>(key);
    if (cached) {
      return cached;
    }

    const effectiveGoal = await this.resolveEffectiveGoal(userId);
    await this.redis.set(key, effectiveGoal, EFFECTIVE_GOAL_TTL_MS);
    return effectiveGoal;
  }

  /**
   * 获取指定阶段的权重调整
   *
   * 根据阶段的 goalType 查表返回维度权重调整。
   * 用于 computeWeights() 中叠加阶段权重。
   */
  getPhaseWeightAdjustment(
    phase: GoalPhase,
  ): Partial<Record<ScoreDimension, number>> {
    return GOAL_TYPE_WEIGHT_ADJUSTMENTS[phase.goalType] ?? {};
  }

  /**
   * 设置复合目标
   *
   * 1. 更新 user_profiles.compound_goal JSONB 字段
   * 2. 同步写入 goal_phases 表（旧阶段标记完成，新阶段写入）
   * 3. 激活第一个阶段（如有 phases）
   * 4. 清除相关缓存
   */
  async setCompoundGoal(userId: string, goal: CompoundGoal): Promise<void> {
    // 规范化: 确保 currentPhaseIndex 有默认值
    const normalized: CompoundGoal = {
      ...goal,
      currentPhaseIndex: goal.currentPhaseIndex ?? 0,
      startDate: goal.startDate ?? new Date().toISOString().slice(0, 10),
      secondaryWeight: goal.secondary
        ? Math.min(
            goal.secondaryWeight ?? DEFAULT_SECONDARY_WEIGHT,
            MAX_SECONDARY_WEIGHT,
          )
        : undefined,
    };

    await this.prisma.$transaction(async (tx) => {
      // 1. 更新 user_profiles.compound_goal
      await tx.user_profiles.update({
        where: { user_id: userId },
        data: {
          compound_goal: normalized as object,
          goal: normalized.primary, // 同步更新简单目标字段（保持向后兼容）
          updated_at: new Date(),
        },
      });

      // 2. 将旧的活跃阶段标记为完成
      await tx.goal_phases.updateMany({
        where: { user_id: userId, is_active: true },
        data: {
          is_active: false,
          completed_at: new Date(),
          updated_at: new Date(),
        },
      });

      // 3. 写入新阶段（如有）
      if (normalized.phases?.length) {
        // 先删除该用户旧的阶段定义
        await tx.goal_phases.deleteMany({
          where: { user_id: userId },
        });

        // 批量创建新阶段
        await tx.goal_phases.createMany({
          data: normalized.phases.map((phase, index) => ({
            user_id: userId,
            goal_type: phase.goalType,
            name: phase.name,
            duration_weeks: phase.durationWeeks,
            calorie_multiplier: phase.calorieMultiplier,
            macro_ratio_override: phase.macroRatioOverride
              ? (phase.macroRatioOverride as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            phase_order: phase.order,
            is_active: index === (normalized.currentPhaseIndex ?? 0),
            started_at:
              index === (normalized.currentPhaseIndex ?? 0) ? new Date() : null,
          })),
        });
      }
    });

    // 4. 清除缓存
    await this.invalidateGoalCaches(userId);

    this.logger.log(
      `CompoundGoal set for user ${userId}: primary=${normalized.primary}` +
        (normalized.secondary ? `, secondary=${normalized.secondary}` : '') +
        (normalized.phases?.length
          ? `, phases=${normalized.phases.length}`
          : ''),
    );
  }

  /**
   * 手动推进到下一阶段
   *
   * 操作:
   * 1. 当前阶段标记完成
   * 2. 下一阶段标记激活
   * 3. 更新 compound_goal.currentPhaseIndex
   * 4. 清除缓存
   *
   * @returns 新激活的阶段，或 null（已是最后一个阶段）
   */
  async advancePhase(userId: string): Promise<GoalPhase | null> {
    const profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
      select: { compound_goal: true },
    });

    if (!profile?.compound_goal) {
      this.logger.warn(`advancePhase: user ${userId} has no compound goal`);
      return null;
    }

    const compound = profile.compound_goal as unknown as CompoundGoal;
    if (!compound.phases?.length) {
      this.logger.warn(`advancePhase: user ${userId} has no phases`);
      return null;
    }

    const currentIndex = compound.currentPhaseIndex ?? 0;
    const nextIndex = currentIndex + 1;

    if (nextIndex >= compound.phases.length) {
      this.logger.log(
        `advancePhase: user ${userId} already at last phase (${currentIndex})`,
      );
      return null;
    }

    const nextPhase = compound.phases[nextIndex];
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // 1. 完成当前阶段
      await tx.goal_phases.updateMany({
        where: {
          user_id: userId,
          is_active: true,
        },
        data: {
          is_active: false,
          completed_at: now,
          updated_at: now,
        },
      });

      // 2. 激活下一阶段
      await tx.goal_phases.updateMany({
        where: {
          user_id: userId,
          phase_order: nextPhase.order,
        },
        data: {
          is_active: true,
          started_at: now,
          updated_at: now,
        },
      });

      // 3. 更新 compound_goal.currentPhaseIndex
      const updatedCompound: CompoundGoal = {
        ...compound,
        currentPhaseIndex: nextIndex,
      };
      await tx.user_profiles.update({
        where: { user_id: userId },
        data: {
          compound_goal: updatedCompound as object,
          goal: nextPhase.goalType, // 同步简单目标字段
          updated_at: now,
        },
      });
    });

    // 4. 清除缓存
    await this.invalidateGoalCaches(userId);

    this.logger.log(
      `Phase advanced for user ${userId}: ${currentIndex} → ${nextIndex} (${nextPhase.name})`,
    );

    return nextPhase;
  }

  // ─── 私有方法 ───

  /**
   * 解析有效目标
   */
  private async resolveEffectiveGoal(userId: string): Promise<EffectiveGoal> {
    const profile = await this.prisma.user_profiles.findUnique({
      where: { user_id: userId },
      select: {
        goal: true,
        compound_goal: true,
      },
    });

    if (!profile) {
      return { goalType: GoalType.HEALTH }; // 默认回退
    }

    const compound = profile.compound_goal
      ? (profile.compound_goal as unknown as CompoundGoal)
      : null;

    // 无复合目标 → 使用简单目标
    if (!compound) {
      const goalType = this.parseGoalType(profile.goal);
      return { goalType };
    }

    // 有复合目标
    const currentIndex = compound.currentPhaseIndex ?? 0;
    const currentPhase = compound.phases?.[currentIndex];

    // 确定最终 goalType: 阶段 > 主目标
    const goalType = currentPhase?.goalType ?? compound.primary;

    // 计算权重调整（阶段权重 + 辅目标混合）
    const weightAdjustment = this.computeMergedWeightAdjustment(
      compound,
      currentPhase,
    );

    return {
      goalType,
      compound,
      currentPhase: currentPhase ?? undefined,
      weightAdjustment:
        Object.keys(weightAdjustment).length > 0 ? weightAdjustment : undefined,
    };
  }

  /**
   * 合并阶段权重调整 + 辅目标权重调整
   *
   * 混合逻辑:
   * - 主权重 = 阶段的 goalType 对应的权重调整
   * - 辅权重 = secondary goalType 的权重调整 × secondaryWeight
   * - 最终 = 主权重 × (1 - secondaryWeight) + 辅权重
   */
  private computeMergedWeightAdjustment(
    compound: CompoundGoal,
    currentPhase?: GoalPhase,
  ): Partial<Record<ScoreDimension, number>> {
    const phaseGoalType = currentPhase?.goalType ?? compound.primary;
    const primaryAdj = GOAL_TYPE_WEIGHT_ADJUSTMENTS[phaseGoalType] ?? {};

    // 无辅目标 → 直接返回主调整
    if (!compound.secondary) {
      return primaryAdj;
    }

    const secondaryWeight = Math.min(
      compound.secondaryWeight ?? DEFAULT_SECONDARY_WEIGHT,
      MAX_SECONDARY_WEIGHT,
    );
    const primaryWeight = 1 - secondaryWeight;
    const secondaryAdj = GOAL_TYPE_WEIGHT_ADJUSTMENTS[compound.secondary] ?? {};

    // 收集所有涉及的维度
    const allDimensions = new Set<ScoreDimension>([
      ...(Object.keys(primaryAdj) as ScoreDimension[]),
      ...(Object.keys(secondaryAdj) as ScoreDimension[]),
    ]);

    const merged: Partial<Record<ScoreDimension, number>> = {};
    for (const dim of allDimensions) {
      const pVal = primaryAdj[dim] ?? 1.0; // 无调整 = 1.0（不变）
      const sVal = secondaryAdj[dim] ?? 1.0;
      merged[dim] = pVal * primaryWeight + sVal * secondaryWeight;
    }

    return merged;
  }

  /**
   * 将 string 解析为 GoalType 枚举（兜底 HEALTH）
   */
  private parseGoalType(goal: string): GoalType {
    const normalized = goal?.toLowerCase();
    if (Object.values(GoalType).includes(normalized as GoalType)) {
      return normalized as GoalType;
    }
    return GoalType.HEALTH;
  }

  /**
   * 清除目标相关缓存
   */
  private async invalidateGoalCaches(userId: string): Promise<void> {
    await Promise.all([
      this.redis.del(`goal_phase:effective:${userId}`),
      this.goalTracker.invalidateProgress(userId),
    ]);
  }
}
