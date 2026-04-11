/**
 * V6.5 Phase 1G: RateLimitGuard — Redis 分布式限流
 *
 * 改动：从全局内存 Map 迁移到 Redis INCR 计数器，
 * 支持多实例部署下的精确限流。
 *
 * 降级策略：Redis 不可用时回退到内存 Map（单实例降级保护）。
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RedisCacheService } from '../../core/redis/redis-cache.service';

/** 内存降级 — Redis 不可用时的 fallback */
const memoryFallback = new Map<string, { count: number; resetAt: number }>();

/** 限流窗口（毫秒） */
const WINDOW_MS = 60 * 1000;

/** Redis key 前缀 */
const KEY_PREFIX = 'ratelimit:';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisCacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const client = request.client;
    const permission = request.permission;

    if (!client || !permission) {
      return true; // 无客户端信息时跳过限流
    }

    const rateLimit =
      permission.rateLimit || client.quotaConfig?.rateLimit || 60;
    const key = `${client.id}:${permission.capabilityType}`;

    // 优先使用 Redis
    if (this.redis.isConnected) {
      return this.checkWithRedis(key, rateLimit);
    }

    // 降级到内存
    return this.checkWithMemory(key, rateLimit);
  }

  /**
   * Redis 分布式限流：使用 INCR + TTL 实现固定窗口计数
   */
  private async checkWithRedis(key: string, limit: number): Promise<boolean> {
    const redisKey = `${KEY_PREFIX}${key}`;
    const count = await this.redis.incr(redisKey, WINDOW_MS);

    // Redis 返回 -1 表示操作失败，降级到内存
    if (count === -1) {
      return this.checkWithMemory(key, limit);
    }

    if (count > limit) {
      throw new HttpException(
        {
          success: false,
          code: HttpStatus.TOO_MANY_REQUESTS,
          message: `速率限制超出。最大允许 ${limit} 次/分钟`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * 内存降级限流：单实例级别的固定窗口计数
   */
  private checkWithMemory(key: string, limit: number): boolean {
    const now = Date.now();
    let record = memoryFallback.get(key);

    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + WINDOW_MS };
      memoryFallback.set(key, record);
    }

    if (record.count >= limit) {
      throw new HttpException(
        {
          success: false,
          code: HttpStatus.TOO_MANY_REQUESTS,
          message: `速率限制超出。最大允许 ${limit} 次/分钟`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    record.count++;
    return true;
  }
}
