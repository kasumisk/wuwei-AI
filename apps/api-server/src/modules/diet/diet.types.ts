// Enums and types extracted from entity files for use after TypeORM removal

import type { ExplanationV2 } from './app/recommendation/scoring-explanation.interface';

/**
 * 实验状态
 */
export enum ExperimentStatus {
  DRAFT = 'draft',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

/**
 * 实验分组配置
 */
export interface ExperimentGroup {
  /** 分组名称，如 'control', 'variant_a', 'variant_b' */
  name: string;
  /** 流量占比 0-1，所有组之和应 = 1.0 */
  trafficRatio: number;
  /** 该组使用的评分权重覆盖（可选，null 表示使用默认权重） */
  scoreWeightOverrides?: Record<string, number[]> | null;
  /** 该组使用的餐次权重修正覆盖 */
  mealWeightOverrides?: Record<string, Record<string, number>> | null;
}

/**
 * 单个食物条目 — 保留在 MealPlan 中供替换定位
 */
export interface MealFoodItem {
  foodId: string;
  name: string;
  /** 份量描述，如 "100g" */
  servingDesc: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  category: string;
}

export interface MealPlan {
  /** 展示文本（向后兼容） */
  foods: string;
  /** 结构化食物列表 — 用于替换定位和反馈记录 */
  foodItems?: MealFoodItem[];
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  tip: string;
  /** V5 3.6: 每个食物的用户可读推荐解释（foodId → 解释） */
  explanations?: Record<string, MealFoodExplanation>;
}

/**
 * V5 3.6: 持久化在 MealPlan 中的食物解释（轻量版，仅存储文案不存储 ScoringExplanation）
 * V6 2.7: 新增可选 V2 可视化数据（radarChart, progressBars, comparisonCard）
 * V6.3 P2-3: scoreBreakdown 改为可选（simple 级别不输出）
 */
export interface MealFoodExplanation {
  primaryReason: string;
  nutritionHighlights: Array<{
    label: string;
    type: 'positive' | 'neutral';
    value: string;
  }>;
  healthTip?: string;
  scoreBreakdown?: Array<{ dimension: string; score: number }>;
  /** V6 2.7: 完整 V2 可视化解释（可选，前端支持时使用） */
  v2?: ExplanationV2;
}

export interface PlanAdjustment {
  time: string;
  reason: string;
  newPlan: Partial<Record<'morning' | 'lunch' | 'dinner' | 'snack', MealPlan>>;
}

/**
 * 餐食类型枚举
 */
export enum MealType {
  BREAKFAST = 'breakfast',
  LUNCH = 'lunch',
  DINNER = 'dinner',
  SNACK = 'snack',
}

/**
 * 记录来源枚举
 */
export enum RecordSource {
  SCREENSHOT = 'screenshot',
  CAMERA = 'camera',
  MANUAL = 'manual',
  /** V6.1: 文本分析后保存 */
  TEXT_ANALYSIS = 'text_analysis',
  /** V6.1: 图片分析后保存 */
  IMAGE_ANALYSIS = 'image_analysis',
}
