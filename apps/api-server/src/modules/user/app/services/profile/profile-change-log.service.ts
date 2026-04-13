/**
 * V6 Phase 2.17 — 画像变更日志服务
 *
 * 核心职责：
 * 1. 监听 PROFILE_UPDATED 事件，自动记录变更前后值
 * 2. 每次变更自动递增用户级版本号
 * 3. 提供查询 API：按用户/类型/时间范围查询 + 指定版本回溯
 *
 * 设计决策：
 * - 版本号按用户隔离（每个用户独立自增），使用数据库 MAX(version) + 1
 * - 事件监听使用 async=true，不阻塞主流程（变更日志是旁路记录）
 * - 查询支持分页，防止大量日志导致响应过大
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  ProfileUpdatedEvent,
} from '../../../../../core/events/domain-events';
import { ProfileChangeType, ProfileChangeSource } from '../../../user.types';
import { profile_change_log as ProfileChangeLog } from '@prisma/client';
import { PrismaService } from '../../../../../core/prisma/prisma.service';

// ─── 查询 DTO ───

/** 查询变更日志的过滤条件 */
export interface ProfileChangeLogQuery {
  /** 用户 ID（必填） */
  userId: string;
  /** 按变更类型过滤 */
  changeType?: ProfileChangeType;
  /** 时间范围起始（ISO string） */
  startDate?: string;
  /** 时间范围结束（ISO string） */
  endDate?: string;
  /** 分页：页码（从 1 开始） */
  page?: number;
  /** 分页：每页条数（默认 20，最大 100） */
  limit?: number;
}

/** 变更日志查询结果 */
export interface ProfileChangeLogResult {
  items: ProfileChangeLog[];
  total: number;
  page: number;
  limit: number;
  /** 当前最新版本号 */
  latestVersion: number;
}

// ─── 常量 ───

/** 默认分页大小 */
const DEFAULT_PAGE_SIZE = 20;
/** 最大分页大小 */
const MAX_PAGE_SIZE = 100;

// ─── 服务实现 ───

@Injectable()
export class ProfileChangeLogService {
  private readonly logger = new Logger(ProfileChangeLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── 事件监听 ───

  /**
   * 监听画像更新事件 → 自动记录变更日志
   *
   * 异步处理：即使日志记录失败也不影响主流程。
   * 仅当事件携带 changedFields 时才记录（无变更字段 = 无实质变更）。
   */
  @OnEvent(DomainEvents.PROFILE_UPDATED, { async: true })
  async handleProfileUpdated(event: ProfileUpdatedEvent): Promise<void> {
    try {
      // 无变更字段信息时跳过记录（不是所有 emit 都带 changedFields）
      if (!event.changedFields || event.changedFields.length === 0) {
        this.logger.debug(
          `跳过变更日志（无变更字段）: userId=${event.userId}, type=${event.updateType}`,
        );
        return;
      }

      await this.createLog({
        user_id: event.userId,
        change_type: event.updateType as ProfileChangeType,
        source: (event.source as ProfileChangeSource) || 'event',
        changed_fields: event.changedFields as any,
        before_values: (event.beforeValues || {}) as any,
        after_values: (event.afterValues || {}) as any,
        trigger_event: event.eventName,
        reason: event.reason || null,
        metadata: null,
      });

      this.logger.debug(
        `画像变更日志已记录: userId=${event.userId}, type=${event.updateType}, fields=[${event.changedFields.join(', ')}]`,
      );
    } catch (err) {
      // 变更日志是旁路功能，失败不阻塞主流程
      this.logger.warn(
        `画像变更日志记录失败: userId=${event.userId}, ${(err as Error).message}`,
      );
    }
  }

  // ─── 写入 API ───

  /**
   * 创建变更日志条目（内部 + 外部均可调用）
   *
   * 自动计算下一个版本号（用户级隔离）。
   */
  async createLog(
    params: Omit<ProfileChangeLog, 'id' | 'version' | 'created_at'>,
  ): Promise<ProfileChangeLog> {
    const nextVersion = await this.getNextVersion(params.user_id);

    const log = await this.prisma.profile_change_log.create({
      data: {
        user_id: params.user_id,
        version: nextVersion,
        change_type: params.change_type,
        source: params.source,
        changed_fields: params.changed_fields as any,
        before_values: params.before_values as any,
        after_values: params.after_values as any,
        trigger_event: params.trigger_event,
        reason: params.reason,
        metadata: params.metadata as any,
      },
    });

    return log as any;
  }

  // ─── 查询 API ───

  /**
   * 查询用户画像变更历史（分页 + 过滤）
   */
  async queryLogs(
    query: ProfileChangeLogQuery,
  ): Promise<ProfileChangeLogResult> {
    const page = Math.max(query.page || 1, 1);
    const limit = Math.min(
      Math.max(query.limit || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const skip = (page - 1) * limit;

    // 构建查询条件
    const where: any = { user_id: query.userId };

    if (query.changeType) {
      where.change_type = query.changeType;
    }

    if (query.startDate && query.endDate) {
      where.created_at = {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.profile_change_log.findMany({
        where,
        orderBy: { version: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.profile_change_log.count({ where }),
    ]);

    const latestVersion = await this.getLatestVersion(query.userId);

    return {
      items: items as any,
      total,
      page,
      limit,
      latestVersion,
    };
  }

  /**
   * 获取指定版本的变更日志
   *
   * 用于画像回溯：查看某个版本时用户画像发生了什么变更。
   */
  async getLogByVersion(
    userId: string,
    version: number,
  ): Promise<ProfileChangeLog | null> {
    const log = await this.prisma.profile_change_log.findFirst({
      where: { user_id: userId, version },
    });
    return log as any;
  }

  /**
   * 获取用户画像在指定版本之前（含）的所有变更日志
   *
   * 用于完整画像回溯：重放所有变更以还原某个时间点的画像状态。
   */
  async getLogsUpToVersion(
    userId: string,
    version: number,
  ): Promise<ProfileChangeLog[]> {
    const logs = await this.prisma.profile_change_log.findMany({
      where: {
        user_id: userId,
        version: { lte: version },
      },
      orderBy: { version: 'asc' },
    });
    return logs as any;
  }

  /**
   * 获取用户最新版本号
   */
  async getLatestVersion(userId: string): Promise<number> {
    const result = await this.prisma.profile_change_log.aggregate({
      where: { user_id: userId },
      _max: { version: true },
    });

    return result._max.version || 0;
  }

  /**
   * 获取用户变更统计摘要
   *
   * 用于管理后台或用户画像详情页展示变更概览。
   */
  async getChangeSummary(userId: string): Promise<{
    totalChanges: number;
    latestVersion: number;
    changesByType: Record<string, number>;
    lastChangeAt: Date | null;
  }> {
    const totalChanges = await this.prisma.profile_change_log.count({
      where: { user_id: userId },
    });

    const latestVersion = await this.getLatestVersion(userId);

    // 按类型统计变更次数
    const typeStats = await this.prisma.profile_change_log.groupBy({
      by: ['change_type'],
      where: { user_id: userId },
      _count: { _all: true },
    });

    const changesByType: Record<string, number> = {};
    for (const stat of typeStats) {
      changesByType[stat.change_type] = stat._count._all;
    }

    // 最后一次变更时间
    const lastLog = await this.prisma.profile_change_log.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    });

    return {
      totalChanges,
      latestVersion,
      changesByType,
      lastChangeAt: lastLog?.created_at || null,
    };
  }

  // ─── 私有方法 ───

  /**
   * 获取用户下一个版本号
   *
   * 基于数据库 MAX(version) + 1，简单可靠。
   * 并发写入极端情况下可能出现 gap，但不影响功能正确性。
   */
  private async getNextVersion(userId: string): Promise<number> {
    const current = await this.getLatestVersion(userId);
    return current + 1;
  }
}
