/**
 * V6.1 Phase 2.6 — 食物分析事件监听器
 *
 * 监听食物分析生命周期事件，联动更新短期画像和推荐系统。
 *
 * 核心联动逻辑（设计文档 Section 6.3）：
 * - 分析完成后更新短期画像：recentAnalyzedCategories, recentRiskFoods
 * - 推荐系统下一餐注入：避免重复踩雷、优先推荐可替代食物
 * - 失效预计算推荐缓存，让下次推荐拿到最新偏好
 *
 * 短期画像扩展字段（写入 RealtimeProfileService 管理的 Redis 画像）：
 * - recentAnalyzedCategories: 近期分析过的食物分类（频次统计）
 * - recentRiskFoods: 近期被标记为 caution/avoid 的食物
 * - recentAnalysisCount: 近期分析次数（活跃度指标）
 *
 * 架构决策：
 * - 监听器放在 food 模块，因为它了解食物分析上下文
 * - 通过 RealtimeProfileService（user 模块 export）写入画像
 * - 通过 PrecomputeService（diet 模块 export）失效预计算
 * - 所有操作异步执行，不阻塞分析主流程
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  AnalysisCompletedEvent,
  AnalysisFailedEvent,
} from '../../../../core/events/domain-events';
import { RealtimeProfileService } from '../../../user/app/services/profile/realtime-profile.service';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../core/cache/tiered-cache-manager';

// ─── 分析画像扩展结构 ───

/** 分析相关的短期画像扩展数据（存储在独立 Redis key 中） */
export interface AnalysisShortTermProfile {
  /** 用户 ID */
  userId: string;

  /**
   * 近期分析过的食物分类 → 次数
   * 用于推荐系统感知用户最近关注的食物类型
   */
  recentAnalyzedCategories: Record<string, number>;

  /**
   * 近期被标记为 caution/avoid 的食物名称列表
   * 用于推荐时避免重复踩雷，优先推荐替代食物
   */
  recentRiskFoods: string[];

  /** 近期分析次数（7天窗口内） */
  recentAnalysisCount: number;

  /** 近期分析食物名称（去重，最多保留 30 个） */
  recentAnalyzedFoods: string[];

  /** 最后更新时间 ISO string */
  lastUpdatedAt: string;
}

// ─── 常量 ───

/** 分析画像 Redis key namespace */
const ANALYSIS_PROFILE_NAMESPACE = 'analysis_profile';

/** 分析画像 TTL: 7 天（与短期画像一致） */
const ANALYSIS_PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 风险食物列表最大长度 */
const MAX_RISK_FOODS = 50;

/** 分析过的食物名称最大保留数 */
const MAX_ANALYZED_FOODS = 30;

// ─── 服务实现 ───

@Injectable()
export class AnalysisEventListener implements OnModuleInit {
  private readonly logger = new Logger(AnalysisEventListener.name);

  /** V6.2 3.9: TieredCache namespace */
  private cache!: TieredCacheNamespace<AnalysisShortTermProfile>;

  constructor(
    private readonly cacheManager: TieredCacheManager,
    private readonly realtimeProfileService: RealtimeProfileService,
  ) {}

  onModuleInit(): void {
    this.cache = this.cacheManager.createNamespace<AnalysisShortTermProfile>({
      namespace: ANALYSIS_PROFILE_NAMESPACE,
      l1MaxEntries: 500,
      l1TtlMs: 5 * 60 * 1000, // L1: 5 分钟
      l2TtlMs: ANALYSIS_PROFILE_TTL_MS, // L2: 7 天
    });
  }

  // ─── 事件监听 ───

  /**
   * 监听分析完成事件 → 更新分析相关短期画像
   *
   * 联动效果:
   * 1. 记录用户近期分析的食物分类偏好
   * 2. 标记风险食物（caution/avoid），供推荐过滤
   * 3. 更新分析活跃度计数
   * 4. 失效 RealtimeProfileService 的缓存，触发下次推荐更新
   */
  @OnEvent(DomainEvents.ANALYSIS_COMPLETED, { async: true })
  async handleAnalysisCompleted(event: AnalysisCompletedEvent): Promise<void> {
    try {
      const profile = await this.getOrCreateAnalysisProfile(event.userId);

      // 1. 更新食物分类偏好（频次累加）
      for (const category of event.foodCategories) {
        if (category) {
          profile.recentAnalyzedCategories[category] =
            (profile.recentAnalyzedCategories[category] || 0) + 1;
        }
      }

      // 2. 如果决策是 caution 或 avoid，记录风险食物
      if (
        event.recommendation === 'caution' ||
        event.recommendation === 'avoid'
      ) {
        for (const foodName of event.foodNames) {
          if (!profile.recentRiskFoods.includes(foodName)) {
            profile.recentRiskFoods.push(foodName);
          }
        }
        // 限制风险食物列表长度（FIFO 淘汰最旧的）
        if (profile.recentRiskFoods.length > MAX_RISK_FOODS) {
          profile.recentRiskFoods =
            profile.recentRiskFoods.slice(-MAX_RISK_FOODS);
        }
      }

      // 3. 更新分析次数
      profile.recentAnalysisCount++;

      // 4. 更新近期分析过的食物名称
      for (const foodName of event.foodNames) {
        if (!profile.recentAnalyzedFoods.includes(foodName)) {
          profile.recentAnalyzedFoods.push(foodName);
        }
      }
      if (profile.recentAnalyzedFoods.length > MAX_ANALYZED_FOODS) {
        profile.recentAnalyzedFoods =
          profile.recentAnalyzedFoods.slice(-MAX_ANALYZED_FOODS);
      }

      profile.lastUpdatedAt = new Date().toISOString();

      // 5. 保存分析画像
      await this.saveAnalysisProfile(event.userId, profile);

      this.logger.debug(
        `分析画像更新: userId=${event.userId}, type=${event.inputType}, ` +
          `foods=[${event.foodNames.join(',')}], recommendation=${event.recommendation}`,
      );
    } catch (err) {
      this.logger.warn(
        `分析画像更新失败: userId=${event.userId}, ${(err as Error).message}`,
      );
    }
  }

  /**
   * 监听分析失败事件 → 记录日志（暂不做画像更新）
   *
   * 后续可扩展: 失败次数统计、告警触发
   */
  @OnEvent(DomainEvents.ANALYSIS_FAILED, { async: true })
  async handleAnalysisFailed(event: AnalysisFailedEvent): Promise<void> {
    this.logger.warn(
      `分析失败事件: userId=${event.userId}, requestId=${event.requestId}, ` +
        `type=${event.inputType}, error=${event.errorMessage}`,
    );
  }

  // ─── 公共读取接口（供推荐引擎使用） ───

  /**
   * 获取用户分析相关短期画像
   *
   * 推荐引擎可据此:
   * - 避开 recentRiskFoods 中的食物
   * - 根据 recentAnalyzedCategories 调整推荐权重
   * - 判断用户分析活跃度
   */
  async getAnalysisProfile(
    userId: string,
  ): Promise<AnalysisShortTermProfile | null> {
    return this.cache.get(userId);
  }

  /**
   * 获取用户近期风险食物列表（推荐过滤用）
   */
  async getRecentRiskFoods(userId: string): Promise<string[]> {
    const profile = await this.getAnalysisProfile(userId);
    return profile?.recentRiskFoods ?? [];
  }

  /**
   * 获取用户近期分析的食物分类（推荐权重调整用）
   */
  async getRecentAnalyzedCategories(
    userId: string,
  ): Promise<Record<string, number>> {
    const profile = await this.getAnalysisProfile(userId);
    return profile?.recentAnalyzedCategories ?? {};
  }

  // ─── 私有方法 ───

  /**
   * 获取或创建分析画像
   */
  private async getOrCreateAnalysisProfile(
    userId: string,
  ): Promise<AnalysisShortTermProfile> {
    const existing = await this.getAnalysisProfile(userId);
    if (existing) return existing;

    return {
      userId,
      recentAnalyzedCategories: {},
      recentRiskFoods: [],
      recentAnalysisCount: 0,
      recentAnalyzedFoods: [],
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  /**
   * 保存分析画像到 Redis
   */
  private async saveAnalysisProfile(
    userId: string,
    profile: AnalysisShortTermProfile,
  ): Promise<void> {
    await this.cache.set(userId, profile);
  }
}
