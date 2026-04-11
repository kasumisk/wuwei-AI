/**
 * V6.3 P2-2 — 策略选择器服务
 *
 * 根据用户分群（UserSegment）自动选择并分配对应的推荐策略。
 *
 * 分群 → 策略映射:
 *   new_user                              → warm_start
 *   returning_user                        → re_engage
 *   disciplined_loser / muscle_builder    → precision
 *   casual_maintainer / active_maintainer → discovery
 *   binge_risk                            → precision（高风险用户需精准控制）
 *
 * 触发时机:
 *   - 用户分群变更时（profile-cron 每周计算）
 *   - 新用户首次推荐时（冷启动检测）
 *
 * 幂等性:
 *   - 如果用户已分配相同策略，跳过重复分配
 *   - 使用 assignment_type = 'segment' 标记自动分配
 */
import { Injectable, Logger } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { AssignmentType, StrategyStatus } from '../strategy.types';
import type { UserSegment } from '../../user/app/segmentation.util';

/** 分群 → 策略名映射表 */
const SEGMENT_STRATEGY_MAP: Record<UserSegment, string> = {
  new_user: 'warm_start',
  returning_user: 're_engage',
  disciplined_loser: 'precision',
  muscle_builder: 'precision',
  active_maintainer: 'discovery',
  casual_maintainer: 'discovery',
  binge_risk: 'precision',
};

@Injectable()
export class StrategySelectorService {
  private readonly logger = new Logger(StrategySelectorService.name);

  /** 策略名 → 策略 ID 的内存缓存（启动后首次查询填充） */
  private strategyIdCache: Map<string, string> | null = null;

  constructor(private readonly strategyService: StrategyService) {}

  /**
   * 根据用户分群选择并分配策略
   *
   * @param userId       用户 ID
   * @param userSegment  用户当前分群
   * @returns 是否执行了分配（false = 已有相同分配，跳过）
   */
  async selectAndAssign(
    userId: string,
    userSegment: UserSegment,
  ): Promise<boolean> {
    const strategyName = SEGMENT_STRATEGY_MAP[userSegment];
    if (!strategyName) {
      this.logger.warn(
        `未知用户分群 "${userSegment}"，跳过策略分配 (user=${userId})`,
      );
      return false;
    }

    // 查找策略 ID
    const strategyId = await this.resolveStrategyId(strategyName);
    if (!strategyId) {
      this.logger.warn(
        `策略 "${strategyName}" 不存在，跳过分配 (user=${userId}, segment=${userSegment})`,
      );
      return false;
    }

    // 检查当前是否已有 segment 类型的分配
    const existing = await this.strategyService.getUserAssignment(userId);
    if (existing) {
      // raw SQL 返回 snake_case 字段
      const existingStrategyId = existing.strategy_id ?? existing.strategyId;
      const existingType = existing.assignment_type ?? existing.assignmentType;
      if (
        existingStrategyId === strategyId &&
        existingType === AssignmentType.SEGMENT
      ) {
        // 已分配相同策略，跳过
        return false;
      }
    }

    // 分配策略
    await this.strategyService.assignToUser({
      userId,
      strategyId,
      assignmentType: AssignmentType.SEGMENT,
      source: `auto:segment:${userSegment}`,
    });

    this.logger.log(
      `用户 ${userId} 分群 "${userSegment}" → 策略 "${strategyName}" 已分配`,
    );
    return true;
  }

  /**
   * 获取分群对应的策略名
   */
  getStrategyNameForSegment(segment: UserSegment): string | undefined {
    return SEGMENT_STRATEGY_MAP[segment];
  }

  /**
   * 从策略名解析策略 ID（带内存缓存）
   */
  private async resolveStrategyId(
    strategyName: string,
  ): Promise<string | null> {
    // 初始化缓存
    if (!this.strategyIdCache) {
      await this.refreshStrategyIdCache();
    }

    const cached = this.strategyIdCache?.get(strategyName);
    if (cached) return cached;

    // 缓存未命中，刷新并重试
    await this.refreshStrategyIdCache();
    return this.strategyIdCache?.get(strategyName) ?? null;
  }

  /**
   * 刷新策略名 → ID 缓存
   */
  private async refreshStrategyIdCache(): Promise<void> {
    const strategies = await this.strategyService.findAll({
      status: StrategyStatus.ACTIVE,
      page: 1,
      pageSize: 50,
    });

    const cache = new Map<string, string>();
    for (const s of strategies.data) {
      cache.set(s.name, s.id);
    }
    this.strategyIdCache = cache;
  }
}
