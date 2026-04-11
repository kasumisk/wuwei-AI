/**
 * V6.2 Phase 2.2 — 推荐生成事件监听器
 *
 * 监听 RECOMMENDATION_GENERATED 事件，处理推荐侧统计和学习：
 * - 统计推荐次数 + 命中率（预计算 vs 实时）
 * - 记录策略版本使用情况
 * - 推荐延迟指标收集
 *
 * V6.3 P1-7: 使用 Redis Hash HINCRBY 原子操作替代 JSON read-modify-write，
 * 消除并发事件下的计数竞态条件。
 *
 * 所有操作异步执行，不阻塞推荐主流程。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  RecommendationGeneratedEvent,
} from '../../../core/events/domain-events';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../core/cache/tiered-cache-manager';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';

/** 推荐统计指标（存储在 Redis 中） */
interface RecommendationStats {
  /** 总推荐次数 */
  totalCount: number;
  /** 预计算命中次数 */
  precomputeHitCount: number;
  /** 实时计算次数 */
  realtimeCount: number;
  /** 累计延迟（用于计算平均） */
  totalLatencyMs: number;
  /** 最后更新时间 */
  lastUpdated: string;
}

@Injectable()
export class RecommendationEventListener implements OnModuleInit {
  private readonly logger = new Logger(RecommendationEventListener.name);

  /** 统计数据过期时间：30 天 */
  private static readonly STATS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  /** V6.2 3.9: TieredCache namespace（用于读取聚合数据） */
  private cache!: TieredCacheNamespace<RecommendationStats>;

  constructor(
    private readonly cacheManager: TieredCacheManager,
    private readonly redisCacheService: RedisCacheService,
  ) {}

  onModuleInit(): void {
    this.cache = this.cacheManager.createNamespace<RecommendationStats>({
      namespace: 'rec_stats_daily',
      l1MaxEntries: 60,
      l1TtlMs: 10 * 60 * 1000, // L1: 10 分钟
      l2TtlMs: RecommendationEventListener.STATS_TTL_MS, // L2: 30 天
    });
  }

  /**
   * 处理推荐生成事件
   *
   * 职责:
   * 1. 更新每日推荐统计（总数、预计算命中率、平均延迟）
   * 2. 记录推荐事件日志（含策略版本）
   */
  @OnEvent(DomainEvents.RECOMMENDATION_GENERATED, { async: true })
  async handleRecommendationGenerated(
    event: RecommendationGeneratedEvent,
  ): Promise<void> {
    try {
      // 1. 更新每日统计
      await this.updateDailyStats(event);

      // 2. 结构化日志（运营分析用）
      this.logger.debug(
        `推荐生成: userId=${event.userId}, meal=${event.mealType}, ` +
          `foods=${event.foodCount}, latency=${event.latencyMs}ms, ` +
          `precompute=${event.fromPrecompute}, ` +
          `strategy=${event.strategyVersion ?? 'default'}`,
      );
    } catch (err) {
      // 统计失败不应影响推荐主流程
      this.logger.warn(`推荐统计更新失败: ${(err as Error).message}`);
    }
  }

  /**
   * 更新每日推荐统计
   *
   * V6.3 P1-7: 使用 Redis HINCRBY 原子递增各维度计数器，
   * 替代 get→modify→set 的非原子模式，消除并发竞态。
   *
   * Hash key 格式: rec_atomic:{YYYY-MM-DD}
   * Hash fields:
   *   - total            → 总推荐次数
   *   - precomputeHit    → 预计算命中次数
   *   - realtime         → 实时计算次数
   *   - totalLatencyMs   → 累计延迟毫秒
   *   - lastUpdated      → 最后更新时间
   */
  private async updateDailyStats(
    event: RecommendationGeneratedEvent,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const hashKey = this.redisCacheService.buildKey('rec_atomic', today);

    // 原子递增各维度计数器（并行执行，各自独立原子）
    const incrPromises: Promise<number | null>[] = [
      this.redisCacheService.hIncrBy(hashKey, 'total', 1),
      this.redisCacheService.hIncrBy(
        hashKey,
        'totalLatencyMs',
        event.latencyMs,
      ),
    ];

    if (event.fromPrecompute) {
      incrPromises.push(
        this.redisCacheService.hIncrBy(hashKey, 'precomputeHit', 1),
      );
    } else {
      incrPromises.push(this.redisCacheService.hIncrBy(hashKey, 'realtime', 1));
    }

    await Promise.all([
      ...incrPromises,
      this.redisCacheService.hSet(
        hashKey,
        'lastUpdated',
        new Date().toISOString(),
      ),
    ]);

    // 设置过期时间（NX: 仅首次设置，避免每次刷新 TTL）
    await this.redisCacheService.expireNX(
      hashKey,
      RecommendationEventListener.STATS_TTL_MS,
    );
  }

  /**
   * 从 Redis Hash 读取每日统计（供查询接口使用）
   *
   * 将 Hash fields 重组为 RecommendationStats 结构体。
   * 如果 Hash 不存在或 Redis 不可用，回退到 TieredCache。
   */
  async getDailyStats(date: string): Promise<RecommendationStats | null> {
    const hashKey = this.redisCacheService.buildKey('rec_atomic', date);
    const raw = await this.redisCacheService.hGetAll(hashKey);

    if (!raw || Object.keys(raw).length === 0) {
      // 回退到 TieredCache（兼容旧数据）
      return this.cache.get(date);
    }

    return {
      totalCount: parseInt(raw['total'] || '0', 10),
      precomputeHitCount: parseInt(raw['precomputeHit'] || '0', 10),
      realtimeCount: parseInt(raw['realtime'] || '0', 10),
      totalLatencyMs: parseInt(raw['totalLatencyMs'] || '0', 10),
      lastUpdated: raw['lastUpdated'] || '',
    };
  }
}
