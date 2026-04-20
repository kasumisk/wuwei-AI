/**
 * V4.4: 分析结果核心类型（从 analysis-result.types.ts 拆分）
 */

import { SubscriptionTier } from '../../subscription/subscription.types';
import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';
import type { DecisionOutput } from '../decision/food-decision.service';
import {
  UnifiedUserContext,
  MacroSlotStatus,
  ExplanationNode,
} from './user-context.types';
import {
  AnalyzedFoodItem,
  NutritionTotals,
  AnalysisScore,
  FoodAlternative,
} from './food-item.types';
import {
  FoodDecision,
  DecisionSummary,
  StructuredDecision,
} from './decision.types';

/** V2.3: 分析状态对象 */
export interface AnalysisState {
  meal: {
    foods: AnalyzedFoodItem[];
    totals: NutritionTotals;
    score: AnalysisScore;
  };
  preMealContext: {
    todayTotalsBeforeMeal: NutritionTotals;
    remainingBeforeMeal: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
    };
    currentMealIndex: number;
    mealType: string;
  };
  projectedAfterMeal: {
    todayTotalsAfterMeal: NutritionTotals;
    completionRatio: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
    };
  };
}

/** V2.3: 分层置信度诊断 */
export interface ConfidenceDiagnostics {
  recognitionConfidence: number;
  normalizationConfidence: number;
  nutritionEstimationConfidence: number;
  decisionConfidence: number;
  overallConfidence: number;
  /** V2.8: 分析质量分层 */
  analysisQualityBand?: 'high' | 'medium' | 'low';
  /** V2.8: 低质量来源信号 */
  qualitySignals?: string[];
  /** V2.9: 分析完整度（0-1） */
  analysisCompletenessScore?: number;
  /** V2.9: 复核级别 */
  reviewLevel?: 'auto_review' | 'manual_review';
  uncertaintyReasons: string[];
}

/**
 * V3.1: Prompt 输出深度级别
 */
export type PromptDepthLevel = 'brief' | 'standard' | 'detailed';

/**
 * V3.1: 结构化教练输出模板
 */
export interface CoachOutputSchema {
  verdict: 'recommend' | 'caution' | 'avoid';
  mainReason: string;
  actionSteps: string[];
  cautionNote?: string;
  confidenceNote?: string;
}

/** V2.3: 统一证据块 */
export interface EvidencePack {
  scoreEvidence: string[];
  contextEvidence: string[];
  issueEvidence: string[];
  decisionEvidence: string[];
  /** V3.0: 结构化解释节点 */
  explanationNodes?: ExplanationNode[];
  /** V3.0: 解析出的语气修饰符 */
  toneModifier?: string;
  /** V3.1: prompt 输出深度驱动 */
  promptDepth?: PromptDepthLevel;
  /** V3.1: 结构化教练输出模板 */
  structuredOutput?: CoachOutputSchema;
  /** V3.1: 每日宏量摘要自然语言 */
  dailyMacroSummary?: string;
}

/** V2.3: 吃后补偿动作 */
export interface RecoveryAction {
  nextMealDirection: string;
  todayAdjustment: string;
}

/** V2.3: Should Eat 行动决策对象 */
export interface ShouldEatAction {
  verdict: 'recommend' | 'caution' | 'avoid';
  shouldEat: boolean;
  mode: 'pre_eat' | 'post_eat';
  primaryReason: string;
  evidence: string[];
  immediateAction: string;
  followUpActions?: string[];
  portionAction?: {
    suggestedPercent: number;
    suggestedCalories: number;
  };
  replacementAction?: {
    strategy: 'replace_food' | 'reduce_portion' | 'change_pairing';
    candidates: FoodAlternative[];
  };
  recoveryAction?: RecoveryAction;
}

/** V2.3: 教练行动计划 */
export interface CoachActionPlan {
  conclusion: string;
  conclusionData?: {
    calories?: number;
    remainingCalories?: number;
    score?: number;
  };
  why: string[];
  doNow: string[];
  ifAlreadyAte?: string[];
  alternatives?: string[];
  tone: 'strict' | 'encouraging' | 'neutral';
  nextMeal?: string;
  educationPoint?: string;
  behaviorInsight?: string;
  streakContext?: string;
}

/** 输入快照 */
export interface AnalysisInputSnapshot {
  rawText?: string;
  imageUrl?: string;
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
}

/**
 * 分析解释说明
 */
export interface AnalysisExplanation {
  summary: string;
  primaryReason?: string;
  userContextImpact?: string[];
  causalNarrative?: string;
  upgradeTeaser?: string;
  /** V4.9 P3.3: Per-food dual display — per-100g base + actual per-serving intake */
  nutritionBreakdown?: NutritionDualDisplay[];
}

/**
 * V4.9 P3.3: Dual nutrition display for a single food item
 * Shows both the per-100g reference values and actual per-serving values
 */
export interface NutritionDualDisplay {
  name: string;
  estimatedWeightGrams: number;
  per100g: { calories: number; protein: number; fat: number; carbs: number };
  perServing: { calories: number; protein: number; fat: number; carbs: number };
}

/**
 * 入库决策信息
 */
export interface IngestionDecision {
  matchedExistingFoods: boolean;
  shouldPersistCandidate: boolean;
  reviewRequired: boolean;
}

/**
 * 权益裁剪信息
 */
export interface EntitlementInfo {
  tier: SubscriptionTier;
  fieldsHidden: string[];
}

/**
 * V3.2 Phase 1: 分析准确度级别
 */
export type AccuracyLevel = 'high' | 'medium' | 'low';

/**
 * V3.2 Phase 1: 食物分析包
 */
export interface FoodAnalysisPackage {
  totalCalories: number;
  macros: {
    protein: number;
    fat: number;
    carbs: number;
  };
  accuracyLevel: AccuracyLevel;
  accuracyScore: number;
  accuracyFactors: {
    confidence: number;
    reviewLevel: 'auto_review' | 'manual_review';
    completenessScore: number;
  };
  nutritionBreakdown: NutritionScoreBreakdown;
  decisionImpact?: {
    shouldDowngrade: boolean;
    reason?: string;
  };
}

/**
 * V3.2 Phase 1: 营养问题类型
 */
export type IssueType =
  | 'protein_deficit'
  | 'fat_excess'
  | 'carb_excess'
  | 'fiber_deficit'
  | 'sodium_excess'
  | 'calorie_excess'
  | 'calorie_deficit'
  | 'sugar_excess'
  | 'glycemic_risk'
  | 'cardiovascular_risk'
  | 'sodium_risk'
  | 'purine_risk'
  | 'kidney_stress'
  | 'binge_risk_window'
  | 'trend_excess';

/**
 * V3.2 Phase 1: 结构化营养问题
 */
export interface NutritionIssue {
  type: IssueType;
  severity: 'low' | 'medium' | 'high';
  metric: number;
  threshold: number;
  implication: string;
}

/**
 * V3.2 Phase 1: 推荐系统上下文条件
 */
export interface RecommendationContext {
  remainingCalories: number;
  targetMacros: {
    protein: number;
    fat: number;
    carbs: number;
  };
  excludeFoods: string[];
  preferredScenarios: string[];
}

/**
 * V3.2 Phase 1: 上下文分析
 */
export interface ContextualAnalysis {
  macroSlotStatus: MacroSlotStatus;
  macroProgress: {
    consumed: NutritionTotals;
    remaining: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
    };
  };
  identifiedIssues: NutritionIssue[];
  recommendationContext: RecommendationContext;
}

/**
 * V3.2 Phase 1: 分析准确度刷新包
 */
export interface AnalysisAccuracyMetrics {
  level: AccuracyLevel;
  score: number;
  factors: {
    confidence: number;
    reviewLevel: 'auto_review' | 'manual_review';
    completenessScore: number;
  };
  decisionImpact?: {
    shouldDowngrade: boolean;
    reason?: string;
  };
}

/**
 * V6.1 统一食物分析结果
 */
export interface FoodAnalysisResultV61 {
  analysisId: string;
  inputType: 'text' | 'image';
  inputSnapshot: AnalysisInputSnapshot;
  foods: AnalyzedFoodItem[];
  totals: NutritionTotals;
  score: AnalysisScore;
  decision: FoodDecision;
  alternatives: FoodAlternative[];
  explanation: AnalysisExplanation;
  ingestion?: IngestionDecision;
  entitlement: EntitlementInfo;
  summary?: DecisionSummary;
  analysisState?: AnalysisState;
  confidenceDiagnostics?: ConfidenceDiagnostics;
  evidencePack?: EvidencePack;
  shouldEatAction?: ShouldEatAction;
  coachActionPlan?: CoachActionPlan;
  foodAnalysisPackage?: FoodAnalysisPackage;
  structuredDecision?: StructuredDecision;
  contextualAnalysis?: ContextualAnalysis;
  unifiedUserContext?: UnifiedUserContext;
}
