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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, Between } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  ProfileUpdatedEvent,
} from '../../../core/events/domain-events';
import {
  ProfileChangeLog,
  ProfileChangeType,
  ProfileChangeSource,
} from '../entities/profile-change-log.entity';

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

  constructor(
    @InjectRepository(ProfileChangeLog)
    private readonly changeLogRepo: Repository<ProfileChangeLog>,
  ) {}

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
        userId: event.userId,
        changeType: event.updateType as ProfileChangeType,
        source: (event.source as ProfileChangeSource) || 'event',
        changedFields: event.changedFields,
        beforeValues: event.beforeValues || {},
        afterValues: event.afterValues || {},
        triggerEvent: event.eventName,
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
    params: Omit<ProfileChangeLog, 'id' | 'version' | 'createdAt'>,
  ): Promise<ProfileChangeLog> {
    const nextVersion = await this.getNextVersion(params.userId);

    const log = this.changeLogRepo.create({
      ...params,
      version: nextVersion,
    });

    return this.changeLogRepo.save(log);
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
    const where: Record<string, unknown> = { userId: query.userId };

    if (query.changeType) {
      where.changeType = query.changeType;
    }

    if (query.startDate && query.endDate) {
      where.createdAt = Between(
        new Date(query.startDate),
        new Date(query.endDate),
      );
    }

    const [items, total] = await this.changeLogRepo.findAndCount({
      where,
      order: { version: 'DESC' },
      skip,
      take: limit,
    });

    const latestVersion = await this.getLatestVersion(query.userId);

    return {
      items,
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
    return this.changeLogRepo.findOne({
      where: { userId, version },
    });
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
    return this.changeLogRepo.find({
      where: {
        userId,
        version: LessThanOrEqual(version),
      },
      order: { version: 'ASC' },
    });
  }

  /**
   * 获取用户最新版本号
   */
  async getLatestVersion(userId: string): Promise<number> {
    const result = await this.changeLogRepo
      .createQueryBuilder('log')
      .select('MAX(log.version)', 'maxVersion')
      .where('log.userId = :userId', { userId })
      .getRawOne();

    return result?.maxVersion || 0;
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
    const totalChanges = await this.changeLogRepo.count({
      where: { userId },
    });

    const latestVersion = await this.getLatestVersion(userId);

    // 按类型统计变更次数
    const typeStats = await this.changeLogRepo
      .createQueryBuilder('log')
      .select('log.changeType', 'changeType')
      .addSelect('COUNT(*)', 'count')
      .where('log.userId = :userId', { userId })
      .groupBy('log.changeType')
      .getRawMany();

    const changesByType: Record<string, number> = {};
    for (const stat of typeStats) {
      changesByType[stat.changeType] = parseInt(stat.count, 10);
    }

    // 最后一次变更时间
    const lastLog = await this.changeLogRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
      select: ['createdAt'],
    });

    return {
      totalChanges,
      latestVersion,
      changesByType,
      lastChangeAt: lastLog?.createdAt || null,
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
