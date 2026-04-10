/**
 * V6 Phase 2.5 — 多目标优化器
 *
 * 将推荐从单目标评分（加权合成分数）扩展为多目标独立优化:
 *   - health: 营养健康度（基于现有 10 维评分归一化到 0-1）
 *   - taste: 口味匹配度（用户口味偏好 vs 食物 flavorProfile，余弦相似度）
 *   - cost: 价格经济性（estimatedCostLevel 反转归一化）
 *   - convenience: 便利性（prepTime + cookTime + skillRequired 综合归一化）
 *
 * 算法:
 *   1. 对候选食物计算 4 维目标向量
 *   2. 计算 Pareto 前沿（非支配排序）
 *   3. 用偏好加权切比雪夫距离从 Pareto 前沿中选取 Top-K
 *
 * 设计约束:
 *   - 纯函数，无副作用，无外部依赖
 *   - 扩展现有全局优化器，不替换
 *   - 当 multiObjective.enabled=false 时整个模块不参与流程
 *   - Pareto 非支配排序复杂度 O(n²)，通过 paretoFrontLimit 控制上界
 */

import { ScoredFood } from './recommendation.types';
import {
  MultiObjectiveConfig,
  MultiObjectiveDimension,
  MULTI_OBJECTIVE_DIMENSIONS,
} from '../../../strategy/strategy.types';
import { FoodLibrary } from '../../../food/entities/food-library.entity';

// ─── 默认配置 ───

/** 默认偏好权重（健康优先，兼顾口味） */
const DEFAULT_PREFERENCES: Record<MultiObjectiveDimension, number> = {
  health: 0.4,
  taste: 0.3,
  cost: 0.15,
  convenience: 0.15,
};

/** 默认口味偏好（中性，无特别偏好） */
const DEFAULT_TASTE_PREFERENCE = {
  spicy: 0.3,
  sweet: 0.4,
  salty: 0.4,
  sour: 0.3,
  umami: 0.5,
  bitter: 0.2,
};

/** Pareto 前沿默认最大保留数 */
const DEFAULT_PARETO_LIMIT = 20;

/** 成本等级反转映射: costLevel(1-5) → costScore(0-1)，越便宜分越高 */
const COST_SCORE_MAP: Record<number, number> = {
  1: 1.0,
  2: 0.75,
  3: 0.5,
  4: 0.25,
  5: 0.0,
};

/** 技能需求评分: easy=1, medium=0.6, hard=0.3 */
const SKILL_SCORE_MAP: Record<string, number> = {
  easy: 1.0,
  medium: 0.6,
  hard: 0.3,
};

// ─── 类型定义 ───

/**
 * 多目标评分后的食物 — 在 ScoredFood 基础上附加 4 维独立目标分
 */
export interface MultiObjectiveScoredFood {
  /** 原始的 ScoredFood（保持不变） */
  scoredFood: ScoredFood;
  /** 4 维独立目标分（均归一化到 0-1，越高越好） */
  objectives: Record<MultiObjectiveDimension, number>;
  /** 偏好加权综合分（用于最终排序） */
  compositeScore: number;
  /** 是否属于 Pareto 前沿 */
  isPareto: boolean;
  /** Pareto 非支配层级（0=前沿，1=次前沿...） */
  paretoRank: number;
}

/**
 * 多目标优化结果
 */
export interface MultiObjectiveResult {
  /** 优化后的排序结果（按 compositeScore 降序） */
  ranked: MultiObjectiveScoredFood[];
  /** Pareto 前沿食物数量 */
  paretoFrontSize: number;
  /** 使用的偏好权重 */
  appliedPreferences: Record<MultiObjectiveDimension, number>;
}

// ─── 核心函数 ───

/**
 * 多目标优化入口 — 对候选食物做多维度独立评分 + Pareto 排序
 *
 * @param candidates Rank 阶段输出的候选食物（已有 score）
 * @param config 多目标优化配置（来自 StrategyConfig.multiObjective）
 * @param maxScoreInPool 当前候选池中的最高 score（用于 health 维度归一化）
 * @returns 多目标优化结果
 */
export function multiObjectiveOptimize(
  candidates: ScoredFood[],
  config: MultiObjectiveConfig,
  maxScoreInPool?: number,
): MultiObjectiveResult {
  if (candidates.length === 0) {
    return {
      ranked: [],
      paretoFrontSize: 0,
      appliedPreferences: DEFAULT_PREFERENCES,
    };
  }

  // 1. 解析配置
  const preferences = resolvePreferences(config);
  const tasteRef = resolveTastePreference(config);
  const paretoLimit = config.paretoFrontLimit ?? DEFAULT_PARETO_LIMIT;

  // 2. 计算最大 score（用于归一化 health 维度）
  const maxScore =
    maxScoreInPool ?? Math.max(...candidates.map((c) => c.score), 1);

  // 3. 为每个候选食物计算 4 维目标向量
  const scored: MultiObjectiveScoredFood[] = candidates.map((sf) => {
    const objectives = computeObjectives(sf, maxScore, tasteRef);
    return {
      scoredFood: sf,
      objectives,
      compositeScore: 0, // 稍后填充
      isPareto: false,
      paretoRank: -1,
    };
  });

  // 4. 非支配排序（Pareto ranking）
  assignParetoRanks(scored);

  // 5. 标记 Pareto 前沿
  const paretoFrontSize = scored.filter((s) => s.paretoRank === 0).length;
  for (const s of scored) {
    s.isPareto = s.paretoRank === 0;
  }

  // 6. 计算偏好加权综合分
  //    使用加权切比雪夫距离的变体: 离理想点越近分越高
  //    compositeScore = Σ(w_i × objective_i) + Pareto 层级奖励
  for (const s of scored) {
    const weightedSum = MULTI_OBJECTIVE_DIMENSIONS.reduce((sum, dim) => {
      return sum + preferences[dim] * s.objectives[dim];
    }, 0);

    // Pareto 层级奖励: 前沿 +0.1，次前沿 +0.05，其余无奖励
    // 这确保 Pareto 最优解在综合分相近时有优势
    const paretoBonus =
      s.paretoRank === 0 ? 0.1 : s.paretoRank === 1 ? 0.05 : 0;

    s.compositeScore = weightedSum + paretoBonus;
  }

  // 7. 按 compositeScore 降序排列（Pareto 前沿内保留原始 score 作为 tiebreaker）
  scored.sort((a, b) => {
    if (Math.abs(a.compositeScore - b.compositeScore) > 0.001) {
      return b.compositeScore - a.compositeScore;
    }
    // 综合分相同时，按原始评分排序
    return b.scoredFood.score - a.scoredFood.score;
  });

  // 8. 如果 Pareto 前沿过大，截断以控制下游复杂度
  if (scored.length > paretoLimit * 3) {
    scored.length = paretoLimit * 3;
  }

  return {
    ranked: scored,
    paretoFrontSize,
    appliedPreferences: preferences,
  };
}

/**
 * 从多目标优化结果中提取最终的 ScoredFood 列表
 * 用 compositeScore 覆盖原始 score（归一化到原始量级）
 *
 * @param result 多目标优化结果
 * @param limit 返回数量限制
 * @returns 重排序后的 ScoredFood 列表
 */
export function extractRankedFoods(
  result: MultiObjectiveResult,
  limit?: number,
): ScoredFood[] {
  const items = limit ? result.ranked.slice(0, limit) : result.ranked;

  // 找到原始分数的最大值用于反映射
  const origMaxScore = Math.max(...items.map((i) => i.scoredFood.score), 1);

  return items.map((item) => ({
    ...item.scoredFood,
    // 将 compositeScore(0-1.1) 映射回原始评分量级
    // 保证排序一致性，同时保留原始评分的可读性
    score: item.compositeScore * origMaxScore,
  }));
}

// ─── 目标维度计算 ───

/**
 * 计算单个食物的 4 维目标向量
 */
function computeObjectives(
  sf: ScoredFood,
  maxScore: number,
  tasteRef: Required<NonNullable<MultiObjectiveConfig['tastePreference']>>,
): Record<MultiObjectiveDimension, number> {
  return {
    health: computeHealthScore(sf, maxScore),
    taste: computeTasteScore(sf.food, tasteRef),
    cost: computeCostScore(sf.food),
    convenience: computeConvenienceScore(sf.food),
  };
}

/**
 * 健康度: 直接使用现有 10 维加权评分，归一化到 0-1
 */
function computeHealthScore(sf: ScoredFood, maxScore: number): number {
  if (maxScore <= 0) return 0.5;
  return Math.min(1, Math.max(0, sf.score / maxScore));
}

/**
 * 口味匹配度: 用户口味偏好向量 vs 食物 flavorProfile 的余弦相似度
 *
 * 如果食物没有 flavorProfile，返回中性分 0.5（不奖励也不惩罚）
 */
function computeTasteScore(
  food: FoodLibrary,
  tasteRef: Required<NonNullable<MultiObjectiveConfig['tastePreference']>>,
): number {
  const fp = food.flavorProfile;
  if (!fp) return 0.5;

  const dims = ['spicy', 'sweet', 'salty', 'sour', 'umami', 'bitter'] as const;

  // 构建两个向量
  const userVec = dims.map((d) => tasteRef[d]);
  const foodVec = dims.map((d) => fp[d] ?? 0);

  // 余弦相似度
  let dot = 0;
  let normU = 0;
  let normF = 0;
  for (let i = 0; i < dims.length; i++) {
    dot += userVec[i] * foodVec[i];
    normU += userVec[i] * userVec[i];
    normF += foodVec[i] * foodVec[i];
  }

  const denom = Math.sqrt(normU) * Math.sqrt(normF);
  if (denom === 0) return 0.5;

  // 余弦相似度范围 [-1, 1]，映射到 [0, 1]
  const cosSim = dot / denom;
  return (cosSim + 1) / 2;
}

/**
 * 价格经济性: estimatedCostLevel 反转归一化
 *
 * costLevel 1(便宜) → 1.0, 5(昂贵) → 0.0
 * 无数据时返回中性分 0.5
 */
function computeCostScore(food: FoodLibrary): number {
  const level = food.estimatedCostLevel;
  if (!level) return 0.5;
  return COST_SCORE_MAP[Math.min(5, Math.max(1, level))] ?? 0.5;
}

/**
 * 便利性/可获取性: 综合 prepTime + cookTime + skillRequired
 *
 * 公式: 0.4 × timeScore + 0.3 × skillScore + 0.3 × processingScore
 *   - timeScore: 总时间(分钟)，0min=1.0, 60min+=0.0（线性插值）
 *   - skillScore: easy=1.0, medium=0.6, hard=0.3
 *   - processingScore: isProcessed(加工食品更容易获取) + processingLevel
 *
 * 无数据时返回中性分 0.5
 */
function computeConvenienceScore(food: FoodLibrary): number {
  let hasAnyData = false;
  let totalWeight = 0;
  let weightedScore = 0;

  // 时间分（40% 权重）
  const prepTime = food.prepTimeMinutes ?? 0;
  const cookTime = food.cookTimeMinutes ?? 0;
  const totalTime = prepTime + cookTime;
  if (food.prepTimeMinutes != null || food.cookTimeMinutes != null) {
    hasAnyData = true;
    // 0 分钟 → 1.0, 60+ 分钟 → 0.0
    const timeScore = Math.max(0, 1 - totalTime / 60);
    totalWeight += 0.4;
    weightedScore += 0.4 * timeScore;
  }

  // 技能分（30% 权重）
  if (food.skillRequired) {
    hasAnyData = true;
    const skillScore = SKILL_SCORE_MAP[food.skillRequired] ?? 0.5;
    totalWeight += 0.3;
    weightedScore += 0.3 * skillScore;
  }

  // 加工程度分（30% 权重）— 加工食品通常更方便获取
  if (food.processingLevel != null) {
    hasAnyData = true;
    // processingLevel: 1(天然) ~ 4(深加工)
    // 便利性角度: 加工程度越高越方便，但不能太高（4 级反而不健康不推荐）
    // 用倒 U 形: 1→0.3, 2→0.7, 3→1.0, 4→0.8
    const procScoreMap: Record<number, number> = {
      1: 0.3,
      2: 0.7,
      3: 1.0,
      4: 0.8,
    };
    const procScore = procScoreMap[food.processingLevel] ?? 0.5;
    totalWeight += 0.3;
    weightedScore += 0.3 * procScore;
  }

  if (!hasAnyData) return 0.5;
  return totalWeight > 0 ? weightedScore / totalWeight : 0.5;
}

// ─── Pareto 非支配排序 ───

/**
 * 非支配排序 — 为每个解分配 Pareto 层级
 *
 * 定义: 解 A 支配解 B 当且仅当 A 在所有维度 >= B 且至少一个维度 > B
 *
 * 算法: 朴素 O(n²) 非支配排序
 * - 第 0 层: 不被任何解支配的解（Pareto 前沿）
 * - 第 1 层: 去掉第 0 层后的 Pareto 前沿
 * - 以此类推
 *
 * 对于推荐场景 n 通常 < 100，O(n²) 完全可接受
 */
function assignParetoRanks(items: MultiObjectiveScoredFood[]): void {
  const n = items.length;
  const ranks = new Array<number>(n).fill(-1);
  const remaining = new Set<number>();
  for (let i = 0; i < n; i++) remaining.add(i);

  let currentRank = 0;
  while (remaining.size > 0) {
    // 找到当前层的非支配解
    const frontIndices: number[] = [];

    for (const i of remaining) {
      let isDominated = false;
      for (const j of remaining) {
        if (i === j) continue;
        if (dominates(items[j].objectives, items[i].objectives)) {
          isDominated = true;
          break;
        }
      }
      if (!isDominated) {
        frontIndices.push(i);
      }
    }

    // 标记层级并从候选集中移除
    for (const idx of frontIndices) {
      ranks[idx] = currentRank;
      remaining.delete(idx);
    }

    currentRank++;

    // 安全阀: 防止死循环（理论上不会发生）
    if (currentRank > n) break;
  }

  // 写回层级
  for (let i = 0; i < n; i++) {
    items[i].paretoRank = ranks[i];
  }
}

/**
 * 判断解 A 是否支配解 B（A 在所有维度 >= B 且至少一个维度 > B）
 */
function dominates(
  objA: Record<MultiObjectiveDimension, number>,
  objB: Record<MultiObjectiveDimension, number>,
): boolean {
  let allGeq = true;
  let anyGreater = false;

  for (const dim of MULTI_OBJECTIVE_DIMENSIONS) {
    if (objA[dim] < objB[dim]) {
      allGeq = false;
      break;
    }
    if (objA[dim] > objB[dim]) {
      anyGreater = true;
    }
  }

  return allGeq && anyGreater;
}

// ─── 配置解析辅助 ───

/**
 * 解析偏好权重: 用户配置 + 默认值合并，并归一化使总和 = 1
 */
function resolvePreferences(
  config: MultiObjectiveConfig,
): Record<MultiObjectiveDimension, number> {
  const raw: Record<MultiObjectiveDimension, number> = {
    ...DEFAULT_PREFERENCES,
    ...(config.preferences ?? {}),
  };

  // 应用成本敏感度: 放大/缩小 cost 权重
  if (config.costSensitivity != null) {
    const sensitivity = Math.max(0, Math.min(1, config.costSensitivity));
    // 敏感度 0.5 = 不调整, 1.0 = cost 权重翻倍, 0 = cost 权重减半
    raw.cost *= 0.5 + sensitivity;
  }

  // 归一化使总和 = 1
  const total = MULTI_OBJECTIVE_DIMENSIONS.reduce(
    (sum, dim) => sum + raw[dim],
    0,
  );
  if (total > 0) {
    for (const dim of MULTI_OBJECTIVE_DIMENSIONS) {
      raw[dim] /= total;
    }
  }

  return raw;
}

/**
 * 解析口味偏好向量
 */
function resolveTastePreference(
  config: MultiObjectiveConfig,
): Required<NonNullable<MultiObjectiveConfig['tastePreference']>> {
  return {
    ...DEFAULT_TASTE_PREFERENCE,
    ...(config.tastePreference ?? {}),
  };
}
