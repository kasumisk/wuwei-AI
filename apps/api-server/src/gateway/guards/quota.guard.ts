/**
 * V6.5 Phase 1G: QuotaGuard — Redis 分布式配额缓存
 *
 * 改动：从全局内存 Map 迁移到 RedisCacheService，
 * 支持多实例部署下的配额共享和一致性。
 *
 * 降级策略：Redis 不可用时回退到内存 Map（单实例降级保护）。
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisCacheService } from '../../core/redis/redis-cache.service';

/** 内存降级缓存 */
const memoryFallback = new Map<string, { value: number; expiresAt: number }>();

/** 缓存 TTL 常量 */
const DAILY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const MONTHLY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const CAPABILITY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

/** Redis key 前缀 */
const KEY_PREFIX = 'quota:';

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const client = request.client;
    const permission = request.permission;
    const capabilityType = request.capabilityType;

    // 1. 检查 Client 级别的成本配额（美元）
    if (client?.quotaConfig) {
      const { dailyQuota, monthlyQuota } = client.quotaConfig;

      // 检查日配额
      if (dailyQuota && dailyQuota > 0) {
        const dailyUsage = await this.getDailyCostUsage(client.id);
        if (dailyUsage >= dailyQuota) {
          throw new ForbiddenException(
            `已超出日成本配额 $${dailyQuota}（已使用: $${dailyUsage.toFixed(2)}）`,
          );
        }
      }

      // 检查月配额
      if (monthlyQuota && monthlyQuota > 0) {
        const monthlyUsage = await this.getMonthlyCostUsage(client.id);
        if (monthlyUsage >= monthlyQuota) {
          throw new ForbiddenException(
            `已超出月成本配额 $${monthlyQuota}（已使用: $${monthlyUsage.toFixed(2)}）`,
          );
        }
      }
    }

    // 2. 检查 Permission 级别的使用量配额（token/图片数）
    if (permission?.quotaLimit && capabilityType) {
      const usage = await this.getCapabilityUsage(client.id, capabilityType);
      if (usage >= permission.quotaLimit) {
        throw new ForbiddenException(
          `${capabilityType} 能力已超出配额限制（${permission.quotaLimit.toLocaleString()}）`,
        );
      }
    }

    // 3. 检查单次请求成本限制（预估）
    if (permission?.config?.costLimit) {
      const estimatedCost = this.estimateRequestCost(
        request.body,
        capabilityType,
      );
      if (estimatedCost > permission.config.costLimit) {
        throw new ForbiddenException(
          `预估成本 $${estimatedCost.toFixed(4)} 超过单次限制 $${permission.config.costLimit}`,
        );
      }
    }

    return true;
  }

  /**
   * 统一缓存读取 — 优先 Redis，降级内存
   */
  private async getCached(key: string): Promise<number | null> {
    // Redis 优先
    if (this.redis.isConnected) {
      const val = await this.redis.get<number>(`${KEY_PREFIX}${key}`);
      if (val !== null) return val;
    }

    // 内存降级
    const now = Date.now();
    const cached = memoryFallback.get(key);
    if (cached && now < cached.expiresAt) {
      return cached.value;
    }

    return null;
  }

  /**
   * 统一缓存写入 — 双写 Redis + 内存
   */
  private async setCached(
    key: string,
    value: number,
    ttlMs: number,
  ): Promise<void> {
    // Redis 写入
    if (this.redis.isConnected) {
      await this.redis.set(`${KEY_PREFIX}${key}`, value, ttlMs);
    }

    // 内存也写一份（作为 fallback + L1）
    memoryFallback.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * 获取客户端今日成本使用额度
   */
  private async getDailyCostUsage(clientId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const cacheKey = `daily_cost:${clientId}:${today.toISOString().split('T')[0]}`;
    const cached = await this.getCached(cacheKey);
    if (cached !== null) return cached;

    const result = await this.prisma.$queryRaw<[{ total: string | null }]>(
      Prisma.sql`SELECT SUM(cost) as total FROM usage_records WHERE client_id = ${clientId} AND timestamp >= ${today} AND timestamp < ${tomorrow}`,
    );

    const total = parseFloat(result?.[0]?.total ?? '') || 0;
    await this.setCached(cacheKey, total, DAILY_CACHE_TTL_MS);

    return total;
  }

  /**
   * 获取客户端本月成本使用额度
   */
  private async getMonthlyCostUsage(clientId: string): Promise<number> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const cacheKey = `monthly_cost:${clientId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const cached = await this.getCached(cacheKey);
    if (cached !== null) return cached;

    const result = await this.prisma.$queryRaw<[{ total: string | null }]>(
      Prisma.sql`SELECT SUM(cost) as total FROM usage_records WHERE client_id = ${clientId} AND timestamp >= ${monthStart} AND timestamp < ${monthEnd}`,
    );

    const total = parseFloat(result?.[0]?.total ?? '') || 0;
    await this.setCached(cacheKey, total, MONTHLY_CACHE_TTL_MS);

    return total;
  }

  /**
   * 获取能力级别的使用量（token 数或图片数）
   */
  private async getCapabilityUsage(
    clientId: string,
    capabilityType: string,
  ): Promise<number> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const cacheKey = `capability:${clientId}:${capabilityType}:${now.getFullYear()}-${now.getMonth() + 1}`;
    const cached = await this.getCached(cacheKey);
    if (cached !== null) return cached;

    let total = 0;

    if (capabilityType.startsWith('text.')) {
      const result = await this.prisma.$queryRaw<[{ total: string | null }]>(
        Prisma.sql`SELECT SUM(CAST(usage->>'totalTokens' AS INTEGER)) as total FROM usage_records WHERE client_id = ${clientId} AND capability_type = ${capabilityType} AND timestamp >= ${monthStart}`,
      );
      total = parseInt(result?.[0]?.total ?? '') || 0;
    } else if (capabilityType.startsWith('image.')) {
      const result = await this.prisma.$queryRaw<[{ total: string | null }]>(
        Prisma.sql`SELECT SUM(CAST(usage->>'imageCount' AS INTEGER)) as total FROM usage_records WHERE client_id = ${clientId} AND capability_type = ${capabilityType} AND timestamp >= ${monthStart}`,
      );
      total = parseInt(result?.[0]?.total ?? '') || 0;
    }

    await this.setCached(cacheKey, total, CAPABILITY_CACHE_TTL_MS);

    return total;
  }

  /**
   * 预估请求成本
   */
  private estimateRequestCost(body: any, capabilityType?: string): number {
    if (capabilityType?.startsWith('text.')) {
      const maxTokens = body.maxTokens || 1000;
      const promptLength = (body.prompt || '').length;
      const estimatedInputTokens = Math.ceil(promptLength / 4);
      return ((estimatedInputTokens + maxTokens) / 1000) * 0.01;
    } else if (capabilityType?.startsWith('image.')) {
      const count = body.n || 1;
      return count * 0.04;
    }
    return 0;
  }
}
