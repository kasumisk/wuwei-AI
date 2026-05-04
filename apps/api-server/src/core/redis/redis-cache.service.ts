import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { resolveRedisOptions } from './redis-options';

/**
 * Redis 缓存服务 (V6.7 ioredis)
 *
 * 职责：
 * - 管理 Redis 连接生命周期（ioredis 内置重连）
 * - 提供 get/set/del 等基础操作
 * - setNX：分布式锁 / 幂等控制
 * - getOrSet：缓存穿透保护（cache-aside）
 * - buildKey：统一 key 命名空间
 * - Redis 不可用时优雅降级（所有操作返回 null / 不抛异常）
 * - getClient()：暴露原生 ioredis 实例，供 ThrottlerStorageRedis 使用
 *
 * 关键设计：
 * - isReady getter 检查 client.status === 'ready'，非 ready 状态直接跳过
 *   所有 Redis 操作，避免命令在 reconnecting 期间无限排队等待。
 * - enableOfflineQueue: false — offline 状态命令直接报错走降级。
 * - reconnecting 事件 → _isConnected = false，isReady 返回 false。
 */
@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis | null = null;
  private _isConnected = false;
  private _isConfigured = false;
  /** 应用层 keepalive timer，每 20s ping 一次防止 Upstash 空闲断连 */
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * 缓存 key 版本号后缀（CACHE_VERSION 环境变量，默认 'v1'）
   * 滚动部署时修改版本号，所有旧 key 自动失效（无需手动 FLUSHDB）。
   * 格式：{namespace}:{key}:{version} → 例如 sub_user:uid123:v2
   */
  private readonly cacheVersion: string;

  constructor(private readonly configService: ConfigService) {
    this.cacheVersion = configService.get<string>('CACHE_VERSION') || 'v1';

    // ─── 在构造函数中立即初始化 ioredis 客户端 ───────────────────────────
    // 原因：ThrottlerModule.forRootAsync 的 useFactory 在依赖注入阶段（模块
    // 实例化时）同步执行，早于 onModuleInit。若在 onModuleInit 才创建 client，
    // useFactory 读到的 client 永远是 null，ThrottlerModule 始终使用内存存储。
    const opts = resolveRedisOptions(this.configService, 'CACHE');
    if (!opts) {
      return; // 未配置 Redis，onModuleInit 打印 warn
    }

    this.logger.log(`Redis (cache) using config from: ${opts.source}`);

    const SHARED_OPTS = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 5000,
      commandTimeout: 2000,
      keepAlive: 15000,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      retryStrategy: this.buildRetryStrategy(),
    };

    if (opts.url) {
      this.client = new Redis(opts.url, SHARED_OPTS);
    } else {
      this.client = new Redis({
        host: opts.host,
        port: opts.port,
        password: opts.password,
        username: opts.username,
        db: opts.db,
        ...(opts.tls ? { tls: {} } : {}),
        ...SHARED_OPTS,
      });
    }

    this._isConfigured = true;

    this.client.on('error', (err: Error) => {
      if (this._isConnected) {
        this.logger.warn(`Redis connection error: ${err.message}`);
      }
      this._isConnected = false;
      this.stopKeepalive();
    });

    this.client.on('reconnecting', () => {
      // reconnecting 期间命令会在 ioredis 内部排队，即使 enableOfflineQueue:false
      // 也无法阻止。通过 _isConnected=false + isReady 检查确保所有操作直接跳过。
      this._isConnected = false;
    });

    this.client.on('ready', () => {
      this._isConnected = true;
      this.logger.log('Redis connected successfully (ioredis)');
      this.startKeepalive();
    });

    this.client.on('end', () => {
      this._isConnected = false;
      this.stopKeepalive();
    });
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get isConfigured(): boolean {
    return this._isConfigured;
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) {
      this.logger.warn(
        'Redis not configured (CACHE_REDIS_URL / REDIS_URL / REDIS_HOST missing). Running in memory-only mode.',
      );
      return;
    }

    try {
      await this.client.ping();
      this._isConnected = true;
    } catch (err) {
      this.logger.warn(
        `Redis ping failed at startup: ${err}. Will retry in background (retryStrategy active).`,
      );
      this._isConnected = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopKeepalive();
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        // ignore
      }
    }
  }

  /** 每 20s 发一次 PING，防止空闲断连 */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.client && this._isConnected) {
        this.client.ping().catch(() => {});
      }
    }, 20_000);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  /**
   * 暴露原生 ioredis 实例，供 ThrottlerModule 使用。
   */
  getClient(): Redis {
    if (!this.client) {
      throw new Error(
        'Redis client is not initialized. Check CACHE_REDIS_URL / REDIS_URL / REDIS_HOST configuration.',
      );
    }
    return this.client;
  }

  /**
   * Redis 客户端是否处于可用状态（ready）。
   * 除 ready 之外的所有状态（connecting/reconnecting/end 等）均视为不可用，
   * 直接跳过 Redis 操作，避免命令在 ioredis 内部队列中无限等待。
   */
  private get isReady(): boolean {
    return this._isConnected && !!this.client && this.client.status === 'ready';
  }

  /** 给 ioredis 命令加 deadline 保护 */
  private withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  }

  // ─── 核心读写 ─────────────────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    if (!this.isReady) return null;
    try {
      const raw = await this.withTimeout(this.client!.get(key), 800, null);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.debug(`Redis GET failed for ${key}: ${err}`);
      return null;
    }
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    if (!this.isReady || keys.length === 0) {
      return keys.map(() => null);
    }
    try {
      const raws = await this.withTimeout(
        this.client!.mget(...keys),
        800,
        keys.map(() => null),
      );
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

  async set(key: string, value: unknown, ttlMs: number): Promise<boolean> {
    if (!this.isReady) return false;
    try {
      const serialized = JSON.stringify(value);
      await this.withTimeout(
        this.client!.set(key, serialized, 'PX', ttlMs),
        800,
        null,
      );
      return true;
    } catch (err) {
      this.logger.debug(`Redis SET failed for ${key}: ${err}`);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.isReady) return false;
    try {
      await this.client!.del(key);
      return true;
    } catch (err) {
      this.logger.debug(`Redis DEL failed for ${key}: ${err}`);
      return false;
    }
  }

  async delByPrefix(prefix: string): Promise<number> {
    if (!this.isReady) return 0;
    try {
      let deleted = 0;
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.client!.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client!.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');
      return deleted;
    } catch (err) {
      this.logger.debug(`Redis DEL by prefix failed for ${prefix}: ${err}`);
      return 0;
    }
  }

  async setNX(key: string, value: unknown, ttlMs: number): Promise<boolean> {
    if (!this.isReady) return false;
    try {
      const serialized = JSON.stringify(value);
      const result = await this.client!.set(key, serialized, 'PX', ttlMs, 'NX');
      return result === 'OK';
    } catch (err) {
      this.logger.debug(`Redis SETNX failed for ${key}: ${err}`);
      return false;
    }
  }

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

  buildKey(namespace: string, ...segments: string[]): string {
    return [namespace, ...segments, this.cacheVersion].join(':');
  }

  async runWithLock(
    lockName: string,
    ttlMs: number,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    const lockKey = this.buildKey('cron_lock', lockName);
    if (!this.isReady) {
      this.logger.debug(`Redis 不可用，降级执行 Cron: ${lockName}`);
      await fn();
      return true;
    }
    const acquired = await this.setNX(lockKey, process.env.HOSTNAME || 'default', ttlMs);
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

  // ─── Hash 操作 ────────────────────────────────────────────────────────────

  async hIncrBy(key: string, field: string, increment = 1): Promise<number | null> {
    if (!this.isReady) return null;
    try {
      return await this.client!.hincrby(key, field, increment);
    } catch (err) {
      this.logger.debug(`Redis HINCRBY failed for ${key}:${field}: ${err}`);
      return null;
    }
  }

  async hGetAll(key: string): Promise<Record<string, string> | null> {
    if (!this.isReady) return null;
    try {
      const result = await this.client!.hgetall(key);
      return result || {};
    } catch (err) {
      this.logger.debug(`Redis HGETALL failed for ${key}: ${err}`);
      return null;
    }
  }

  async hSet(key: string, field: string, value: string): Promise<boolean> {
    if (!this.isReady) return false;
    try {
      await this.client!.hset(key, field, value);
      return true;
    } catch (err) {
      this.logger.debug(`Redis HSET failed for ${key}:${field}: ${err}`);
      return false;
    }
  }

  async hMSet(key: string, fields: Record<string, string>): Promise<boolean> {
    if (!this.isReady) return false;
    if (Object.keys(fields).length === 0) return true;
    try {
      await this.client!.hset(key, fields);
      return true;
    } catch (err) {
      this.logger.debug(`Redis HMSET failed for ${key}: ${err}`);
      return false;
    }
  }

  async expireNX(key: string, ttlMs: number): Promise<boolean> {
    if (!this.isReady) return false;
    try {
      const result = await this.client!.eval(
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

  async incr(key: string, ttlMs?: number): Promise<number> {
    if (!this.isReady) return -1;
    try {
      const result = await this.client!.incr(key);
      if (result === 1 && ttlMs && ttlMs > 0) {
        await this.client!.pexpire(key, ttlMs);
      }
      return result;
    } catch (err) {
      this.logger.debug(`Redis INCR failed for ${key}: ${err}`);
      return -1;
    }
  }

  // ─── Pub/Sub ──────────────────────────────────────────────────────────────

  async publish(channel: string, message: string): Promise<void> {
    if (!this.isReady) return;
    try {
      await this.client!.publish(channel, message);
    } catch (err) {
      this.logger.debug(`Redis PUBLISH failed on ${channel}: ${err}`);
    }
  }

  createSubscriber(): Redis | null {
    if (!this.client) return null;
    try {
      return this.client.duplicate();
    } catch (err) {
      this.logger.warn(`Failed to create Redis subscriber: ${err}`);
      return null;
    }
  }

  // ─── 私有工具 ─────────────────────────────────────────────────────────────

  private buildRetryStrategy() {
    return (times: number): number | null => {
      if (times > 10) {
        this.logger.warn(
          'Redis reconnect limit reached. Falling back to memory cache.',
        );
        return null;
      }
      return Math.min(times * 500, 5000);
    };
  }
}
