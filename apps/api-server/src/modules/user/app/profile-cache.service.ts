import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  user_profiles as UserProfile,
  user_behavior_profiles as UserBehaviorProfile,
  user_inferred_profiles as UserInferredProfile,
} from '@prisma/client';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';
import { TieredCacheManager, TieredCacheNamespace } from '../../../core/cache';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * 三层画像聚合结果
 */
export interface FullUserProfile {
  declared: UserProfile | null;
  observed: UserBehaviorProfile | null;
  inferred: UserInferredProfile | null;
}

/**
 * 用户画像缓存层
 *
 * V6 Phase 1.7: 迁移到 TieredCacheManager 统一缓存抽象
 *
 * 原 V5 4.5 手写的 LRU + Singleflight + 双层 TTL 逻辑
 * 现在由 TieredCacheNamespace 统一提供：
 * - L1 内存 LRU（5000 条，2 分钟 TTL）
 * - L2 Redis（10 分钟 TTL）
 * - Singleflight 防穿透
 *
 * 本 Service 只保留业务逻辑（DB 加载、便捷方法、失效策略）。
 */
@Injectable()
export class ProfileCacheService implements OnModuleInit {
  private readonly logger = new Logger(ProfileCacheService.name);
  private cache: TieredCacheNamespace<FullUserProfile>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly cacheManager: TieredCacheManager,
  ) {}

  onModuleInit(): void {
    // 创建 profile namespace — 配置与原 V5 4.5 保持一致
    this.cache = this.cacheManager.createNamespace<FullUserProfile>({
      namespace: 'profile',
      l1MaxEntries: 5000,
      l1TtlMs: 2 * 60 * 1000, // 内存 2 分钟
      l2TtlMs: 10 * 60 * 1000, // Redis 10 分钟
    });
  }

  /**
   * 获取完整画像（L1 → L2 → DB，带 Singleflight 防穿透）
   */
  async getFullProfile(userId: string): Promise<FullUserProfile> {
    return this.cache.getOrSet(userId, () => this.loadFromDB(userId));
  }

  /**
   * 从数据库并行加载三层画像
   */
  private async loadFromDB(userId: string): Promise<FullUserProfile> {
    const [declared, observed, inferred] = await Promise.all([
      this.prisma.user_profiles.findUnique({ where: { user_id: userId } }),
      this.prisma.user_behavior_profiles.findUnique({
        where: { user_id: userId },
      }),
      this.prisma.user_inferred_profiles.findUnique({
        where: { user_id: userId },
      }),
    ]);
    return {
      declared: declared as any,
      observed: observed as any,
      inferred: inferred as any,
    };
  }

  /**
   * 获取用于推荐引擎的用户约束（便捷方法）
   */
  async getUserConstraints(userId: string): Promise<
    | {
        dietaryRestrictions: string[];
        weakTimeSlots: string[];
        discipline: string;
        allergens: string[];
        healthConditions: string[];
        regionCode: string; // V4 修复 A7: 传递 regionCode
      }
    | undefined
  > {
    const { declared } = await this.getFullProfile(userId);
    if (!declared) return undefined;

    return {
      dietaryRestrictions: (declared.dietary_restrictions as string[]) || [],
      weakTimeSlots: (declared.weak_time_slots as string[]) || [],
      discipline: declared.discipline || 'medium',
      allergens: (declared.allergens as string[]) || [],
      healthConditions: (declared.health_conditions as string[]) || [],
      regionCode: declared.region_code || 'CN', // V4 修复 A7
    };
  }

  /**
   * Profile 更新时清除缓存（L1 + L2）
   */
  invalidate(userId: string): void {
    this.cache.invalidate(userId).catch(() => {
      /* non-critical */
    });
  }

  /**
   * 批量失效（Cron 任务后调用）
   */
  invalidateAll(): void {
    this.cache.invalidateAll().catch(() => {
      /* non-critical */
    });
  }

  /**
   * 获取缓存统计（监控用）
   */
  getStats(): {
    memorySize: number;
    maxSize: number;
    memTtlMs: number;
    redisTtlMs: number;
    redisConnected: boolean;
  } {
    const stats = this.cache.getStats();
    return {
      memorySize: stats.l1Size,
      maxSize: stats.l1MaxEntries,
      memTtlMs: 2 * 60 * 1000,
      redisTtlMs: 10 * 60 * 1000,
      redisConnected: this.redis.isConnected,
    };
  }
}
