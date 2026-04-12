/**
 * V7.3 P2-C: Factor 权重学习服务
 *
 * 从用户对推荐结果的反馈（accept/reject/replace）中，
 * 学习每个 ScoringFactor 对该用户的最佳强度乘数。
 *
 * 学习策略：
 * - Storage: 内存 Map（生产环境可替换为 Redis hash `factor_learner:user:{userId}:{goalType}`）
 * - Attribution: 按 |multiplier - 1| + |additive| 计算各因子的贡献比
 * - Update: newStrength = oldStrength + lr * direction * contributionRatio
 * - Learning rate: 0.02（保守）
 * - Safety range: [0.5, 2.0]，clamp
 * - Cold start: 至少 10 次反馈事件才激活
 */
import { Injectable, Logger } from '@nestjs/common';
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

/** 用户因子学习状态（内存存储） */
interface UserFactorState {
  /** 因子名 → 当前强度乘数 */
  strengths: Map<string, number>;
  /** 累计反馈次数 */
  feedbackCount: number;
  /** 最后更新时间 */
  lastUpdated: number;
}

// ─── 常量 ───

/** 学习率 */
const LEARNING_RATE = 0.02;
/** 强度下限 */
const MIN_STRENGTH = 0.5;
/** 强度上限 */
const MAX_STRENGTH = 2.0;
/** 冷启动阈值：至少需要的反馈次数 */
const COLD_START_THRESHOLD = 10;
/** 状态过期时间: 14天 (ms) */
const STATE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class FactorLearnerService {
  private readonly logger = new Logger(FactorLearnerService.name);

  /**
   * 内存存储: `userId:goalType` → UserFactorState
   * 生产环境可替换为 Redis
   */
  private store = new Map<string, UserFactorState>();

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

  /**
   * 获取用户的因子强度调整 Map
   *
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
    const key = `${userId}:${goalType}`;
    const state = this.store.get(key);

    // 冷启动检查
    if (!state || state.feedbackCount < COLD_START_THRESHOLD) {
      return new Map();
    }

    // TTL 检查
    if (Date.now() - state.lastUpdated > STATE_TTL_MS) {
      this.store.delete(key);
      return new Map();
    }

    return new Map(state.strengths);
  }

  /**
   * 更新用户的因子权重
   *
   * 公式: newStrength = oldStrength + LEARNING_RATE * direction * contributionRatio
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

    const key = `${userId}:${goalType}`;
    let state = this.store.get(key);

    if (!state) {
      state = {
        strengths: new Map(),
        feedbackCount: 0,
        lastUpdated: Date.now(),
      };
      this.store.set(key, state);
    }

    for (const attr of attributions) {
      const oldStrength = state.strengths.get(attr.factorName) ?? 1.0;
      const delta = LEARNING_RATE * attr.direction * attr.contributionRatio;
      const newStrength = Math.max(
        MIN_STRENGTH,
        Math.min(MAX_STRENGTH, oldStrength + delta),
      );
      state.strengths.set(attr.factorName, newStrength);
    }

    state.feedbackCount++;
    state.lastUpdated = Date.now();

    this.logger.debug(
      `FactorLearner updated ${key}: count=${state.feedbackCount}, ` +
        `factors=[${Array.from(state.strengths.entries())
          .map(([k, v]) => `${k}=${v.toFixed(3)}`)
          .join(', ')}]`,
    );
  }

  /**
   * 获取用户反馈次数（测试/调试用）
   */
  getFeedbackCount(userId: string, goalType: string): number {
    const key = `${userId}:${goalType}`;
    return this.store.get(key)?.feedbackCount ?? 0;
  }

  /**
   * 清理过期状态（可在定时任务中调用）
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, state] of this.store) {
      if (now - state.lastUpdated > STATE_TTL_MS) {
        this.store.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}
