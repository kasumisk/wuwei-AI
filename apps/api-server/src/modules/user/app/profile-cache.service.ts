import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from '../entities/user-profile.entity';
import { UserBehaviorProfile } from '../entities/user-behavior-profile.entity';
import { UserInferredProfile } from '../entities/user-inferred-profile.entity';

/**
 * 三层画像聚合结果
 */
export interface FullUserProfile {
  declared: UserProfile | null;
  observed: UserBehaviorProfile | null;
  inferred: UserInferredProfile | null;
}

interface CacheEntry {
  data: FullUserProfile;
  expireAt: number;
}

/**
 * 用户画像缓存层
 * 推荐引擎每次调用都需要画像数据，缓存避免重复查询
 *
 * TTL 策略：
 * - 声明数据 5 分钟（用户修改不频繁）
 * - Profile 更新时主动失效
 */
@Injectable()
export class ProfileCacheService {
  private readonly logger = new Logger(ProfileCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();

  /** 默认缓存 TTL: 5 分钟 */
  private readonly DEFAULT_TTL = 5 * 60 * 1000;

  /** 缓存容量上限（防止内存泄漏） */
  private readonly MAX_ENTRIES = 5000;

  constructor(
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    @InjectRepository(UserBehaviorProfile)
    private readonly behaviorRepo: Repository<UserBehaviorProfile>,
    @InjectRepository(UserInferredProfile)
    private readonly inferredRepo: Repository<UserInferredProfile>,
  ) {}

  /**
   * 获取完整画像（优先缓存）
   */
  async getFullProfile(userId: string): Promise<FullUserProfile> {
    const cached = this.cache.get(userId);
    if (cached && cached.expireAt > Date.now()) {
      return cached.data;
    }

    const [declared, observed, inferred] = await Promise.all([
      this.profileRepo.findOne({ where: { userId } }),
      this.behaviorRepo.findOne({ where: { userId } }),
      this.inferredRepo.findOne({ where: { userId } }),
    ]);

    const full: FullUserProfile = { declared, observed, inferred };

    // 淘汰策略：超出容量时清理过期条目
    if (this.cache.size >= this.MAX_ENTRIES) {
      this.evictExpired();
    }

    this.cache.set(userId, {
      data: full,
      expireAt: Date.now() + this.DEFAULT_TTL,
    });

    return full;
  }

  /**
   * 获取用于推荐引擎的用户约束（便捷方法）
   */
  async getUserConstraints(userId: string): Promise<
    | {
        dietaryRestrictions: string[];
        weakTimeSlots: string[];
        discipline: string;
        allergens: string[];
        healthConditions: string[];
      }
    | undefined
  > {
    const { declared } = await this.getFullProfile(userId);
    if (!declared) return undefined;

    return {
      dietaryRestrictions: declared.dietaryRestrictions || [],
      weakTimeSlots: declared.weakTimeSlots || [],
      discipline: declared.discipline || 'medium',
      allergens: declared.allergens || [],
      healthConditions: declared.healthConditions || [],
    };
  }

  /**
   * Profile 更新时清除缓存
   */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /**
   * 批量失效（Cron 任务后调用）
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计（监控用）
   */
  getStats(): { size: number; maxSize: number } {
    return { size: this.cache.size, maxSize: this.MAX_ENTRIES };
  }

  /**
   * 清理过期条目
   */
  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.cache) {
      if (entry.expireAt <= now) {
        this.cache.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.debug(`缓存清理: 淘汰 ${evicted} 条过期条目`);
    }
  }
}
