/**
 * V7.3 P2-C / V7.4 P1-C: Factor 权重学习服务
 *
 * 从用户对推荐结果的反馈（accept/reject/replace）中，
 * 学习每个 ScoringFactor 对该用户的最佳强度乘数。
 *
 * V7.3 → V7.4 升级：
 * - Storage: 内存 Map → Redis Hash 持久化（key: `factor_learner:{userId}:{goalType}`）
 * - Learning rate: 固定 0.02 → 自适应学习率（按反馈次数衰减）
 * - Fallback: Redis 不可用时自动降级到内存 Map
 *
 * 学习策略：
 * - Attribution: 按 |multiplier - 1| + |additive| 计算各因子的贡献比
 * - Update: newStrength = oldStrength + adaptiveLR(feedbackCount) * direction * contributionRatio
 * - Adaptive LR: baseLR / (1 + feedbackCount / decayHalfLife)，随反馈增多自动减小步长
 * - Safety range: [0.5, 2.0]，clamp
 * - Cold start: 至少 10 次反馈事件才激活
 */
import { Injectable, Logger } from '@nestjs/common';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import type { ScoringAdjustment } from './scoring-chain/scoring-factor.interface';

// ─── 类型定义 ───

export interface FactorAttribution {
  /** 因子名 */
  factorName: string;
  /** 贡献比 0-1 */
  contributionRatio: number;
  /** 方向: +1 = 正反馈（接受）, -1 = 负反馈（拒绝） */
  direction: number;
}

/** 因子名 → 强度乘数 */
export type FactorAdjustmentMap = Map<string, number>;

// ─── 常量 ───

/** 基础学习率 */
const BASE_LEARNING_RATE = 0.05;
/** 自适应衰减半衰期：经过此反馈次数后学习率减半 */
const DECAY_HALF_LIFE = 50;
/** 强度下限 */
const MIN_STRENGTH = 0.5;
/** 强度上限 */
const MAX_STRENGTH = 2.0;
/** 冷启动阈值：至少需要的反馈次数 */
const COLD_START_THRESHOLD = 10;
/** Redis key 前缀 */
const REDIS_KEY_PREFIX = 'factor_learner';
/** Redis TTL: 14天 (ms) */
const STATE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Redis Hash 中存储反馈次数的特殊字段 */
const META_FEEDBACK_COUNT = '__feedbackCount';

@Injectable()
export class FactorLearnerService {
  private readonly logger = new Logger(FactorLearnerService.name);

  /**
   * 内存 fallback 存储（Redis 不可用时使用）
   */
  private memoryFallback = new Map<
    string,
    {
      strengths: Map<string, number>;
      feedbackCount: number;
      lastUpdated: number;
    }
  >();

  constructor(private readonly redis: RedisCacheService) {}

  // ─── 自适应学习率 ───

  /**
   * 计算自适应学习率
   *
   * 公式: baseLR / (1 + feedbackCount / decayHalfLife)
   * - feedbackCount=0 → lr=0.05
   * - feedbackCount=50 → lr=0.025
   * - feedbackCount=150 → lr=0.0125
   *
   * 作用: 早期快速适应用户偏好，后期趋于稳定避免过拟合
   */
  private adaptiveLearningRate(feedbackCount: number): number {
    return BASE_LEARNING_RATE / (1 + feedbackCount / DECAY_HALF_LIFE);
  }

  // ─── Redis key ───

  private redisKey(userId: string, goalType: string): string {
    return `${REDIS_KEY_PREFIX}:${userId}:${goalType}`;
  }

  // ─── 归因 ───

  /**
   * 将用户反馈归因到各 ScoringFactor
   *
   * 归因算法: 按各因子调整的绝对贡献量（|multiplier - 1| + |additive|）
   * 计算其在总贡献中的占比。
   *
   * @param adjustments 该食物的所有 ScoringAdjustment
   * @param action 用户行为: accept/reject/replace
   * @returns 各因子的归因结果
   */
  attributeFeedback(
    adjustments: ScoringAdjustment[],
    action: 'accept' | 'reject' | 'replace',
  ): FactorAttribution[] {
    if (adjustments.length === 0) return [];

    // 计算各因子的贡献量
    const contributions = adjustments.map((adj) => ({
      factorName: adj.factorName,
      contribution: Math.abs(adj.multiplier - 1.0) + Math.abs(adj.additive),
    }));

    // 总贡献
    const totalContribution = contributions.reduce(
      (sum, c) => sum + c.contribution,
      0,
    );
    if (totalContribution === 0) return [];

    // 方向: accept = +1, reject/replace = -1
    const direction = action === 'accept' ? 1 : -1;

    return contributions.map((c) => ({
      factorName: c.factorName,
      contributionRatio:
        totalContribution > 0 ? c.contribution / totalContribution : 0,
      direction,
    }));
  }

  // ─── 读取 ───

  /**
   * 获取用户的因子强度调整 Map
   *
   * 优先从 Redis 读取，Redis 不可用则降级到内存。
   * 如果反馈次数不足冷启动阈值，返回空 Map。
   *
   * @param userId 用户 ID
   * @param goalType 目标类型
   * @returns 因子名 → 强度乘数
   */
  async getUserFactorAdjustments(
    userId: string,
    goalType: string,
  ): Promise<FactorAdjustmentMap> {
    const key = this.redisKey(userId, goalType);

    // 尝试从 Redis 读取
    let hashData: Record<string, string> | null = null;
    try {
      hashData = await this.redis.hGetAll(key);
    } catch {
      // Redis 不可用，降级到内存
    }

    if (hashData && Object.keys(hashData).length > 0) {
      // Redis 命中
      const feedbackCount = parseInt(hashData[META_FEEDBACK_COUNT] ?? '0', 10);

      // 冷启动检查
      if (feedbackCount < COLD_START_THRESHOLD) {
        return new Map();
      }

      const result = new Map<string, number>();
      for (const [field, value] of Object.entries(hashData)) {
        if (field === META_FEEDBACK_COUNT) continue;
        const parsed = parseFloat(value);
        if (!isNaN(parsed)) {
          result.set(field, parsed);
        }
      }
      return result;
    }

    // Redis 不可用 → 降级内存
    const memKey = `${userId}:${goalType}`;
    const memState = this.memoryFallback.get(memKey);
    if (!memState || memState.feedbackCount < COLD_START_THRESHOLD) {
      return new Map();
    }
    if (Date.now() - memState.lastUpdated > STATE_TTL_MS) {
      this.memoryFallback.delete(memKey);
      return new Map();
    }
    return new Map(memState.strengths);
  }

  // ─── 更新 ───

  /**
   * 更新用户的因子权重
   *
   * V7.4: 使用自适应学习率，持久化到 Redis Hash
   *
   * 公式: newStrength = oldStrength + adaptiveLR(feedbackCount) * direction * contributionRatio
   * 结果 clamp 到 [MIN_STRENGTH, MAX_STRENGTH]
   *
   * @param userId 用户 ID
   * @param goalType 目标类型
   * @param attributions 归因结果
   */
  async updateFactorWeights(
    userId: string,
    goalType: string,
    attributions: FactorAttribution[],
  ): Promise<void> {
    if (attributions.length === 0) return;

    const redisKey = this.redisKey(userId, goalType);
    const memKey = `${userId}:${goalType}`;

    // 读取当前状态（优先 Redis）
    let strengths = new Map<string, number>();
    let feedbackCount = 0;

    let hashData: Record<string, string> | null = null;
    try {
      hashData = await this.redis.hGetAll(redisKey);
    } catch {
      // Redis 不可用
    }
    let usingRedis = hashData !== null;

    if (usingRedis && hashData && Object.keys(hashData).length > 0) {
      feedbackCount = parseInt(hashData[META_FEEDBACK_COUNT] ?? '0', 10);
      for (const [field, value] of Object.entries(hashData)) {
        if (field === META_FEEDBACK_COUNT) continue;
        const parsed = parseFloat(value);
        if (!isNaN(parsed)) {
          strengths.set(field, parsed);
        }
      }
    } else if (!usingRedis) {
      // Redis 不可用，降级内存
      const memState = this.memoryFallback.get(memKey);
      if (memState) {
        strengths = new Map(memState.strengths);
        feedbackCount = memState.feedbackCount;
      }
    }

    // 计算自适应学习率
    const lr = this.adaptiveLearningRate(feedbackCount);

    // 更新权重
    for (const attr of attributions) {
      const oldStrength = strengths.get(attr.factorName) ?? 1.0;
      const delta = lr * attr.direction * attr.contributionRatio;
      const newStrength = Math.max(
        MIN_STRENGTH,
        Math.min(MAX_STRENGTH, oldStrength + delta),
      );
      strengths.set(attr.factorName, newStrength);
    }

    feedbackCount++;

    // 持久化到 Redis
    if (usingRedis) {
      const writeOk = await this.persistToRedis(
        redisKey,
        strengths,
        feedbackCount,
      );
      if (!writeOk) {
        // Redis 写入失败，降级内存
        usingRedis = false;
      }
    }

    // 内存 fallback（总是写一份到内存以防 Redis 短暂中断后恢复时有数据）
    this.memoryFallback.set(memKey, {
      strengths: new Map(strengths),
      feedbackCount,
      lastUpdated: Date.now(),
    });

    this.logger.debug(
      `FactorLearner updated [${usingRedis ? 'redis' : 'memory'}] ${memKey}: ` +
        `count=${feedbackCount}, lr=${lr.toFixed(4)}, ` +
        `factors=[${Array.from(strengths.entries())
          .map(([k, v]) => `${k}=${v.toFixed(3)}`)
          .join(', ')}]`,
    );
  }

  // ─── Redis 持久化 ───

  private async persistToRedis(
    key: string,
    strengths: Map<string, number>,
    feedbackCount: number,
  ): Promise<boolean> {
    try {
      // 写入各因子强度
      for (const [factorName, strength] of strengths) {
        const ok = await this.redis.hSet(key, factorName, strength.toFixed(6));
        if (!ok) return false;
      }
      // 写入反馈次数
      const ok = await this.redis.hSet(
        key,
        META_FEEDBACK_COUNT,
        String(feedbackCount),
      );
      if (!ok) return false;
      // 设置 TTL（仅首次）
      await this.redis.expireNX(key, STATE_TTL_MS);
      return true;
    } catch (err) {
      this.logger.warn(`FactorLearner Redis persist failed: ${err}`);
      return false;
    }
  }

  // ─── 工具方法 ───

  /**
   * 获取用户反馈次数（测试/调试用）
   */
  async getFeedbackCount(userId: string, goalType: string): Promise<number> {
    const key = this.redisKey(userId, goalType);
    try {
      const hashData = await this.redis.hGetAll(key);
      if (hashData && hashData[META_FEEDBACK_COUNT]) {
        return parseInt(hashData[META_FEEDBACK_COUNT], 10);
      }
    } catch {
      // Redis 不可用，降级到内存
    }
    // fallback 内存
    const memKey = `${userId}:${goalType}`;
    return this.memoryFallback.get(memKey)?.feedbackCount ?? 0;
  }

  /**
   * 清理过期状态（内存 fallback 清理，Redis 由 TTL 自动过期）
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, state] of this.memoryFallback) {
      if (now - state.lastUpdated > STATE_TTL_MS) {
        this.memoryFallback.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}
