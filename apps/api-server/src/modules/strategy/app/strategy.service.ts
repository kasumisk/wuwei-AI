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
  }): Promise<any> {
    const saved = await this.prisma.strategy.create({
      data: {
        name: data.name,
        description: data.description || null,
        scope: data.scope,
        scope_target: data.scopeTarget || null,
        config: data.config as any,
        status: StrategyStatus.DRAFT,
        priority: data.priority || 0,
        version: 1,
      },
    });
    this.logger.log(`策略已创建: ${saved.name} (${saved.id})`);
    return saved;
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
  ): Promise<any> {
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
      await this.invalidateStrategyCache(saved);
    }

    this.logger.log(`策略已更新: ${saved.name} v${saved.version}`);
    return saved;
  }

  /** 激活策略（同 scope+scopeTarget 只允许一个 active） */
  async activate(id: string): Promise<any> {
    const strategy = await this.prisma.strategy.findUnique({ where: { id } });
    if (!strategy) throw new NotFoundException(`策略 ${id} 不存在`);

    // 将同 scope+scopeTarget 的其他 active 策略归档
    await this.prisma.strategy.updateMany({
      where: {
        scope: strategy.scope,
        scope_target: strategy.scope_target ?? null,
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
    await this.invalidateStrategyCache(saved);
    this.logger.log(`策略已激活: ${saved.name} (scope=${saved.scope})`);
    return saved;
  }

  /** 归档策略 */
  async archive(id: string): Promise<any> {
    const strategy = await this.prisma.strategy.findUnique({ where: { id } });
    if (!strategy) throw new NotFoundException(`策略 ${id} 不存在`);

    const saved = await this.prisma.strategy.update({
      where: { id },
      data: { status: StrategyStatus.ARCHIVED },
    });
    await this.invalidateStrategyCache(saved);
    this.logger.log(`策略已归档: ${saved.name}`);
    return saved;
  }

  /** 获取策略详情 */
  async findById(id: string): Promise<any | null> {
    return this.prisma.strategy.findUnique({ where: { id } });
  }

  /** 列表查询 */
  async findAll(filters?: {
    scope?: StrategyScope;
    status?: StrategyStatus;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: any[]; total: number }> {
    const page = filters?.page || 1;
    const pageSize = filters?.pageSize || 20;

    const where: any = {};
    if (filters?.scope) where.scope = filters.scope;
    if (filters?.status) where.status = filters.status;

    const [data, total] = await Promise.all([
      this.prisma.strategy.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { updated_at: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.strategy.count({ where }),
    ]);
    return { data, total };
  }

  // ─── 策略查找（推荐引擎使用） ───

  /**
   * 获取指定 scope 的 active 策略（带缓存）
   */
  async getActiveStrategy(
    scope: StrategyScope,
    scopeTarget?: string,
  ): Promise<any | null> {
    const cacheKey = `${CACHE_PREFIX}active:${scope}:${scopeTarget || '_'}`;

    return this.redis.getOrSet(
      cacheKey,
      STRATEGY_CACHE_TTL * 1000,
      async () => {
        return this.prisma.strategy.findFirst({
          where: {
            scope,
            status: StrategyStatus.ACTIVE,
            scope_target: scopeTarget || null,
          },
          orderBy: { priority: 'desc' },
        });
      },
    );
  }

  /**
   * 获取全局默认策略（scope=GLOBAL, status=ACTIVE）
   */
  async getGlobalStrategy(): Promise<any | null> {
    return this.getActiveStrategy(StrategyScope.GLOBAL);
  }

  /**
   * V7.0: 获取所有活跃的上下文策略（scope=CONTEXT）
   *
   * 返回所有 CONTEXT scope 的 active 策略，由 StrategyResolver 进行匹配。
   * 带缓存（30s TTL）。
   */
  async getContextStrategies(): Promise<any[]> {
    const cacheKey = `${CACHE_PREFIX}active:context:_all`;

    const result = await this.redis.getOrSet<any[]>(
      cacheKey,
      STRATEGY_CACHE_TTL * 1000,
      async () => {
        return this.prisma.strategy.findMany({
          where: {
            scope: StrategyScope.CONTEXT,
            status: StrategyStatus.ACTIVE,
          },
          orderBy: { priority: 'desc' },
        });
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
  }): Promise<any> {
    const saved = await this.prisma.strategy_assignment.create({
      data: {
        user_id: data.userId,
        strategy_id: data.strategyId,
        assignment_type: data.assignmentType,
        source: data.source || null,
        is_active: true,
        active_from: data.activeFrom || null,
        active_until: data.activeUntil || null,
      },
    });

    // 失效用户的策略缓存
    await this.redis.del(`${CACHE_PREFIX}user:${data.userId}`);
    this.logger.log(
      `策略分配: user=${data.userId} → strategy=${data.strategyId}`,
    );
    return saved;
  }

  /** 获取用户的活跃策略分配 */
  async getUserAssignment(userId: string): Promise<any | null> {
    const cacheKey = `${CACHE_PREFIX}user:${userId}`;

    return this.redis.getOrSet(
      cacheKey,
      STRATEGY_CACHE_TTL * 1000,
      async () => {
        const now = new Date();
        return this.prisma.$queryRaw`
          SELECT * FROM strategy_assignment
          WHERE user_id = ${userId}
          AND is_active = true
          AND (active_from IS NULL OR active_from <= ${now})
          AND (active_until IS NULL OR active_until >= ${now})
          ORDER BY CASE assignment_type
            WHEN 'manual' THEN 1
            WHEN 'experiment' THEN 2
            WHEN 'segment' THEN 3
            ELSE 4
          END ASC
          LIMIT 1
        `.then((rows: any[]) => rows[0] || null);
      },
    );
  }

  /** 取消用户的策略分配 */
  async removeUserAssignment(
    userId: string,
    assignmentId: string,
  ): Promise<void> {
    await this.prisma.strategy_assignment.update({
      where: { id: assignmentId },
      data: { is_active: false },
    });
    await this.redis.del(`${CACHE_PREFIX}user:${userId}`);
    this.logger.log(
      `策略分配已取消: user=${userId}, assignment=${assignmentId}`,
    );
  }

  // ─── 缓存管理 ───

  private async invalidateStrategyCache(strategy: any): Promise<void> {
    try {
      await this.redis.delByPrefix(`${CACHE_PREFIX}active:`);
      // 也可以更精确地只失效相关的 key，但 prefix 删除足够简单
    } catch (err) {
      this.logger.warn(`策略缓存失效失败: ${err}`);
    }
  }
}
