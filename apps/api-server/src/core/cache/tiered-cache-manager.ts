/**
 * V6 Phase 1.6 — 统一缓存抽象层（TieredCacheManager）
 *
 * 提供 L1 内存 LRU + L2 Redis 双层缓存抽象，替代各服务手写的双层缓存逻辑。
 *
 * 设计目标：
 * 1. 统一接口 — 所有缓存操作通过同一套 API（get/set/invalidate）
 * 2. 双层自动管理 — 读时自动 L1 miss → L2 miss → factory → 回填两层
 * 3. Singleflight — 同一 key 的并发穿透请求合并为一次
 * 4. LRU 淘汰 — L1 内存层有容量限制，利用 Map 插入顺序实现 LRU
 * 5. 可配置 — 每个 cache namespace 可独立配置 TTL、容量
 * 6. 降级安全 — Redis 不可用时自动降级为纯内存缓存
 *
 * V6.7 P1-2 跨实例 L1 失效（pub/sub）：
 * - 多个 Cloud Run 实例各自持有独立的 L1 内存缓存。
 * - 当某实例调用 invalidate() 时，其他实例的 L1 仍持有旧数据（最多 TTL 时间内不一致）。
 * - 修复：invalidate() 在清 L1 + L2 后，通过 Redis PUBLISH 向全实例广播失效通知。
 * - TieredCacheManager 在初始化时创建 subscriber 连接，订阅 CACHE_INVALIDATE_CHANNEL，
 *   收到消息后清对应 namespace 的 L1 entry（不清 L2，由发布方已清）。
 * - 降级安全：Redis pub/sub 不可用时，其他实例靠 L1 TTL 自然过期（最多 2 分钟延迟）。
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisCacheService } from '../redis/redis-cache.service';

/** 跨实例失效广播 channel 名 */
const CACHE_INVALIDATE_CHANNEL = 'cache:invalidate';

/** 失效消息格式 */
interface InvalidateMessage {
  /** namespace 名称 */
  ns: string;
  /** 具体 key；undefined = invalidateAll（整个 namespace） */
  key?: string;
}

// ─── 配置接口 ───

export interface TieredCacheConfig {
  /** 缓存命名空间（Redis key 前缀） */
  namespace: string;
  /** L1 内存缓存容量上限（条目数） */
  l1MaxEntries: number;
  /** L1 内存缓存 TTL（毫秒） */
  l1TtlMs: number;
  /** L2 Redis 缓存 TTL（毫秒） */
  l2TtlMs: number;
  /**
   * V6 1.7: Refresh-ahead 提前刷新时间（毫秒），可选。
   * 当 L1 缓存剩余 TTL < refreshAheadMs 时，返回旧数据同时触发后台异步刷新。
   * 实现 stale-while-revalidate 模式，避免缓存击穿。
   * 设为 0 或不设置则禁用 refresh-ahead。
   */
  refreshAheadMs?: number;
}

// ─── 内存缓存条目 ───

interface L1Entry<T> {
  data: T;
  ts: number;
}

/**
 * 单个 namespace 的双层缓存实例
 *
 * 每个 namespace 拥有独立的 L1 内存缓存 + 共享 L2 Redis。
 */
export class TieredCacheNamespace<T> {
  private readonly logger = new Logger(TieredCacheNamespace.name);
  private readonly l1 = new Map<string, L1Entry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();
  /** V6 1.7: 正在后台 refresh-ahead 的 key 集合，防止重复刷新 */
  private readonly refreshingKeys = new Set<string>();
  /** V6 1.7: 每个 key 对应的 factory（由 getOrSet 注册），用于 refresh-ahead 后台刷新 */
  private readonly refreshFactories = new Map<string, () => Promise<T>>();

  constructor(
    private readonly config: TieredCacheConfig,
    private readonly redis: RedisCacheService,
    /** V6.7: 跨实例广播回调，由 TieredCacheManager 注入 */
    private readonly broadcast: (msg: InvalidateMessage) => Promise<void>,
  ) {}

  /**
   * 获取缓存值（L1 → L2，不穿透）
   */
  async get(key: string): Promise<T | null> {
    // 1. L1 内存
    const l1Hit = this.getL1(key);
    if (l1Hit !== null) return l1Hit;

    // 2. L2 Redis
    const l2Hit = await this.getL2(key);
    if (l2Hit !== null) {
      // 回填 L1
      this.setL1(key, l2Hit);
      return l2Hit;
    }

    return null;
  }

  /**
   * 缓存穿透保护（L1 → L2 → factory，带 Singleflight）
   *
   * 同一 key 的并发请求只会执行一次 factory，其余等待共享结果。
   * V6 1.7: 同时注册 factory 用于 refresh-ahead 后台刷新。
   */
  async getOrSet(key: string, factory: () => Promise<T>): Promise<T> {
    // V6 1.7: 注册 factory 用于 refresh-ahead
    this.refreshFactories.set(key, factory);

    // 1. 尝试从缓存读取（refresh-ahead 在 getL1 中触发）
    const cached = await this.get(key);
    if (cached !== null) return cached;

    // 2. Singleflight — 防止缓存击穿
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.executeFactory(key, factory);
    this.inflight.set(key, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * 直接写入缓存（L1 + L2）
   */
  async set(key: string, value: T): Promise<void> {
    this.setL1(key, value);
    await this.setL2(key, value);
  }

  /**
   * 失效指定 key（L1 + L2 + 广播其他实例清 L1）
   *
   * V6.7: 增加 Redis PUBLISH，通知同 channel 的其他进程清对应 L1 entry。
   */
  async invalidate(key: string): Promise<void> {
    this.evictL1(key);
    const redisKey = this.buildRedisKey(key);
    await this.redis.del(redisKey);
    // 广播（失败时降级：其他实例靠 TTL 自然过期）
    await this.broadcast({ ns: this.config.namespace, key });
  }

  /**
   * 按前缀批量失效（L1 + L2 + 广播）
   */
  async invalidateAll(): Promise<void> {
    this.l1.clear();
    this.refreshFactories.clear();
    this.refreshingKeys.clear();
    await this.redis.delByPrefix(`${this.config.namespace}:`);
    await this.broadcast({ ns: this.config.namespace });
  }

  /**
   * 收到其他实例的失效广播时，仅清本地 L1（L2 已由广播发出方清理）
   */
  evictL1(key: string): void {
    this.l1.delete(key);
    this.refreshFactories.delete(key);
    this.refreshingKeys.delete(key);
  }

  evictAllL1(): void {
    this.l1.clear();
    this.refreshFactories.clear();
    this.refreshingKeys.clear();
  }

  /**
   * 获取 L1 缓存统计信息（调试用）
   */
  getStats(): {
    namespace: string;
    l1Size: number;
    l1MaxEntries: number;
    refreshingCount: number;
  } {
    return {
      namespace: this.config.namespace,
      l1Size: this.l1.size,
      l1MaxEntries: this.config.l1MaxEntries,
      refreshingCount: this.refreshingKeys.size,
    };
  }

  // ─── 私有方法 ───

  private getL1(key: string): T | null {
    const entry = this.l1.get(key);
    if (!entry) return null;
    const elapsed = Date.now() - entry.ts;
    if (elapsed > this.config.l1TtlMs) {
      this.l1.delete(key);
      return null;
    }
    // V6 1.7: Refresh-ahead — L1 命中但即将过期时，触发后台异步刷新
    const remaining = this.config.l1TtlMs - elapsed;
    if (
      this.config.refreshAheadMs &&
      remaining < this.config.refreshAheadMs &&
      !this.refreshingKeys.has(key)
    ) {
      this.backgroundRefresh(key);
    }
    // LRU: 删除后重新插入到 Map 末尾（最新位置）
    this.l1.delete(key);
    this.l1.set(key, entry);
    return entry.data;
  }

  /**
   * V6 1.7: 后台异步刷新（stale-while-revalidate）
   *
   * 使用已注册的 factory 重新加载数据并回填双层缓存。
   * fire-and-forget 模式，不阻塞当前请求。
   */
  private backgroundRefresh(key: string): void {
    const factory = this.refreshFactories.get(key);
    if (!factory) return;

    this.refreshingKeys.add(key);
    this.logger.debug(
      `[${this.config.namespace}] Refresh-ahead 开始: key=${key}`,
    );

    factory()
      .then(async (data) => {
        this.setL1(key, data);
        await this.setL2(key, data);
        this.logger.debug(
          `[${this.config.namespace}] Refresh-ahead 完成: key=${key}`,
        );
      })
      .catch((err) => {
        this.logger.warn(
          `[${this.config.namespace}] Refresh-ahead 失败: key=${key}, ${(err as Error).message}`,
        );
      })
      .finally(() => {
        this.refreshingKeys.delete(key);
      });
  }

  private setL1(key: string, data: T): void {
    // LRU 淘汰：到达上限时删除最早条目
    if (this.l1.size >= this.config.l1MaxEntries) {
      const oldest = this.l1.keys().next().value;
      if (oldest !== undefined) {
        this.l1.delete(oldest);
      }
    }
    this.l1.set(key, { data, ts: Date.now() });
  }

  private async getL2(key: string): Promise<T | null> {
    const redisKey = this.buildRedisKey(key);
    return this.redis.get<T>(redisKey);
  }

  private async setL2(key: string, data: T): Promise<void> {
    const redisKey = this.buildRedisKey(key);
    await this.redis.set(redisKey, data, this.config.l2TtlMs);
  }

  private buildRedisKey(key: string): string {
    return this.redis.buildKey(this.config.namespace, key);
  }

  private async executeFactory(
    key: string,
    factory: () => Promise<T>,
  ): Promise<T> {
    const data = await factory();
    // 回填双层缓存（异步写 L2，不阻塞返回）
    this.setL1(key, data);
    this.setL2(key, data).catch((err) => {
      this.logger.debug(
        `[${this.config.namespace}] L2 回填失败: ${key}, ${err}`,
      );
    });
    return data;
  }
}

/**
 * 统一缓存管理器
 *
 * 职责：
 * - 为各业务模块创建独立的 TieredCacheNamespace 实例（每个 namespace 独立 L1 + 共享 L2）
 * - 启动期订阅 Redis `cache:invalidate` channel，收到消息后清对应 namespace 的 L1
 */
@Injectable()
export class TieredCacheManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TieredCacheManager.name);
  private readonly namespaces = new Map<string, TieredCacheNamespace<any>>();
  private subscriber: Redis | null = null;

  constructor(private readonly redis: RedisCacheService) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.createSubscriber();
    if (!this.subscriber) {
      this.logger.warn(
        'Redis not available; L1 cross-instance invalidation disabled (TTL-based expiry only)',
      );
      return;
    }

    this.subscriber.on('message', (channel: string, message: string) => {
      if (channel !== CACHE_INVALIDATE_CHANNEL) return;
      try {
        const msg = JSON.parse(message) as InvalidateMessage;
        const ns = this.namespaces.get(msg.ns);
        if (!ns) return;
        if (msg.key !== undefined) {
          ns.evictL1(msg.key);
          this.logger.debug(
            `[cache:invalidate] L1 evicted: ns=${msg.ns}, key=${msg.key}`,
          );
        } else {
          ns.evictAllL1();
          this.logger.debug(`[cache:invalidate] L1 cleared: ns=${msg.ns}`);
        }
      } catch {
        // 忽略格式异常（其他服务误发）
      }
    });

    this.subscriber.on('error', (err: Error) => {
      this.logger.warn(`Cache invalidate subscriber error: ${err.message}`);
    });

    try {
      await this.subscriber.subscribe(CACHE_INVALIDATE_CHANNEL);
      this.logger.log(`Subscribed to Redis channel: ${CACHE_INVALIDATE_CHANNEL}`);
    } catch (err) {
      this.logger.warn(
        `Cache invalidate subscribe disabled: ${(err as Error).message}`,
      );
      this.subscriber.disconnect();
      this.subscriber = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(CACHE_INVALIDATE_CHANNEL);
        this.subscriber.disconnect();
      } catch {
        // ignore
      }
      this.subscriber = null;
    }
  }

  /**
   * 创建或获取一个缓存 namespace
   *
   * 同一 namespace 只会创建一次，重复调用返回已有实例。
   */
  createNamespace<T>(config: TieredCacheConfig): TieredCacheNamespace<T> {
    const existing = this.namespaces.get(config.namespace);
    if (existing) return existing as TieredCacheNamespace<T>;

    const broadcast = async (msg: InvalidateMessage): Promise<void> => {
      await this.redis.publish(CACHE_INVALIDATE_CHANNEL, JSON.stringify(msg));
    };

    const ns = new TieredCacheNamespace<T>(config, this.redis, broadcast);
    this.namespaces.set(config.namespace, ns);
    return ns;
  }

  /**
   * 获取所有 namespace 的缓存统计（Health Check / 调试用）
   */
  getAllStats(): Array<{
    namespace: string;
    l1Size: number;
    l1MaxEntries: number;
    refreshingCount: number;
  }> {
    return Array.from(this.namespaces.values()).map((ns) => ns.getStats());
  }
}
