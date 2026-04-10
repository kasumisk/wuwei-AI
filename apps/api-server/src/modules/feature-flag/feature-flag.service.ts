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
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisCacheService } from '../../core/redis/redis-cache.service';
import { FeatureFlag, FeatureFlagType } from './entities/feature-flag.entity';

/** Redis 缓存 key 前缀 */
const CACHE_PREFIX = 'ff';
/** 单个 flag 缓存 TTL: 30 秒 */
const FLAG_CACHE_TTL_MS = 30_000;
/** 全量 flag 列表缓存 TTL: 30 秒 */
const ALL_FLAGS_CACHE_TTL_MS = 30_000;
/** 全量 flag 列表缓存 key */
const ALL_FLAGS_CACHE_KEY = 'ff:__all__';

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(
    @InjectRepository(FeatureFlag)
    private readonly flagRepo: Repository<FeatureFlag>,
    private readonly redis: RedisCacheService,
  ) {}

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
        const percentage = flag.config?.percentage ?? 0;
        if (percentage >= 100) return true;
        if (percentage <= 0) return false;
        // 使用 userId + key 的哈希保证结果稳定
        const hash = this.stableHash(`${key}:${userId}`);
        return hash % 100 < percentage;
      }

      case FeatureFlagType.USER_LIST: {
        if (!userId) return false;
        const blacklist: string[] = flag.config?.blacklist ?? [];
        if (blacklist.includes(userId)) return false;
        const whitelist: string[] = flag.config?.whitelist ?? [];
        // 如果有白名单，只有在白名单中的用户才启用
        if (whitelist.length > 0) return whitelist.includes(userId);
        // 没有白名单配置，则所有非黑名单用户都启用
        return true;
      }

      case FeatureFlagType.SEGMENT: {
        if (!userSegment) return false;
        const segments: string[] = flag.config?.segments ?? [];
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
  async getAllFlags(): Promise<FeatureFlag[]> {
    // 先查缓存
    const cached = await this.redis.get<FeatureFlag[]>(ALL_FLAGS_CACHE_KEY);
    if (cached) return cached;

    const flags = await this.flagRepo.find({
      order: { createdAt: 'DESC' },
    });

    await this.redis.set(ALL_FLAGS_CACHE_KEY, flags, ALL_FLAGS_CACHE_TTL_MS);
    return flags;
  }

  /**
   * 创建或更新功能开关
   */
  async upsertFlag(
    data: Partial<FeatureFlag> & { key: string },
  ): Promise<FeatureFlag> {
    let flag = await this.flagRepo.findOne({ where: { key: data.key } });

    if (flag) {
      // 更新
      Object.assign(flag, data);
      flag = await this.flagRepo.save(flag);
      this.logger.log(`功能开关已更新: ${data.key}`);
    } else {
      // 创建
      flag = await this.flagRepo.save(this.flagRepo.create(data));
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
    await this.flagRepo.delete({ key });
    await this.invalidateCache(key);
    this.logger.log(`功能开关已删除: ${key}`);
  }

  // ==================== 私有方法 ====================

  /**
   * 获取单个 flag（带 Redis 缓存）
   */
  private async getFlag(key: string): Promise<FeatureFlag | null> {
    const cacheKey = this.redis.buildKey(CACHE_PREFIX, key);

    // 1. 查 Redis 缓存
    const cached = await this.redis.get<FeatureFlag>(cacheKey);
    if (cached) return cached;

    // 2. 查 DB
    const flag = await this.flagRepo.findOne({ where: { key } });
    if (!flag) return null;

    // 3. 写入缓存
    await this.redis.set(cacheKey, flag, FLAG_CACHE_TTL_MS);

    return flag;
  }

  /**
   * 清除 flag 相关缓存
   */
  private async invalidateCache(key: string): Promise<void> {
    const cacheKey = this.redis.buildKey(CACHE_PREFIX, key);
    await Promise.all([
      this.redis.del(cacheKey),
      this.redis.del(ALL_FLAGS_CACHE_KEY),
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
