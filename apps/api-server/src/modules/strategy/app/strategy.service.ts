/**
 * V6 Phase 2.1 — 策略管理服务
 *
 * 职责:
 * - 策略 CRUD（管理后台使用）
 * - 策略查询（按 scope、status 查找 active 策略）
 * - Redis 缓存（30s TTL，避免每次推荐都查 DB）
 * - 版本管理（编辑时自增 version，触发缓存失效）
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  StrategyConfig,
  StrategyStatus,
  StrategyScope,
  AssignmentType,
  StrategyEntity,
  StrategyAssignmentEntity,
} from '../strategy.types';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

/** 策略缓存 TTL（秒） */
const STRATEGY_CACHE_TTL = 30;
/** 缓存键前缀 */
const CACHE_PREFIX = 'strategy:';

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  // ─── 策略 CRUD（管理后台） ───

  /** 创建策略 */
  async create(data: {
    name: string;
    description?: string;
    scope: StrategyScope;
    scopeTarget?: string;
    config: StrategyConfig;
    priority?: number;
  }): Promise<StrategyEntity> {
    const saved = await this.prisma.strategy.create({
      data: {
        name: data.name,
        description: data.description || null,
        scope: data.scope,
        scopeTarget: data.scopeTarget || null,
        config: data.config as any,
        status: StrategyStatus.DRAFT,
        priority: data.priority || 0,
        version: 1,
      },
    });
    this.logger.log(`策略已创建: ${saved.name} (${saved.id})`);
    return saved as unknown as StrategyEntity;
  }

  /** 更新策略配置 */
  async update(
    id: string,
    data: Partial<{
      name: string;
      description: string;
      config: StrategyConfig;
      priority: number;
    }>,
  ): Promise<StrategyEntity> {
    const strategy = await this.prisma.strategy.findUnique({ where: { id } });
    if (!strategy) throw new NotFoundException(`策略 ${id} 不存在`);
    if (strategy.status === StrategyStatus.ARCHIVED) {
      throw new Error('已归档策略不可修改');
    }

    const saved = await this.prisma.strategy.update({
      where: { id },
      data: {
        ...data,
        config: data.config ? (data.config as any) : undefined,
        version: { increment: 1 },
      },
    });

    // 如果是 active 策略，失效缓存
    if (saved.status === StrategyStatus.ACTIVE) {
      await this.invalidateStrategyCache(saved as unknown as StrategyEntity);
    }

    this.logger.log(`策略已更新: ${saved.name} v${saved.version}`);
    return saved as unknown as StrategyEntity;
  }

  /** 激活策略（同 scope+scopeTarget 只允许一个 active） */
  async activate(id: string): Promise<StrategyEntity> {
    const strategy = await this.prisma.strategy.findUnique({ where: { id } });
    if (!strategy) throw new NotFoundException(`策略 ${id} 不存在`);

    // 将同 scope+scopeTarget 的其他 active 策略归档
    await this.prisma.strategy.updateMany({
      where: {
        scope: strategy.scope,
        scopeTarget: strategy.scopeTarget ?? null,
        status: StrategyStatus.ACTIVE,
        id: { not: id },
      },
      data: { status: StrategyStatus.ARCHIVED },
    });

    const saved = await this.prisma.strategy.update({
      where: { id },
      data: { status: StrategyStatus.ACTIVE },
    });

    // 失效相关缓存
    await this.invalidateStrategyCache(saved as unknown as StrategyEntity);
    this.logger.log(`策略已激活: ${saved.name} (scope=${saved.scope})`);
    return saved as unknown as StrategyEntity;
  }

  /** 归档策略 */
  async archive(id: string): Promise<StrategyEntity> {
    const strategy = await this.prisma.strategy.findUnique({ where: { id } });
    if (!strategy) throw new NotFoundException(`策略 ${id} 不存在`);

    const saved = await this.prisma.strategy.update({
      where: { id },
      data: { status: StrategyStatus.ARCHIVED },
    });
    await this.invalidateStrategyCache(saved as unknown as StrategyEntity);
    this.logger.log(`策略已归档: ${saved.name}`);
    return saved as unknown as StrategyEntity;
  }

  /** 获取策略详情 */
  async findById(id: string): Promise<StrategyEntity | null> {
    const result = await this.prisma.strategy.findUnique({ where: { id } });
    return result as unknown as StrategyEntity | null;
  }

  /** 列表查询 */
  async findAll(filters?: {
    scope?: StrategyScope;
    status?: StrategyStatus;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: StrategyEntity[]; total: number }> {
    const page = filters?.page || 1;
    const pageSize = filters?.pageSize || 20;

    const where: Record<string, unknown> = {};
    if (filters?.scope) where.scope = filters.scope;
    if (filters?.status) where.status = filters.status;

    const [data, total] = await Promise.all([
      this.prisma.strategy.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.strategy.count({ where }),
    ]);
    return { data: data as unknown as StrategyEntity[], total };
  }

  // ─── 策略查找（推荐引擎使用） ───

  /**
   * 获取指定 scope 的 active 策略（带缓存）
   */
  async getActiveStrategy(
    scope: StrategyScope,
    scopeTarget?: string,
  ): Promise<StrategyEntity | null> {
    const cacheKey = `${CACHE_PREFIX}active:${scope}:${scopeTarget || '_'}`;

    return this.redis.getOrSet<StrategyEntity | null>(
      cacheKey,
      STRATEGY_CACHE_TTL * 1000,
      async () => {
        const result = await this.prisma.strategy.findFirst({
          where: {
            scope,
            status: StrategyStatus.ACTIVE,
            scopeTarget: scopeTarget || null,
          },
          orderBy: { priority: 'desc' },
        });
        return result as unknown as StrategyEntity | null;
      },
    );
  }

  /**
   * 获取全局默认策略（scope=GLOBAL, status=ACTIVE）
   */
  async getGlobalStrategy(): Promise<StrategyEntity | null> {
    return this.getActiveStrategy(StrategyScope.GLOBAL);
  }

  /**
   * V7.0: 获取所有活跃的上下文策略（scope=CONTEXT）
   *
   * 返回所有 CONTEXT scope 的 active 策略，由 StrategyResolver 进行匹配。
   * 带缓存（30s TTL）。
   */
  async getContextStrategies(): Promise<StrategyEntity[]> {
    const cacheKey = `${CACHE_PREFIX}active:context:_all`;

    const result = await this.redis.getOrSet<StrategyEntity[]>(
      cacheKey,
      STRATEGY_CACHE_TTL * 1000,
      async () => {
        const rows = await this.prisma.strategy.findMany({
          where: {
            scope: StrategyScope.CONTEXT,
            status: StrategyStatus.ACTIVE,
          },
          orderBy: { priority: 'desc' },
        });
        return rows as unknown as StrategyEntity[];
      },
    );

    return result ?? [];
  }

  // ─── 策略分配 ───

  /** 为用户分配策略 */
  async assignToUser(data: {
    userId: string;
    strategyId: string;
    assignmentType: AssignmentType;
    source?: string;
    activeFrom?: Date;
    activeUntil?: Date;
  }): Promise<StrategyAssignmentEntity> {
    const saved = await this.prisma.strategyAssignment.create({
      data: {
        userId: data.userId,
        strategyId: data.strategyId,
        assignmentType: data.assignmentType,
        source: data.source || null,
        isActive: true,
        activeFrom: data.activeFrom || null,
        activeUntil: data.activeUntil || null,
      },
    });

    // 失效用户的策略缓存
    await this.redis.del(`${CACHE_PREFIX}user:${data.userId}`);
    this.logger.log(
      `策略分配: user=${data.userId} → strategy=${data.strategyId}`,
    );
    return saved as unknown as StrategyAssignmentEntity;
  }

  /** 获取用户的活跃策略分配 */
  async getUserAssignment(
    userId: string,
  ): Promise<StrategyAssignmentEntity | null> {
    const cacheKey = `${CACHE_PREFIX}user:${userId}`;

    return this.redis.getOrSet<StrategyAssignmentEntity | null>(
      cacheKey,
      STRATEGY_CACHE_TTL * 1000,
      async () => {
        const now = new Date();
        const assignments = await this.prisma.strategyAssignment.findMany({
          where: {
            userId,
            isActive: true,
            AND: [
              {
                OR: [{ activeFrom: null }, { activeFrom: { lte: now } }],
              },
              {
                OR: [{ activeUntil: null }, { activeUntil: { gte: now } }],
              },
            ],
          },
          orderBy: [{ createdAt: 'desc' }],
        });

        if (!assignments.length) return null;

        const priority: Record<string, number> = {
          manual: 1,
          experiment: 2,
          ab_test: 2,
          segment: 3,
          auto: 4,
        };

        assignments.sort((a, b) => {
          const pa = priority[a.assignmentType] ?? 99;
          const pb = priority[b.assignmentType] ?? 99;
          if (pa !== pb) return pa - pb;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });

        return assignments[0] as unknown as StrategyAssignmentEntity;
      },
    );
  }

  /** 取消用户的策略分配 */
  async removeUserAssignment(
    userId: string,
    assignmentId: string,
  ): Promise<void> {
    await this.prisma.strategyAssignment.update({
      where: { id: assignmentId },
      data: { isActive: false },
    });
    await this.redis.del(`${CACHE_PREFIX}user:${userId}`);
    this.logger.log(
      `策略分配已取消: user=${userId}, assignment=${assignmentId}`,
    );
  }

  // ─── 缓存管理 ───

  private async invalidateStrategyCache(
    _strategy: StrategyEntity,
  ): Promise<void> {
    try {
      await this.redis.delByPrefix(`${CACHE_PREFIX}active:`);
      // 也可以更精确地只失效相关的 key，但 prefix 删除足够简单
    } catch (err) {
      this.logger.warn(`策略缓存失效失败: ${err}`);
    }
  }
}
