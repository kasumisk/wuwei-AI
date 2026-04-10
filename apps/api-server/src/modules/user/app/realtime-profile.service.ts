/**
 * V6 Phase 1.8 — RealtimeProfileService（短期画像）
 *
 * 核心职责：
 * 1. 维护用户短期画像（7 天滑窗），存储在 Redis
 * 2. 监听域事件（反馈提交 / 饮食记录），异步更新短期画像
 * 3. 提供统一接口供推荐引擎注入实时上下文
 *
 * 短期画像内容：
 * - recentTastePreferences: 近 7 天口味偏好（品类 → 接受/拒绝计数）
 * - rejectionPatterns: 拒绝模式（被跳过的食物/品类统计）
 * - activeTimeSlots: 活跃时段（各餐次记录的时间分布）
 * - intakeTrends: 摄入趋势（近 7 天平均热量/蛋白质/碳水/脂肪）
 *
 * 存储方案：
 * - Redis key: `short_term_profile:{userId}`
 * - 整个画像序列化为一个 JSON 对象，TTL 7 天
 * - 每次更新采用 read-modify-write 模式（画像体积小，无并发竞争风险）
 *
 * 架构集成：
 * - 监听 DomainEvents.FEEDBACK_SUBMITTED → 更新口味偏好 + 拒绝模式
 * - 监听 DomainEvents.MEAL_RECORDED → 更新活跃时段 + 摄入趋势
 * - 推荐引擎通过 getShortTermProfile(userId) 读取短期画像
 * - 合并策略：短期权重 0.6 + 长期权重 0.4（在推荐引擎侧实现）
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';
import {
  DomainEvents,
  FeedbackSubmittedEvent,
  MealRecordedEvent,
} from '../../../core/events/domain-events';

// ─── 短期画像数据结构 ───

/** 品类偏好统计 */
export interface CategoryPreference {
  /** 接受次数 */
  accepted: number;
  /** 拒绝/跳过次数 */
  rejected: number;
  /** 替换次数 */
  replaced: number;
}

/** 摄入趋势条目（单日聚合） */
export interface DailyIntakeEntry {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 总热量（千卡） */
  calories: number;
  /** 记录餐次数 */
  mealCount: number;
}

/** 活跃时段统计 */
export interface TimeSlotActivity {
  /** 各餐次的最近记录时间（用于判断活跃时段） */
  [mealType: string]: {
    /** 记录次数 */
    count: number;
    /** 最近一次记录时间 ISO string */
    lastRecordedAt: string;
  };
}

/**
 * 短期画像完整结构
 *
 * 整体存入 Redis，TTL = 7 天。每次事件驱动更新。
 */
export interface ShortTermProfile {
  /** 用户 ID */
  userId: string;

  /** 近 7 天口味偏好（品类维度） */
  categoryPreferences: Record<string, CategoryPreference>;

  /** 拒绝模式 — 被拒绝的食物名称 → 拒绝次数 */
  rejectedFoods: Record<string, number>;

  /** 活跃时段 — 各餐次的活动统计 */
  activeTimeSlots: TimeSlotActivity;

  /** 摄入趋势 — 最近 7 天的每日摄入聚合 */
  dailyIntakes: DailyIntakeEntry[];

  /** 最后更新时间 ISO string */
  lastUpdatedAt: string;
}

// ─── 常量 ───

/** Redis key 前缀 */
const REDIS_KEY_PREFIX = 'short_term_profile';

/** 短期画像 TTL: 7 天 */
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 保留的每日摄入条目数（滑窗天数） */
const MAX_DAILY_INTAKE_ENTRIES = 7;

/** 拒绝食物记录上限（防止无限增长） */
const MAX_REJECTED_FOODS = 100;

// ─── 服务实现 ───

@Injectable()
export class RealtimeProfileService {
  private readonly logger = new Logger(RealtimeProfileService.name);

  constructor(private readonly redis: RedisCacheService) {}

  // ─── 公共读取接口 ───

  /**
   * 获取用户短期画像
   *
   * 推荐引擎在生成推荐时调用此方法，将短期画像注入上下文。
   * Redis 不可用时返回 null，推荐引擎降级为仅使用长期画像。
   */
  async getShortTermProfile(userId: string): Promise<ShortTermProfile | null> {
    const key = this.buildKey(userId);
    return this.redis.get<ShortTermProfile>(key);
  }

  /**
   * 批量获取短期画像（预计算场景）
   */
  async getShortTermProfiles(
    userIds: string[],
  ): Promise<Map<string, ShortTermProfile>> {
    const result = new Map<string, ShortTermProfile>();
    // 并行读取（Redis 管道化由底层处理）
    const promises = userIds.map(async (userId) => {
      const profile = await this.getShortTermProfile(userId);
      if (profile) result.set(userId, profile);
    });
    await Promise.all(promises);
    return result;
  }

  /**
   * 手动失效用户短期画像
   */
  async invalidate(userId: string): Promise<void> {
    const key = this.buildKey(userId);
    await this.redis.del(key);
    this.logger.debug(`短期画像已失效: userId=${userId}`);
  }

  // ─── 事件监听 ───

  /**
   * 监听反馈提交事件 → 更新口味偏好 + 拒绝模式
   */
  @OnEvent(DomainEvents.FEEDBACK_SUBMITTED)
  async handleFeedbackSubmitted(event: FeedbackSubmittedEvent): Promise<void> {
    try {
      const profile = await this.getOrCreateProfile(event.userId);

      // 1. 更新拒绝模式
      if (event.action === 'skipped' || event.action === 'replaced') {
        // 记录被拒绝的食物
        profile.rejectedFoods[event.foodName] =
          (profile.rejectedFoods[event.foodName] || 0) + 1;

        // 限制拒绝食物记录数量（淘汰最旧的低频项）
        this.trimRejectedFoods(profile);
      }

      // 2. 更新品类偏好（如果有 goalType 可推断品类，这里按 action 维度记录）
      // 注意: event 中没有 category 字段，使用 foodName 作为 key
      // 实际场景中推荐引擎会传入品类信息，此处做通用统计
      const categoryKey = event.mealType || 'unknown';
      if (!profile.categoryPreferences[categoryKey]) {
        profile.categoryPreferences[categoryKey] = {
          accepted: 0,
          rejected: 0,
          replaced: 0,
        };
      }
      const pref = profile.categoryPreferences[categoryKey];
      if (event.action === 'accepted') {
        pref.accepted++;
      } else if (event.action === 'skipped') {
        pref.rejected++;
      } else if (event.action === 'replaced') {
        pref.replaced++;
      }

      profile.lastUpdatedAt = new Date().toISOString();
      await this.saveProfile(event.userId, profile);

      this.logger.debug(
        `短期画像更新(反馈): userId=${event.userId}, action=${event.action}, food=${event.foodName}`,
      );
    } catch (err) {
      this.logger.warn(
        `短期画像更新失败(反馈): userId=${event.userId}, ${(err as Error).message}`,
      );
    }
  }

  /**
   * 监听饮食记录事件 → 更新活跃时段 + 摄入趋势
   */
  @OnEvent(DomainEvents.MEAL_RECORDED)
  async handleMealRecorded(event: MealRecordedEvent): Promise<void> {
    try {
      const profile = await this.getOrCreateProfile(event.userId);

      // 1. 更新活跃时段
      const mealType = event.mealType || 'unknown';
      if (!profile.activeTimeSlots[mealType]) {
        profile.activeTimeSlots[mealType] = {
          count: 0,
          lastRecordedAt: '',
        };
      }
      profile.activeTimeSlots[mealType].count++;
      profile.activeTimeSlots[mealType].lastRecordedAt =
        new Date().toISOString();

      // 2. 更新摄入趋势
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const existingEntry = profile.dailyIntakes.find((e) => e.date === today);
      if (existingEntry) {
        existingEntry.calories += event.totalCalories;
        existingEntry.mealCount++;
      } else {
        profile.dailyIntakes.push({
          date: today,
          calories: event.totalCalories,
          mealCount: 1,
        });
      }

      // 滑窗裁剪：只保留最近 7 天
      if (profile.dailyIntakes.length > MAX_DAILY_INTAKE_ENTRIES) {
        profile.dailyIntakes.sort((a, b) => a.date.localeCompare(b.date));
        profile.dailyIntakes = profile.dailyIntakes.slice(
          -MAX_DAILY_INTAKE_ENTRIES,
        );
      }

      profile.lastUpdatedAt = new Date().toISOString();
      await this.saveProfile(event.userId, profile);

      this.logger.debug(
        `短期画像更新(记录): userId=${event.userId}, mealType=${mealType}, calories=${event.totalCalories}`,
      );
    } catch (err) {
      this.logger.warn(
        `短期画像更新失败(记录): userId=${event.userId}, ${(err as Error).message}`,
      );
    }
  }

  // ─── 辅助查询方法（推荐引擎使用） ───

  /**
   * 获取用户近期拒绝的食物列表（用于推荐过滤）
   *
   * 返回拒绝次数 >= minCount 的食物名称列表
   */
  async getRecentlyRejectedFoods(
    userId: string,
    minCount = 2,
  ): Promise<string[]> {
    const profile = await this.getShortTermProfile(userId);
    if (!profile) return [];

    return Object.entries(profile.rejectedFoods)
      .filter(([, count]) => count >= minCount)
      .map(([food]) => food);
  }

  /**
   * 获取用户近 7 天平均每日热量
   */
  async getRecentAvgCalories(userId: string): Promise<number | null> {
    const profile = await this.getShortTermProfile(userId);
    if (!profile || profile.dailyIntakes.length === 0) return null;

    const total = profile.dailyIntakes.reduce((sum, e) => sum + e.calories, 0);
    return Math.round(total / profile.dailyIntakes.length);
  }

  /**
   * 获取用户最活跃的餐次类型（用于推送时间优化）
   */
  async getMostActiveMealType(userId: string): Promise<string | null> {
    const profile = await this.getShortTermProfile(userId);
    if (!profile) return null;

    let maxCount = 0;
    let maxMealType: string | null = null;
    for (const [mealType, activity] of Object.entries(
      profile.activeTimeSlots,
    )) {
      if (activity.count > maxCount) {
        maxCount = activity.count;
        maxMealType = mealType;
      }
    }
    return maxMealType;
  }

  // ─── 私有方法 ───

  /**
   * 获取或创建用户短期画像
   */
  private async getOrCreateProfile(userId: string): Promise<ShortTermProfile> {
    const existing = await this.getShortTermProfile(userId);
    if (existing) return existing;

    return {
      userId,
      categoryPreferences: {},
      rejectedFoods: {},
      activeTimeSlots: {},
      dailyIntakes: [],
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  /**
   * 保存短期画像到 Redis
   */
  private async saveProfile(
    userId: string,
    profile: ShortTermProfile,
  ): Promise<void> {
    const key = this.buildKey(userId);
    await this.redis.set(key, profile, PROFILE_TTL_MS);
  }

  /**
   * 裁剪拒绝食物记录（防止无限增长）
   * 策略：超过上限时移除拒绝次数最少的条目
   */
  private trimRejectedFoods(profile: ShortTermProfile): void {
    const entries = Object.entries(profile.rejectedFoods);
    if (entries.length <= MAX_REJECTED_FOODS) return;

    // 按拒绝次数升序排列，移除拒绝次数最少的
    entries.sort((a, b) => a[1] - b[1]);
    const toRemove = entries.length - MAX_REJECTED_FOODS;
    for (let i = 0; i < toRemove; i++) {
      delete profile.rejectedFoods[entries[i][0]];
    }
  }

  /**
   * 构建 Redis key
   */
  private buildKey(userId: string): string {
    return this.redis.buildKey(REDIS_KEY_PREFIX, userId);
  }
}
