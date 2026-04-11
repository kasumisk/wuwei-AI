/**
 * V6 Phase 1.5 — 功能开关服务
 *
 * 提供轻量级功能开关能力，支持灰度发布。
 *
 * 核心方法：
 * - isEnabled(key, userId?, userSegment?): 判断某功能开关对该用户是否启用
 * - getAllFlags(): 获取所有开关（Admin 用）
 * - upsertFlag(): 创建/更新开关
 * - deleteFlag(): 删除开关
 *
 * 缓存策略：
 * - 所有开关配置缓存到 Redis（30s TTL），避免每次查 DB
 * - 单个 flag 查询先查 Redis，miss 后查 DB 并写缓存
 * - 写操作后主动清除缓存
 *
 * 百分比放量算法：
 * - 使用 userId 的哈希值 mod 100 确定是否命中
 * - 保证同一用户对同一 flag 的结果稳定（不会每次请求结果不同）
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../core/cache/tiered-cache-manager';
import { PrismaService } from '../../core/prisma/prisma.service';
import { feature_flag } from '@prisma/client';

/** 功能开关类型 */
export enum FeatureFlagType {
  /** 全局开/关 */
  BOOLEAN = 'boolean',
  /** 百分比放量 */
  PERCENTAGE = 'percentage',
  /** 白名单/黑名单 */
  USER_LIST = 'user_list',
  /** 按用户画像段 */
  SEGMENT = 'segment',
}

/** Redis 缓存 namespace */
const CACHE_NAMESPACE = 'ff';
/** 单个 flag 缓存 TTL: 30 秒 */
const FLAG_CACHE_TTL_MS = 30_000;
/** 全量 flag 列表缓存 key */
const ALL_FLAGS_KEY = '__all__';

@Injectable()
export class FeatureFlagService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagService.name);

  /** V6.2 3.9: TieredCache namespace */
  private cache!: TieredCacheNamespace<any>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheManager: TieredCacheManager,
  ) {}

  onModuleInit(): void {
    this.cache = this.cacheManager.createNamespace<any>({
      namespace: CACHE_NAMESPACE,
      l1MaxEntries: 200,
      l1TtlMs: FLAG_CACHE_TTL_MS,
      l2TtlMs: FLAG_CACHE_TTL_MS,
    });
  }

  // ==================== 核心查询接口 ====================

  /**
   * 判断功能开关是否对指定用户启用
   *
   * @param key         功能开关 key
   * @param userId      用户 ID（百分比/白名单 判断需要）
   * @param userSegment 用户画像段标识（SEGMENT 类型需要）
   * @returns true = 功能可用
   */
  async isEnabled(
    key: string,
    userId?: string,
    userSegment?: string,
  ): Promise<boolean> {
    const flag = await this.getFlag(key);

    // flag 不存在或全局关闭
    if (!flag || !flag.enabled) return false;

    switch (flag.type) {
      case FeatureFlagType.BOOLEAN:
        // BOOLEAN 类型只看 enabled 字段
        return true;

      case FeatureFlagType.PERCENTAGE: {
        if (!userId) return false;
        const config = flag.config as Record<string, any>;
        const percentage = config?.percentage ?? 0;
        if (percentage >= 100) return true;
        if (percentage <= 0) return false;
        // 使用 userId + key 的哈希保证结果稳定
        const hash = this.stableHash(`${key}:${userId}`);
        return hash % 100 < percentage;
      }

      case FeatureFlagType.USER_LIST: {
        if (!userId) return false;
        const config = flag.config as Record<string, any>;
        const blacklist: string[] = config?.blacklist ?? [];
        if (blacklist.includes(userId)) return false;
        const whitelist: string[] = config?.whitelist ?? [];
        // 如果有白名单，只有在白名单中的用户才启用
        if (whitelist.length > 0) return whitelist.includes(userId);
        // 没有白名单配置，则所有非黑名单用户都启用
        return true;
      }

      case FeatureFlagType.SEGMENT: {
        if (!userSegment) return false;
        const config = flag.config as Record<string, any>;
        const segments: string[] = config?.segments ?? [];
        return segments.includes(userSegment);
      }

      default:
        return false;
    }
  }

  /**
   * 批量检查多个功能开关（减少网络往返）
   *
   * @returns Record<key, boolean>
   */
  async checkMultiple(
    keys: string[],
    userId?: string,
    userSegment?: string,
  ): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    // 并行查询所有 flag
    await Promise.all(
      keys.map(async (key) => {
        result[key] = await this.isEnabled(key, userId, userSegment);
      }),
    );
    return result;
  }

  // ==================== Admin CRUD ====================

  /**
   * 获取所有功能开关（Admin 列表页）
   */
  async getAllFlags(): Promise<feature_flag[]> {
    return this.cache.getOrSet(ALL_FLAGS_KEY, async () => {
      return this.prisma.feature_flag.findMany({
        orderBy: { created_at: 'desc' },
      });
    });
  }

  /**
   * 创建或更新功能开关
   */
  async upsertFlag(
    data: Partial<feature_flag> & { key: string },
  ): Promise<feature_flag> {
    let flag = await this.prisma.feature_flag.findUnique({
      where: { key: data.key },
    });

    if (flag) {
      // 更新
      flag = await this.prisma.feature_flag.update({
        where: { id: flag.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && {
            description: data.description,
          }),
          ...(data.type !== undefined && { type: data.type }),
          ...(data.enabled !== undefined && { enabled: data.enabled }),
          ...(data.config !== undefined && { config: data.config as any }),
        },
      });
      this.logger.log(`功能开关已更新: ${data.key}`);
    } else {
      // 创建
      flag = await this.prisma.feature_flag.create({
        data: {
          key: data.key,
          name: data.name!,
          description: data.description ?? null,
          type: data.type ?? FeatureFlagType.BOOLEAN,
          enabled: data.enabled ?? false,
          config: (data.config as any) ?? {},
        },
      });
      this.logger.log(`功能开关已创建: ${data.key}`);
    }

    // 清除缓存
    await this.invalidateCache(data.key);

    return flag;
  }

  /**
   * 删除功能开关
   */
  async deleteFlag(key: string): Promise<void> {
    await this.prisma.feature_flag.delete({ where: { key } });
    await this.invalidateCache(key);
    this.logger.log(`功能开关已删除: ${key}`);
  }

  // ==================== 私有方法 ====================

  /**
   * 获取单个 flag（带 Redis 缓存）
   */
  private async getFlag(key: string): Promise<feature_flag | null> {
    // 使用 getOrSet：L1 → L2 → DB 穿透
    // 注意：getOrSet 不区分 null 值，所以 flag 不存在时仍会重复查询 DB
    // 但 30s TTL 足够短，影响可忽略
    const cached = await this.cache.get(key);
    if (cached) return cached as feature_flag;

    const flag = await this.prisma.feature_flag.findUnique({ where: { key } });
    if (!flag) return null;

    await this.cache.set(key, flag);
    return flag;
  }

  /**
   * 清除 flag 相关缓存
   */
  private async invalidateCache(key: string): Promise<void> {
    await Promise.all([
      this.cache.invalidate(key),
      this.cache.invalidate(ALL_FLAGS_KEY),
    ]);
  }

  /**
   * 稳定哈希算法（百分比放量用）
   *
   * 使用简单的字符串哈希，保证相同输入始终返回相同结果。
   * 不需要加密安全性，只需要均匀分布。
   */
  private stableHash(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0; // 等价于 hash * 31 + char
    }
    return Math.abs(hash);
  }
}
