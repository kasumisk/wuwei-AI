/**
 * V7.2 P1-A: ScoringFactor 可插拔评分因子接口
 *
 * 将 PipelineBuilder.rankCandidates() 中 400+ 行的顺序 boost 逻辑
 * 拆解为可插拔的 ScoringFactor 链。每个因子读取 PipelineContext，
 * 对单个食物计算乘数 / 加分，写入 ScoringAdjustment。
 *
 * 设计原则：
 * - 每个因子只关注一个维度的加权逻辑
 * - order 决定执行顺序（小→大），后续可动态排序
 * - 因子可通过 isApplicable 跳过（如无偏好数据时跳过偏好因子）
 * - ScoringAdjustment 记录因子名 + 乘数 + 原因，供解释模块使用
 */

import type { FoodLibrary } from '../../../../food/food.types';
import type {
  PipelineContext,
  ScoredFood,
} from '../types/recommendation.types';
import type { ScoringExplanation } from '../types/scoring-explanation.interface';

// ─── ScoringAdjustment：单次因子调整记录 ───

/**
 * 一个评分因子对单个食物产生的调整
 *
 * multiplier: 乘法因子（1.0 = 不变，>1 加分，<1 减分）
 * additive:   加法因子（直接加到分数上，默认 0）
 * 最终效果: score = score * multiplier + additive
 */
export interface ScoringAdjustment {
  /** 产生该调整的因子名（与 ScoringFactor.name 一致） */
  factorName: string;

  /** 乘法因子，默认 1.0 */
  multiplier: number;

  /** 加法因子，默认 0 */
  additive: number;

  /** 对应的 ScoringExplanation 字段名（用于回写解释） */
  explanationKey: keyof ScoringExplanation | null;

  /** 人类可读的调整原因（调试 / 日志用） */
  reason: string;
}

// ─── ScoringFactor：可插拔评分因子接口 ───

/**
 * 评分因子接口 — 每个实现类代表 rankCandidates 中的一个 boost 逻辑块。
 *
 * 生命周期:
 * 1. ScoringChainService 按 order 排序所有因子
 * 2. 对每个因子调用 isApplicable(ctx)，跳过不适用的
 * 3. 调用 init(ctx) 做批量预计算（如从 ctx 提取 Map/Set）
 * 4. 对每个候选食物调用 computeAdjustment(food, baseScore, ctx)
 * 5. 将返回的 ScoringAdjustment 的 multiplier/additive 应用到分数上
 */
export interface ScoringFactor {
  /** 因子唯一名称（如 'nutrition-gap', 'preference-signal'） */
  readonly name: string;

  /** 执行顺序（升序），范围建议 10-100，间隔 10 */
  readonly order: number;

  /**
   * 该因子是否适用于当前管道上下文
   *
   * 例如：PreferenceSignalFactor 在没有偏好数据时返回 false 直接跳过。
   * 默认行为应返回 true。
   */
  isApplicable(ctx: PipelineContext): boolean;

  /**
   * 批量初始化 — 在遍历候选食物之前调用一次
   *
   * 用于从 PipelineContext 中提取需要的数据结构（Map/Set/Array），
   * 避免在 computeAdjustment 中重复计算。
   *
   * @param ctx 管道上下文
   */
  init(ctx: PipelineContext): void;

  /**
   * 对单个食物计算评分调整
   *
   * @param food     候选食物
   * @param baseScore 经过前面因子处理后的当前分数
   * @param ctx      管道上下文（只读）
   * @returns 调整记录；若无调整可返回 null
   */
  computeAdjustment(
    food: FoodLibrary,
    baseScore: number,
    ctx: PipelineContext,
  ): ScoringAdjustment | null;
}

// ─── ScoringChainResult：链式评分结果 ───

/**
 * 评分链对单个食物的完整评分结果
 */
export interface ScoringChainResult {
  /** 原始食物 */
  food: FoodLibrary;

  /** 基础分（来自 FoodScorer.scoreFoodDetailed） */
  baseScore: number;

  /** 链式处理后的最终分数 */
  finalScore: number;

  /** 所有因子的调整记录（按执行顺序） */
  adjustments: ScoringAdjustment[];

  /** 评分解释（从 adjustments 回写） */
  explanation: Partial<ScoringExplanation>;
}

// ─── ScoringChainConfig：链配置 ───

/**
 * 评分链配置 — 控制哪些因子启用 / 禁用
 */
export interface ScoringChainConfig {
  /** 禁用的因子名列表 */
  disabledFactors?: string[];

  /** 是否记录详细调整日志（默认 false，生产环境关闭） */
  verbose?: boolean;

  /** 最终分数的下限（防止负分，默认 0） */
  scoreFloor?: number;

  /** 最终分数的上限（防止溢出，默认 200） */
  scoreCeiling?: number;
}

/** 默认链配置 */
export const DEFAULT_SCORING_CHAIN_CONFIG: Required<ScoringChainConfig> = {
  disabledFactors: [],
  verbose: false,
  scoreFloor: 0,
  scoreCeiling: 200,
};
