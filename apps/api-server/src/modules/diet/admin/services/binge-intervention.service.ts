/**
 * V6.5 Phase 3J: 暴食干预效果追踪服务
 *
 * 职责：
 * - 记录暴食干预事件（当 proactiveCheck 返回 binge_risk 时）
 * - 异步评估干预效果（干预后 3h 内的卡路里摄入 vs 预期）
 * - 提供 Admin 级效果统计（有效率、趋势、分时段分析）
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';

/** 单次干预记录 */
export interface InterventionRecord {
  id: string;
  userId: string;
  triggerHour: number;
  message: string;
  preCalories: number | null;
  postCalories: number | null;
  effective: boolean | null;
  hadPostRecord: boolean | null;
  evaluatedAt: string | null;
  createdAt: string;
}

/** 干预效果统计 */
export interface InterventionEffectivenessStats {
  /** 统计窗口天数 */
  windowDays: number;
  /** 总干预次数 */
  totalInterventions: number;
  /** 已评估次数 */
  evaluatedCount: number;
  /** 有效次数 */
  effectiveCount: number;
  /** 有效率 (0-1) */
  effectiveRate: number;
  /** 干预后有记录的比例 */
  postRecordRate: number;
  /** 平均卡路里削减（pre - post, 仅有效干预） */
  avgCalorieReduction: number | null;
  /** 分时段统计 */
  hourlyBreakdown: HourlyInterventionStat[];
  /** 活跃干预用户数 */
  activeUserCount: number;
}

/** 分时段干预统计 */
export interface HourlyInterventionStat {
  hour: number;
  count: number;
  effectiveCount: number;
  effectiveRate: number;
}

/** 用户干预历史概览 */
export interface UserInterventionOverview {
  userId: string;
  totalInterventions: number;
  effectiveCount: number;
  effectiveRate: number;
  recentInterventions: InterventionRecord[];
}

@Injectable()
export class BingeInterventionService {
  private readonly logger = new Logger(BingeInterventionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── 写入干预记录 ───

  /**
   * 记录一次暴食干预事件
   * 由 BehaviorService.proactiveCheck() 触发
   */
  async recordIntervention(
    userId: string,
    triggerHour: number,
    message: string,
  ): Promise<string> {
    // 计算干预前 2h 的卡路里（从 food_records 查询）
    const preCalories = await this.getRecentCalories(userId, 2);

    const record = await this.prisma.bingeInterventionLogs.create({
      data: {
        userId: userId,
        triggerHour: triggerHour,
        message,
        preCalories: preCalories,
      },
    });

    this.logger.log(
      `Binge intervention recorded: user=${userId}, hour=${triggerHour}, preCalories=${preCalories}`,
    );

    return record.id;
  }

  // ─── 效果评估 ───

  /**
   * 评估未评估的干预效果
   * 由定时任务调用（建议每 3h 执行一次）
   *
   * 逻辑：创建时间 >= 3h 前 且尚未评估的记录 → 查询干预后 3h 的卡路里摄入
   * effective = post_calories <= pre_calories * 1.1 (即摄入未超过干预前的 110%)
   */
  async evaluatePendingInterventions(): Promise<number> {
    const threeHoursAgo = new Date();
    threeHoursAgo.setHours(threeHoursAgo.getHours() - 3);

    const pendingRecords = await this.prisma.bingeInterventionLogs.findMany({
      where: {
        evaluatedAt: null,
        createdAt: { lte: threeHoursAgo },
      },
      take: 100, // 批量限制
    });

    let evaluatedCount = 0;

    for (const record of pendingRecords) {
      try {
        const postStart = record.createdAt;
        const postEnd = new Date(
          record.createdAt.getTime() + 3 * 60 * 60 * 1000,
        );

        // 查询干预后 3h 内的 food_records 卡路里
        const postRecords = await this.prisma.foodRecords.findMany({
          where: {
            userId: record.userId,
            createdAt: { gte: postStart, lte: postEnd },
          },
          select: { totalCalories: true },
        });

        const postCalories = postRecords.reduce(
          (sum, r) => sum + (Number(r.totalCalories) || 0),
          0,
        );
        const hadPostRecord = postRecords.length > 0;

        // 有效判定：干预后 3h 摄入 <= 干预前 2h 摄入 * 1.1
        // 若无干预前数据，仅看干预后是否有记录
        const preCalories = Number(record.preCalories) || 0;
        let effective: boolean;
        if (preCalories > 0) {
          effective = postCalories <= preCalories * 1.1;
        } else {
          // 无前置数据时，干预后 3h 摄入 < 300kcal 视为有效
          effective = postCalories < 300;
        }

        await this.prisma.bingeInterventionLogs.update({
          where: { id: record.id },
          data: {
            postCalories: postCalories,
            effective,
            hadPostRecord: hadPostRecord,
            evaluatedAt: new Date(),
          },
        });

        evaluatedCount++;
      } catch (err) {
        this.logger.warn(
          `Failed to evaluate intervention ${record.id}: ${err}`,
        );
      }
    }

    if (evaluatedCount > 0) {
      this.logger.log(
        `Evaluated ${evaluatedCount}/${pendingRecords.length} binge interventions`,
      );
    }

    return evaluatedCount;
  }

  // ─── Admin 查询 ───

  /**
   * 获取全局干预效果统计
   */
  async getEffectivenessStats(
    days = 30,
  ): Promise<InterventionEffectivenessStats> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const allRecords = await this.prisma.bingeInterventionLogs.findMany({
      where: { createdAt: { gte: since } },
      select: {
        userId: true,
        triggerHour: true,
        preCalories: true,
        postCalories: true,
        effective: true,
        hadPostRecord: true,
        evaluatedAt: true,
      },
    });

    const totalInterventions = allRecords.length;
    const evaluated = allRecords.filter((r) => r.evaluatedAt !== null);
    const evaluatedCount = evaluated.length;
    const effectiveRecords = evaluated.filter((r) => r.effective === true);
    const effectiveCount = effectiveRecords.length;
    const effectiveRate =
      evaluatedCount > 0 ? effectiveCount / evaluatedCount : 0;

    const withPostRecord = evaluated.filter(
      (r) => r.hadPostRecord === true,
    ).length;
    const postRecordRate =
      evaluatedCount > 0 ? withPostRecord / evaluatedCount : 0;

    // 平均卡路里削减
    const reductionValues = effectiveRecords
      .filter((r) => r.preCalories != null && r.postCalories != null)
      .map((r) => Number(r.preCalories) - Number(r.postCalories));
    const avgCalorieReduction =
      reductionValues.length > 0
        ? reductionValues.reduce((a, b) => a + b, 0) / reductionValues.length
        : null;

    // 分时段统计
    const hourMap = new Map<
      number,
      { count: number; effectiveCount: number }
    >();
    for (const r of allRecords) {
      const stat = hourMap.get(r.triggerHour) || {
        count: 0,
        effectiveCount: 0,
      };
      stat.count++;
      if (r.effective === true) stat.effectiveCount++;
      hourMap.set(r.triggerHour, stat);
    }

    const hourlyBreakdown: HourlyInterventionStat[] = Array.from(
      hourMap.entries(),
    )
      .map(([hour, stat]) => ({
        hour,
        count: stat.count,
        effectiveCount: stat.effectiveCount,
        effectiveRate:
          stat.count > 0 ? round4(stat.effectiveCount / stat.count) : 0,
      }))
      .sort((a, b) => a.hour - b.hour);

    // 活跃用户数
    const activeUserCount = new Set(allRecords.map((r) => r.userId)).size;

    return {
      windowDays: days,
      totalInterventions,
      evaluatedCount,
      effectiveCount,
      effectiveRate: round4(effectiveRate),
      postRecordRate: round4(postRecordRate),
      avgCalorieReduction:
        avgCalorieReduction != null ? round4(avgCalorieReduction) : null,
      hourlyBreakdown,
      activeUserCount,
    };
  }

  /**
   * 获取指定用户的干预历史
   */
  async getUserInterventionOverview(
    userId: string,
    days = 30,
  ): Promise<UserInterventionOverview> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const records = await this.prisma.bingeInterventionLogs.findMany({
      where: {
        userId: userId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const evaluated = records.filter((r) => r.evaluatedAt !== null);
    const effectiveCount = evaluated.filter((r) => r.effective === true).length;
    const effectiveRate =
      evaluated.length > 0 ? effectiveCount / evaluated.length : 0;

    return {
      userId,
      totalInterventions: records.length,
      effectiveCount,
      effectiveRate: round4(effectiveRate),
      recentInterventions: records.map((r) => ({
        id: r.id,
        userId: r.userId,
        triggerHour: r.triggerHour,
        message: r.message,
        preCalories: r.preCalories != null ? Number(r.preCalories) : null,
        postCalories: r.postCalories != null ? Number(r.postCalories) : null,
        effective: r.effective,
        hadPostRecord: r.hadPostRecord,
        evaluatedAt: r.evaluatedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // ─── 内部工具方法 ───

  /**
   * 获取用户最近 N 小时的食物记录卡路里总计
   */
  private async getRecentCalories(
    userId: string,
    hours: number,
  ): Promise<number> {
    const since = new Date();
    since.setHours(since.getHours() - hours);

    const records = await this.prisma.foodRecords.findMany({
      where: {
        userId: userId,
        createdAt: { gte: since },
      },
      select: { totalCalories: true },
    });

    return records.reduce((sum, r) => sum + (Number(r.totalCalories) || 0), 0);
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
