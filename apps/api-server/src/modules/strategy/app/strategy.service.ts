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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy } from '../entities/strategy.entity';
import { StrategyAssignment } from '../entities/strategy-assignment.entity';
import {
  StrategyConfig,
  StrategyStatus,
  StrategyScope,
  AssignmentType,
} from '../strategy.types';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';

/** 策略缓存 TTL（秒） */
const STRATEGY_CACHE_TTL = 30;
/** 缓存键前缀 */
const CACHE_PREFIX = 'strategy:';

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);

  constructor(
    @InjectRepository(Strategy)
    private readonly strategyRepo: Repository<Strategy>,
    @InjectRepository(StrategyAssignment)
    private readonly assignmentRepo: Repository<StrategyAssignment>,
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
  }): Promise<Strategy> {
    const entity = this.strategyRepo.create({
      name: data.name,
      description: data.description || null,
      scope: data.scope,
      scopeTarget: data.scopeTarget || null,
      config: data.config,
      status: StrategyStatus.DRAFT,
      priority: data.priority || 0,
      version: 1,
    });
    const saved = await this.strategyRepo.save(entity);
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
  ): Promise<Strategy> {
    const strategy = await this.strategyRepo.findOneBy({ id });
    if (!strategy) throw new NotFoundException(`策略 ${id} 不存在`);
    if (strategy.status === StrategyStatus.ARCHIVED) {
      throw new Error('已归档策略不可修改');
    }

    Object.assign(strategy, data);
    strategy.version += 1;
    const saved = await this.strategyRepo.save(strategy);

    // 如果是 active 策略，失效缓存
    if (saved.status === StrategyStatus.ACTIVE) {
      await this.invalidateStrategyCache(saved);
    }

    this.logger.log(`策略已更新: ${saved.name} v${saved.version}`);
    return saved;
  }

  /** 激活策略（同 scope+scopeTarget 只允许一个 active） */
  async activate(id: string): Promise<Strategy> {
    const strategy = await this.strategyRepo.findOneBy({ id });
    if (!strategy) throw new NotFoundException(`策略 ${id} 不存在`);

    // 将同 scope+scopeTarget 的其他 active 策略归档
    await this.strategyRepo
      .createQueryBuilder()
      .update(Strategy)
      .set({ status: StrategyStatus.ARCHIVED })
      .where('scope = :scope', { scope: strategy.scope })
      .andWhere(
        strategy.scopeTarget
          ? 'scope_target = :target'
          : 'scope_target IS NULL',
        { target: strategy.scopeTarget },
      )
      .andWhere('status = :status', { status: StrategyStatus.ACTIVE })
      .andWhere('id != :id', { id })
      .execute();

    strategy.status = StrategyStatus.ACTIVE;
    const saved = await this.strategyRepo.save(strategy);

    // 失效相关缓存
    await this.invalidateStrategyCache(saved);
    this.logger.log(`策略已激活: ${saved.name} (scope=${saved.scope})`);
    return saved;
  }

  /** 归档策略 */
  async archive(id: string): Promise<Strategy> {
    const strategy = await this.strategyRepo.findOneBy({ id });
    if (!strategy) throw new NotFoundException(`策略 ${id} 不存在`);

    strategy.status = StrategyStatus.ARCHIVED;
    const saved = await this.strategyRepo.save(strategy);
    await this.invalidateStrategyCache(saved);
    this.logger.log(`策略已归档: ${saved.name}`);
    return saved;
  }

  /** 获取策略详情 */
  async findById(id: string): Promise<Strategy | null> {
    return this.strategyRepo.findOneBy({ id });
  }

  /** 列表查询 */
  async findAll(filters?: {
    scope?: StrategyScope;
    status?: StrategyStatus;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: Strategy[]; total: number }> {
    const page = filters?.page || 1;
    const pageSize = filters?.pageSize || 20;

    const qb = this.strategyRepo.createQueryBuilder('s');
    if (filters?.scope)
      qb.andWhere('s.scope = :scope', { scope: filters.scope });
    if (filters?.status)
      qb.andWhere('s.status = :status', { status: filters.status });

    qb.orderBy('s.priority', 'DESC')
      .addOrderBy('s.updatedAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  // ─── 策略查找（推荐引擎使用） ───

  /**
   * 获取指定 scope 的 active 策略（带缓存）
   */
  async getActiveStrategy(
    scope: StrategyScope,
    scopeTarget?: string,
  ): Promise<Strategy | null> {
    const cacheKey = `${CACHE_PREFIX}active:${scope}:${scopeTarget || '_'}`;

    return this.redis.getOrSet(
      cacheKey,
      STRATEGY_CACHE_TTL * 1000,
      async () => {
        const qb = this.strategyRepo
          .createQueryBuilder('s')
          .where('s.scope = :scope', { scope })
          .andWhere('s.status = :status', { status: StrategyStatus.ACTIVE });

        if (scopeTarget) {
          qb.andWhere('s.scope_target = :target', { target: scopeTarget });
        } else {
          qb.andWhere('s.scope_target IS NULL');
        }

        qb.orderBy('s.priority', 'DESC').limit(1);
        return qb.getOne();
      },
    );
  }

  /**
   * 获取全局默认策略（scope=GLOBAL, status=ACTIVE）
   */
  async getGlobalStrategy(): Promise<Strategy | null> {
    return this.getActiveStrategy(StrategyScope.GLOBAL);
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
  }): Promise<StrategyAssignment> {
    const entity = this.assignmentRepo.create({
      userId: data.userId,
      strategyId: data.strategyId,
      assignmentType: data.assignmentType,
      source: data.source || null,
      isActive: true,
      activeFrom: data.activeFrom || null,
      activeUntil: data.activeUntil || null,
    });
    const saved = await this.assignmentRepo.save(entity);

    // 失效用户的策略缓存
    await this.redis.del(`${CACHE_PREFIX}user:${data.userId}`);
    this.logger.log(
      `策略分配: user=${data.userId} → strategy=${data.strategyId}`,
    );
    return saved;
  }

  /** 获取用户的活跃策略分配 */
  async getUserAssignment(userId: string): Promise<StrategyAssignment | null> {
    const cacheKey = `${CACHE_PREFIX}user:${userId}`;

    return this.redis.getOrSet(
      cacheKey,
      STRATEGY_CACHE_TTL * 1000,
      async () => {
        const now = new Date();
        const qb = this.assignmentRepo
          .createQueryBuilder('a')
          .where('a.user_id = :userId', { userId })
          .andWhere('a.is_active = true')
          .andWhere('(a.active_from IS NULL OR a.active_from <= :now)', { now })
          .andWhere('(a.active_until IS NULL OR a.active_until >= :now)', {
            now,
          })
          .orderBy(
            `CASE a.assignment_type
              WHEN 'manual' THEN 1
              WHEN 'experiment' THEN 2
              WHEN 'segment' THEN 3
              ELSE 4
            END`,
            'ASC',
          )
          .limit(1);

        return qb.getOne();
      },
    );
  }

  /** 取消用户的策略分配 */
  async removeUserAssignment(
    userId: string,
    assignmentId: string,
  ): Promise<void> {
    await this.assignmentRepo.update(assignmentId, { isActive: false });
    await this.redis.del(`${CACHE_PREFIX}user:${userId}`);
    this.logger.log(
      `策略分配已取消: user=${userId}, assignment=${assignmentId}`,
    );
  }

  // ─── 缓存管理 ───

  private async invalidateStrategyCache(strategy: Strategy): Promise<void> {
    try {
      await this.redis.delByPrefix(`${CACHE_PREFIX}active:`);
      // 也可以更精确地只失效相关的 key，但 prefix 删除足够简单
    } catch (err) {
      this.logger.warn(`策略缓存失效失败: ${err}`);
    }
  }
}
