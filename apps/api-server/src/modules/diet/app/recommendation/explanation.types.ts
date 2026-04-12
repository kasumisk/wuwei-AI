/**
 * V7.6 P2-A: 解释系统类型定义
 *
 * 从 explanation-generator.service.ts 提取的所有 interface / type 定义。
 * 将纯类型与业务逻辑解耦，消除循环依赖风险。
 */

import type { MealCompositionScore } from './meal-composition-scorer.service';

// ==================== 用户可读解释类型 ====================

/**
 * V6.6 Phase 2-E: 推荐变化解释
 * 今日推荐与昨日显著不同时生成，向用户说明变化原因
 */
export interface DeltaExplanation {
  /** 今日新出现（昨日没有）的食物名称列表 */
  changedFoods: string[];
  /** 主要变化原因（人类可读） */
  primaryReason: string;
  /** 置信度 — 数据质量越高置信度越高 */
  confidence: 'high' | 'medium' | 'low';
}

/** 营养亮点标签 */
export interface NutritionTag {
  /** 标签文案：如 "高蛋白" | "低GI" | "富含膳食纤维" */
  label: string;
  /** 标签倾向 */
  type: 'positive' | 'neutral';
  /** 具体数值描述：如 "28g 蛋白质" | "GI 35" */
  value: string;
}

/** 简化评分柱 */
export interface SimpleScoreBar {
  /** 维度名称（国际化后的显示名） */
  dimension: string;
  /** 0-100 分 */
  score: number;
}

/** 用户可读的推荐解释 */
export interface UserFacingExplanation {
  /** 主要推荐理由（1-2 句话） */
  primaryReason: string;
  /** 营养亮点标签（最多 3 个） */
  nutritionHighlights: NutritionTag[];
  /** 健康相关提示（如果有健康条件） */
  healthTip?: string;
  /** 评分概览（简化版，最多 5 个维度） */
  scoreBreakdown: SimpleScoreBar[];
  /** V6.3 P3-3: 解释风格实验分桶 */
  styleVariant?: 'concise' | 'coaching';
}

/** V6.3 P3-1: 整餐层面解释 */
/** V6.5 Phase 2E: 从一句话升级为结构化整餐分析 */
export interface MealCompositionExplanation {
  /** 一句话解释为什么这样搭配 */
  summary: string;
  /** V6.5: 整餐组合评分（由 MealCompositionScorer 计算） */
  compositionScore?: MealCompositionScore;
  /** V6.5: 营养互补关系列表 */
  complementaryPairs?: ComplementaryPairExplanation[];
  /** V6.5: 宏量营养素分布 */
  macroBalance?: MacroBalanceInfo;
  /** V6.5: 多样性建议（如"建议增加一道蒸菜"） */
  diversityTips?: string[];
}

/** V6.5: 营养互补对解释 */
export interface ComplementaryPairExplanation {
  nutrientA: string;
  foodA: string;
  nutrientB: string;
  foodB: string;
  benefit: string;
}

/** V6.5: 宏量营养素分布信息 */
export interface MacroBalanceInfo {
  caloriesTotal: number;
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
  /** 与目标的匹配度 0-100 */
  targetMatch: number;
}

export type ExplanationStyleVariant = 'concise' | 'coaching';

// ─── V7.4 P2-F: 对比/替代解释类型 ───

/**
 * V7.4 P2-F: 食物对比解释
 */
export interface ComparisonExplanation {
  /** 推荐的食物名称 */
  recommendedFood: string;
  /** 对比的食物名称 */
  alternativeFood: string;
  /** 推荐食物的优势列表 */
  advantages: string[];
  /** 推荐食物的劣势列表 */
  disadvantages: string[];
  /** 评分差值（推荐 - 对比） */
  scoreDifference: number;
  /** 评分百分比差异 */
  scorePercentage: number;
  /** 人类可读的总结 */
  summary: string;
}

/**
 * V7.4 P2-F: 食物替代解释
 */
export interface SubstitutionExplanation {
  /** 原推荐食物名称 */
  originalFood: string;
  /** 替代食物名称 */
  substituteFood: string;
  /** 热量变化（正=增加，负=减少） */
  calorieChange: number;
  /** 蛋白质变化 */
  proteinChange: number;
  /** 纤维变化 */
  fiberChange: number;
  /** 是否为好的替代（热量变化 < 15%，蛋白质不显著减少） */
  isGoodSubstitute: boolean;
  /** 是否同品类替代 */
  sameCategorySubstitute: boolean;
  /** 营养影响列表 */
  impacts: string[];
  /** 人类可读的替代建议 */
  suggestion: string;
}
