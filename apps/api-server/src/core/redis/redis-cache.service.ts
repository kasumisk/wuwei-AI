import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

/**
 * Redis 缓存服务 (V4 Phase 3.9 → V5 Phase 1.5 增强)
 *
 * 职责：
 * - 管理 Redis 连接生命周期
 * - 提供 get/set/del 等基础操作
 * - setNX：分布式锁 / 幂等控制
 * - getOrSet：缓存穿透保护（cache-aside）
 * - buildKey：统一 key 命名空间，避免冲突
 * - Redis 不可用时优雅降级（所有操作返回 null / 不抛异常）
 *
 * 设计：
 * - 使用 redis v5 的 createClient
 * - 连接失败不阻塞应用启动
 * - 所有操作用 try/catch 包裹，降级为内存缓存 fallback（由调用方处理）
 */
@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: RedisClientType | null = null;
  private _isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  /** Redis 是否可用 */
  get isConnected(): boolean {
    return this._isConnected;
  }

  async onModuleInit(): Promise<void> {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    const host = this.configService.get<string>('REDIS_HOST');

    // 如果没有配置 Redis，跳过连接
    if (!redisUrl && !host) {
      this.logger.warn(
        'Redis not configured (REDIS_URL / REDIS_HOST missing). Running in memory-only mode.',
      );
      return;
    }

    try {
      const url =
        redisUrl ||
        `redis://${host}:${this.configService.get('REDIS_PORT', '6379')}`;

      this.client = createClient({
        url,
        password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
        database: parseInt(
          this.configService.get<string>('REDIS_DB') || '0',
          10,
        ),
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              this.logger.warn(
                'Redis reconnect limit reached. Falling back to memory cache.',
              );
              return new Error('Max retries reached');
            }
            return Math.min(retries * 500, 5000);
          },
        },
      }) as RedisClientType;

      this.client.on('error', (err: Error) => {
        if (this._isConnected) {
          this.logger.warn(`Redis connection error: ${err.message}`);
        }
        this._isConnected = false;
      });

      this.client.on('ready', () => {
        this._isConnected = true;
        this.logger.log('Redis connected successfully');
      });

      this.client.on('end', () => {
        this._isConnected = false;
      });

      await this.client.connect();
    } catch (err) {
      this.logger.warn(
        `Failed to connect to Redis: ${err}. Falling back to memory cache.`,
      );
      this.client = null;
      this._isConnected = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // Ignore disconnect errors
      }
    }
  }

  /**
   * 获取缓存值
   * @returns 反序列化后的值，或 null（未命中/Redis 不可用）
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this._isConnected || !this.client) return null;
    try {
      const raw = await this.client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.debug(`Redis GET failed for ${key}: ${err}`);
      return null;
    }
  }

  /**
   * 设置缓存值
   * @param ttlMs TTL 毫秒
   */
  async set(key: string, value: unknown, ttlMs: number): Promise<boolean> {
    if (!this._isConnected || !this.client) return false;
    try {
      const serialized = JSON.stringify(value);
      await this.client.set(key, serialized, { PX: ttlMs });
      return true;
    } catch (err) {
      this.logger.debug(`Redis SET failed for ${key}: ${err}`);
      return false;
    }
  }

  /**
   * 删除缓存
   */
  async del(key: string): Promise<boolean> {
    if (!this._isConnected || !this.client) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      this.logger.debug(`Redis DEL failed for ${key}: ${err}`);
      return false;
    }
  }

  /**
   * 按前缀批量删除
   */
  async delByPrefix(prefix: string): Promise<number> {
    if (!this._isConnected || !this.client) return 0;
    try {
      let deleted = 0;
      for await (const key of this.client.scanIterator({
        MATCH: `${prefix}*`,
        COUNT: 100,
      })) {
        await this.client.del(key);
        deleted++;
      }
      return deleted;
    } catch (err) {
      this.logger.debug(`Redis DEL by prefix failed for ${prefix}: ${err}`);
      return 0;
    }
  }

  // ==================== V5 Phase 1.5 新增 ====================

  /**
   * SET NX（仅当 key 不存在时设置）
   * 用于分布式锁 / 幂等控制
   *
   * @param key   缓存 key
   * @param value 值（会 JSON 序列化）
   * @param ttlMs 过期时间（毫秒）
   * @returns true = 获取锁成功（key 之前不存在）；false = 已存在或 Redis 不可用
   */
  async setNX(key: string, value: unknown, ttlMs: number): Promise<boolean> {
    if (!this._isConnected || !this.client) return false;
    try {
      const serialized = JSON.stringify(value);
      const result = await this.client.set(key, serialized, {
        PX: ttlMs,
        NX: true,
      });
      // redis SET NX 成功返回 'OK'，失败返回 null
      return result === 'OK';
    } catch (err) {
      this.logger.debug(`Redis SETNX failed for ${key}: ${err}`);
      return false;
    }
  }

  /**
   * 缓存穿透保护（cache-aside 模式）
   * 先尝试从缓存读取，未命中则调用 factory 生成值并写入缓存
   *
   * @param key     缓存 key
   * @param ttlMs   TTL 毫秒
   * @param factory 缓存未命中时的数据生成函数
   * @returns 缓存值或 factory 生成值
   */
  async getOrSet<T>(
    key: string,
    ttlMs: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    // 1. 尝试从缓存读取
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    // 2. 缓存未命中，调用 factory
    const value = await factory();

    // 3. 写入缓存（异步，不阻塞返回）
    this.set(key, value, ttlMs).catch(() => {
      // set 内部已有 try/catch + 日志，此处吞掉 Promise rejection
    });

    return value;
  }

  /**
   * 构建标准化缓存 key
   * 格式：namespace:segment1:segment2:...
   *
   * @example buildKey('diet', 'plan', userId, today) => 'diet:plan:abc-123:2026-04-10'
   */
  buildKey(namespace: string, ...segments: string[]): string {
    return [namespace, ...segments].join(':');
  }

  /**
   * 分布式锁保护的任务执行器（适用于 Cron 等需要防重复执行的场景）
   *
   * 工作方式：
   * 1. 使用 Redis setNX 尝试获取锁
   * 2. 获取成功 → 执行 fn，完成后释放锁
   * 3. 获取失败 → 说明其他实例正在执行，跳过本次
   * 4. 如果 Redis 不可用，降级为直接执行（单实例安全）
   *
   * @param lockName 锁名称（会自动加 cron_lock: 前缀）
   * @param ttlMs    锁过期时间（毫秒），应大于 fn 的最大执行时间
   * @param fn       要执行的异步任务
   * @returns true = 本次执行了任务；false = 被锁跳过
   */
  async runWithLock(
    lockName: string,
    ttlMs: number,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    const lockKey = this.buildKey('cron_lock', lockName);

    // Redis 不可用时降级为直接执行（单实例部署安全）
    if (!this._isConnected || !this.client) {
      this.logger.debug(`Redis 不可用，降级执行 Cron: ${lockName}`);
      await fn();
      return true;
    }

    const acquired = await this.setNX(
      lockKey,
      process.env.HOSTNAME || 'default',
      ttlMs,
    );
    if (!acquired) {
      this.logger.log(`Cron ${lockName} 已在其他实例执行中，跳过`);
      return false;
    }

    try {
      await fn();
      return true;
    } finally {
      // 任务完成后立即释放锁（不必等到过期）
      await this.del(lockKey);
    }
  }
}
