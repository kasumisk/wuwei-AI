import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis 缓存服务 (V6.6 Phase 1-B: node-redis → ioredis 迁移)
 *
 * 职责：
 * - 管理 Redis 连接生命周期（ioredis 内置重连）
 * - 提供 get/set/del 等基础操作（API 与 V6.5 完全兼容）
 * - setNX：分布式锁 / 幂等控制
 * - getOrSet：缓存穿透保护（cache-aside）
 * - buildKey：统一 key 命名空间，避免冲突
 * - Redis 不可用时优雅降级（所有操作返回 null / 不抛异常）
 * - getClient()：暴露原生 ioredis 实例，供 ThrottlerStorageRedis 使用
 *
 * 迁移说明（V6.5 → V6.6）:
 * - 底层从 node-redis v5 换为 ioredis（支持连接池 / BullMQ 兼容）
 * - ioredis API 差异：
 *   - node-redis: client.set(key, val, { PX: ms })
 *   - ioredis:    client.set(key, val, 'PX', ms)
 *   - node-redis: client.pExpire(key, ms, 'NX')
 *   - ioredis:    client.pexpire(key, ms)（无 NX 选项，用 Lua 脚本实现）
 *   - hGetAll 对不存在 key 返回 {} (node-redis) vs {} (ioredis) — 一致
 * - 所有原有公共方法签名不变，调用方零修改
 */
@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis | null = null;
  private _isConnected = false;
  /**
   * V6.7 P1-6: 缓存 key 版本号后缀
   *
   * 通过 CACHE_VERSION 环境变量控制（默认 'v1'）。
   * 滚动部署时修改版本号，所有旧 key 自动失效（无需手动 FLUSHDB）。
   * 格式：{namespace}:{key}:{version} → 例如 sub_user:uid123:v2
   */
  private readonly cacheVersion: string;

  constructor(private readonly configService: ConfigService) {
    this.cacheVersion = configService.get<string>('CACHE_VERSION') || 'v1';
  }

  /** Redis 是否可用 */
  get isConnected(): boolean {
    return this._isConnected;
  }

  async onModuleInit(): Promise<void> {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    const host = this.configService.get<string>('REDIS_HOST');

    if (!redisUrl && !host) {
      this.logger.warn(
        'Redis not configured (REDIS_URL / REDIS_HOST missing). Running in memory-only mode.',
      );
      return;
    }

    try {
      const password =
        this.configService.get<string>('REDIS_PASSWORD') || undefined;
      const db = parseInt(
        this.configService.get<string>('REDIS_DB') || '0',
        10,
      );

      if (redisUrl) {
        // URL 模式：直接传给 ioredis（支持 redis:// 和 rediss://）
        this.client = new Redis(redisUrl, {
          password,
          db,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
          connectTimeout: 5000,
          commandTimeout: 2000,
          retryStrategy: this.buildRetryStrategy(),
        });
      } else {
        // Host/Port 模式
        this.client = new Redis({
          host: host!,
          port: parseInt(
            this.configService.get<string>('REDIS_PORT') || '6379',
            10,
          ),
          password,
          db,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
          connectTimeout: 5000,
          commandTimeout: 2000,
          retryStrategy: this.buildRetryStrategy(),
        });
      }

      this.client.on('error', (err: Error) => {
        if (this._isConnected) {
          this.logger.warn(`Redis connection error: ${err.message}`);
        }
        this._isConnected = false;
      });

      this.client.on('ready', () => {
        this._isConnected = true;
        this.logger.log('Redis connected successfully (ioredis)');
      });

      this.client.on('end', () => {
        this._isConnected = false;
      });

      // ioredis connects automatically; wait for 'ready' via ping
      await this.client.ping();
      this._isConnected = true;
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
        this.client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
  }

  /**
   * 暴露原生 ioredis 实例
   * 用于 nestjs-throttler-storage-redis 及其他需要原生客户端的模块
   *
   * @throws Error 如果 Redis 未配置
   */
  getClient(): Redis {
    if (!this.client) {
      throw new Error(
        'Redis client is not initialized. Check REDIS_URL / REDIS_HOST configuration.',
      );
    }
    return this.client;
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
   * V6.2 Phase 2.13: 批量获取缓存值
   * 使用 Redis MGET 命令一次网络往返获取多个 key
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    if (!this._isConnected || !this.client || keys.length === 0) {
      return keys.map(() => null);
    }
    try {
      const raws = await this.client.mget(...keys);
      return raws.map((raw) => {
        if (raw === null || raw === undefined) return null;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return null;
        }
      });
    } catch (err) {
      this.logger.debug(`Redis MGET failed for ${keys.length} keys: ${err}`);
      return keys.map(() => null);
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
      // ioredis: set(key, value, 'PX', milliseconds)
      await this.client.set(key, serialized, 'PX', ttlMs);
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
   * 按前缀批量删除（使用 SCAN 迭代，避免 KEYS 阻塞）
   */
  async delByPrefix(prefix: string): Promise<number> {
    if (!this._isConnected || !this.client) return 0;
    try {
      let deleted = 0;
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');
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
   */
  async setNX(key: string, value: unknown, ttlMs: number): Promise<boolean> {
    if (!this._isConnected || !this.client) return false;
    try {
      const serialized = JSON.stringify(value);
      // ioredis: set(key, value, 'PX', ms, 'NX')
      const result = await this.client.set(key, serialized, 'PX', ttlMs, 'NX');
      // ioredis: 成功返回 'OK'，失败（key 已存在）返回 null
      return result === 'OK';
    } catch (err) {
      this.logger.debug(`Redis SETNX failed for ${key}: ${err}`);
      return false;
    }
  }

  /**
   * 缓存穿透保护（cache-aside 模式）
   */
  async getOrSet<T>(
    key: string,
    ttlMs: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();

    this.set(key, value, ttlMs).catch(() => {});

    return value;
  }

  /**
   * 构建标准化缓存 key
   * 格式：namespace:segment1:segment2:...:version
   * V6.7 P1-6: 自动追加 CACHE_VERSION 后缀，滚动部署时一键失效旧缓存
   */
  buildKey(namespace: string, ...segments: string[]): string {
    return [namespace, ...segments, this.cacheVersion].join(':');
  }

  /**
   * 分布式锁保护的任务执行器（适用于 Cron 等需要防重复执行的场景）
   */
  async runWithLock(
    lockName: string,
    ttlMs: number,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    const lockKey = this.buildKey('cron_lock', lockName);

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
      await this.del(lockKey);
    }
  }

  // ==================== V6.3 P1-7: Hash 原子操作 ====================

  /**
   * 原子递增 Hash 字段（HINCRBY）
   */
  async hIncrBy(
    key: string,
    field: string,
    increment = 1,
  ): Promise<number | null> {
    if (!this._isConnected || !this.client) return null;
    try {
      return await this.client.hincrby(key, field, increment);
    } catch (err) {
      this.logger.debug(`Redis HINCRBY failed for ${key}:${field}: ${err}`);
      return null;
    }
  }

  /**
   * 获取 Hash 所有字段（HGETALL）
   * ioredis: 不存在的 key 返回 {} (empty object)
   */
  async hGetAll(key: string): Promise<Record<string, string> | null> {
    if (!this._isConnected || !this.client) return null;
    try {
      const result = await this.client.hgetall(key);
      // ioredis returns {} for non-existent key (same as node-redis)
      return result || {};
    } catch (err) {
      this.logger.debug(`Redis HGETALL failed for ${key}: ${err}`);
      return null;
    }
  }

  /**
   * 设置 Hash 中一个字段的值（HSET）
   */
  async hSet(key: string, field: string, value: string): Promise<boolean> {
    if (!this._isConnected || !this.client) return false;
    try {
      await this.client.hset(key, field, value);
      return true;
    } catch (err) {
      this.logger.debug(`Redis HSET failed for ${key}:${field}: ${err}`);
      return false;
    }
  }

  /**
   * 设置 key 过期时间（如果尚未设置）
   *
   * V6.6 注意：ioredis 的 pexpire 不支持 NX 选项（需 Redis 7.0+）。
   * 此处用 Lua 脚本实现幂等：仅当 TTL = -1（无过期）时才设置。
   */
  async expireNX(key: string, ttlMs: number): Promise<boolean> {
    if (!this._isConnected || !this.client) return false;
    try {
      // Lua: 仅当 key 存在且无过期时间时设置 pexpire
      const result = await this.client.eval(
        `local ttl = redis.call('PTTL', KEYS[1])
         if ttl == -1 then
           return redis.call('PEXPIRE', KEYS[1], ARGV[1])
         end
         return 0`,
        1,
        key,
        ttlMs.toString(),
      );
      return result === 1;
    } catch (err) {
      this.logger.debug(`Redis expireNX failed for ${key}: ${err}`);
      return false;
    }
  }

  /**
   * V6.5 Phase 1G: 原子递增计数器
   */
  async incr(key: string, ttlMs?: number): Promise<number> {
    if (!this._isConnected || !this.client) return -1;
    try {
      const result = await this.client.incr(key);
      if (result === 1 && ttlMs && ttlMs > 0) {
        await this.client.pexpire(key, ttlMs);
      }
      return result;
    } catch (err) {
      this.logger.debug(`Redis INCR failed for ${key}: ${err}`);
      return -1;
    }
  }

  /**
   * V6.7: Pub/Sub — 发布消息到指定 channel（用于跨实例缓存失效通知）
   * 失败时静默降级（Redis 不可用时 L1 靠 TTL 自然过期）
   */
  async publish(channel: string, message: string): Promise<void> {
    if (!this._isConnected || !this.client) return;
    try {
      await this.client.publish(channel, message);
    } catch (err) {
      this.logger.debug(`Redis PUBLISH failed on ${channel}: ${err}`);
    }
  }

  /**
   * V6.7: 创建独立的 subscriber 连接（ioredis 要求 sub 连接不混用命令）
   * 调用方负责监听 'message' 事件并在模块销毁时 disconnect()。
   * 返回 null 表示 Redis 未配置或不可用。
   */
  createSubscriber(): Redis | null {
    if (!this.client) return null;
    try {
      return this.client.duplicate();
    } catch (err) {
      this.logger.warn(`Failed to create Redis subscriber: ${err}`);
      return null;
    }
  }

  // ==================== 私有方法 ====================

  /**
   * ioredis 重连策略（指数退避，最大 10 次）
   */
  private buildRetryStrategy() {
    return (times: number): number | null => {
      if (times > 10) {
        this.logger.warn(
          'Redis reconnect limit reached. Falling back to memory cache.',
        );
        return null; // ioredis: return null to stop retrying
      }
      return Math.min(times * 500, 5000);
    };
  }
}
