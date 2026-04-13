/**
 * V6.2 Phase 2.4 — 付费墙分析事件监听器
 *
 * 监听 PAYWALL_TRIGGERED 事件，记录转化漏斗数据用于运营分析：
 * - 按场景/功能统计付费墙触发频次
 * - 记录用户当前等级与推荐升级等级的分布
 * - 提供转化率分析的数据基础
 *
 * V6.3 P1-7: 使用 Redis Hash HINCRBY 原子操作替代 JSON read-modify-write，
 * 消除并发事件下的计数竞态条件。
 *
 * 数据存储在 Redis Hash 中（按日聚合），30 天自动过期。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  PaywallTriggeredEvent,
} from '../../../../core/events/domain-events';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../core/cache/tiered-cache-manager';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';

/** 付费墙每日统计 */
interface PaywallDailyStats {
  /** 总触发次数 */
  totalCount: number;
  /** 按触发场景的次数 */
  byScene: Record<string, number>;
  /** 按触发功能的次数 */
  byFeature: Record<string, number>;
  /** 按当前等级的次数 */
  byCurrentTier: Record<string, number>;
  /** 最后更新时间 */
  lastUpdated: string;
}

@Injectable()
export class PaywallAnalyticsListener implements OnModuleInit {
  private readonly logger = new Logger(PaywallAnalyticsListener.name);

  private static readonly STATS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  /** V6.2 3.9: TieredCache namespace（用于读取聚合数据） */
  private cache!: TieredCacheNamespace<PaywallDailyStats>;

  constructor(
    private readonly cacheManager: TieredCacheManager,
    private readonly redisCacheService: RedisCacheService,
  ) {}

  onModuleInit(): void {
    this.cache = this.cacheManager.createNamespace<PaywallDailyStats>({
      namespace: 'paywall_stats_daily',
      l1MaxEntries: 60,
      l1TtlMs: 10 * 60 * 1000, // L1: 10 分钟
      l2TtlMs: PaywallAnalyticsListener.STATS_TTL_MS, // L2: 30 天
    });
  }

  /**
   * 处理付费墙触发事件
   *
   * 更新每日付费墙统计，按场景/功能/等级维度聚合
   */
  @OnEvent(DomainEvents.PAYWALL_TRIGGERED, { async: true })
  async handlePaywallTriggered(event: PaywallTriggeredEvent): Promise<void> {
    try {
      this.logger.log(
        `付费墙触发: userId=${event.userId}, ` +
          `tier=${event.currentTier}, scene=${event.triggerScene}, ` +
          `feature=${event.feature}, recommended=${event.recommendedTier}`,
      );

      await this.updateDailyStats(event);
    } catch (err) {
      this.logger.warn(`付费墙统计更新失败: ${(err as Error).message}`);
    }
  }

  /**
   * 更新每日付费墙统计
   *
   * V6.3 P1-7: 使用 Redis HINCRBY 原子递增各维度计数器，
   * 替代 get→modify→set 的非原子模式，消除并发竞态。
   *
   * Hash key 格式: paywall_atomic:{YYYY-MM-DD}
   * Hash fields:
   *   - total           → 总触发次数
   *   - scene:{scene}   → 按场景计数
   *   - feature:{feat}  → 按功能计数
   *   - tier:{tier}     → 按等级计数
   *   - lastUpdated     → 最后更新时间（HSET，非 HINCRBY）
   */
  private async updateDailyStats(event: PaywallTriggeredEvent): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const hashKey = this.redisCacheService.buildKey('paywall_atomic', today);

    // 原子递增各维度计数器（并行执行，各自独立原子）
    await Promise.all([
      this.redisCacheService.hIncrBy(hashKey, 'total', 1),
      this.redisCacheService.hIncrBy(hashKey, `scene:${event.triggerScene}`, 1),
      this.redisCacheService.hIncrBy(hashKey, `feature:${event.feature}`, 1),
      this.redisCacheService.hIncrBy(hashKey, `tier:${event.currentTier}`, 1),
      this.redisCacheService.hSet(
        hashKey,
        'lastUpdated',
        new Date().toISOString(),
      ),
    ]);

    // 设置过期时间（NX: 仅首次设置，避免每次刷新 TTL）
    await this.redisCacheService.expireNX(
      hashKey,
      PaywallAnalyticsListener.STATS_TTL_MS,
    );
  }

  /**
   * 从 Redis Hash 读取每日统计（供查询接口使用）
   *
   * 将 Hash fields 重组为 PaywallDailyStats 结构体。
   * 如果 Hash 不存在或 Redis 不可用，回退到 TieredCache。
   */
  async getDailyStats(date: string): Promise<PaywallDailyStats | null> {
    const hashKey = this.redisCacheService.buildKey('paywall_atomic', date);
    const raw = await this.redisCacheService.hGetAll(hashKey);

    if (!raw || Object.keys(raw).length === 0) {
      // 回退到 TieredCache（兼容旧数据）
      return this.cache.get(date);
    }

    const stats: PaywallDailyStats = {
      totalCount: parseInt(raw['total'] || '0', 10),
      byScene: {},
      byFeature: {},
      byCurrentTier: {},
      lastUpdated: raw['lastUpdated'] || '',
    };

    for (const [field, value] of Object.entries(raw)) {
      if (field.startsWith('scene:')) {
        stats.byScene[field.slice(6)] = parseInt(value, 10);
      } else if (field.startsWith('feature:')) {
        stats.byFeature[field.slice(8)] = parseInt(value, 10);
      } else if (field.startsWith('tier:')) {
        stats.byCurrentTier[field.slice(5)] = parseInt(value, 10);
      }
    }

    return stats;
  }
}
