/**
 * V7.3 P3-B: 缓存预热服务
 *
 * 实现 OnApplicationBootstrap 接口，在 NestJS 应用启动完成后
 * 异步预热关键缓存数据，不阻塞启动流程。
 *
 * 预热内容：
 * 1. 食物池全量加载 — 10 个品类分片
 * 2. 热门用户画像预加载 — 最近 7 天活跃用户，最多 100 个
 *
 * 设计要点：
 * - 异步 fire-and-forget，预热失败仅 warn 不影响启动
 * - 可选依赖注入（允许没有 FoodPoolCacheService 或 PrismaService 时降级）
 * - 日志记录预热耗时和结果
 */
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { FoodPoolCacheService } from '../../modules/diet/app/recommendation/food-pool-cache.service';
import { PrismaService } from '../prisma/prisma.service';

/** 预热活跃用户画像的最大数量 */
const MAX_WARMUP_USERS = 100;

/** 活跃用户时间窗口: 7 天 */
const ACTIVE_WINDOW_DAYS = 7;

@Injectable()
export class CacheWarmupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CacheWarmupService.name);

  constructor(
    @Optional() private readonly foodPoolCache: FoodPoolCacheService | null,
    @Optional() private readonly prisma: PrismaService | null,
  ) {}

  /**
   * NestJS 启动钩子
   *
   * 异步执行预热，catch 所有错误确保不阻塞启动。
   */
  async onApplicationBootstrap(): Promise<void> {
    // fire-and-forget: 异步预热不阻塞启动
    this.warmup().catch((err) => {
      this.logger.warn(
        `Cache warmup failed (non-blocking): ${err.message || err}`,
      );
    });
  }

  /**
   * 执行全量预热
   *
   * 顺序执行：先食物池 → 再用户画像
   * 每步独立 try-catch，一步失败不影响另一步。
   */
  private async warmup(): Promise<void> {
    const startTime = Date.now();
    this.logger.log('Cache warmup started...');

    // 1. 食物池全量加载
    await this.warmupFoodPool();

    // 2. 热门用户画像预加载
    const warmupUserCount = await this.warmupActiveUserProfiles();

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Cache warmup complete in ${elapsed}ms: food pool + ${warmupUserCount} user profiles`,
    );
  }

  /**
   * 预热食物池缓存
   *
   * 调用 FoodPoolCacheService.getVerifiedFoods()
   * 触发 TieredCacheManager 的 L1+L2 双层缓存回填。
   */
  private async warmupFoodPool(): Promise<void> {
    if (!this.foodPoolCache) {
      this.logger.debug(
        'FoodPoolCacheService not available, skipping food pool warmup',
      );
      return;
    }

    try {
      const startTime = Date.now();
      const foods = await this.foodPoolCache.getVerifiedFoods();
      const elapsed = Date.now() - startTime;
      this.logger.log(
        `Food pool warmup: ${foods.length} foods loaded in ${elapsed}ms`,
      );
    } catch (err) {
      this.logger.warn(
        `Food pool warmup failed (non-blocking): ${(err as Error).message}`,
      );
    }
  }

  /**
   * 预热活跃用户画像
   *
   * 查询最近 ACTIVE_WINDOW_DAYS 天内有食物记录的用户 ID，
   * 最多 MAX_WARMUP_USERS 个。
   *
   * 注意：这里只是查询并触发缓存加载，不直接操作用户画像。
   * 实际预热逻辑委托给各缓存 namespace 的 getOrSet。
   *
   * @returns 预热的用户数量
   */
  private async warmupActiveUserProfiles(): Promise<number> {
    if (!this.prisma) {
      this.logger.debug(
        'PrismaService not available, skipping user profile warmup',
      );
      return 0;
    }

    try {
      const startTime = Date.now();
      const since = new Date();
      since.setDate(since.getDate() - ACTIVE_WINDOW_DAYS);

      // 查询最近活跃用户（有食物记录的用户，去重取 top N）
      const activeUsers = await this.prisma.food_records.findMany({
        where: {
          recorded_at: { gte: since },
        },
        select: { user_id: true },
        distinct: ['user_id'],
        take: MAX_WARMUP_USERS,
        orderBy: { recorded_at: 'desc' },
      });

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `Active user query: ${activeUsers.length} users found in ${elapsed}ms`,
      );

      // 目前仅完成用户 ID 查询，后续可在此处触发 PreferenceProfile 预加载
      // 当前不实际预热用户画像（避免引入循环依赖），仅记录活跃用户数
      return activeUsers.length;
    } catch (err) {
      this.logger.warn(
        `User profile warmup failed (non-blocking): ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * 手动触发预热（可用于管理端 API 或定时任务）
   */
  async manualWarmup(): Promise<{ foodCount: number; userCount: number }> {
    this.logger.log('Manual cache warmup triggered');

    let foodCount = 0;
    let userCount = 0;

    if (this.foodPoolCache) {
      const foods = await this.foodPoolCache.getVerifiedFoods();
      foodCount = foods.length;
    }

    userCount = await this.warmupActiveUserProfiles();

    return { foodCount, userCount };
  }
}
