/**
 * V4.6: Pipeline 阶段性中间类型
 *
 * V4.4 原版: AnalyzeStageResult / DecideStageResult / PostProcessStageResult
 * V4.6 新增: 4 个语义化 Phase 类型（Analysis / Scoring / Decision / Coach）
 *            用于 pipeline 内部步骤间传递，与 Stage 类型共存。
 */

import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';
import type { DecisionOutput } from '../decision/food-decision.service';
import { UnifiedUserContext } from './user-context.types';
import {
  AnalyzedFoodItem,
  NutritionTotals,
  AnalysisScore,
  FoodAlternative,
} from './food-item.types';
import { DecisionSummary, StructuredDecision } from './decision.types';
import {
  AnalysisState,
  ContextualAnalysis,
  NutritionIssue,
  ShouldEatAction,
  RecoveryAction,
  EvidencePack,
  ConfidenceDiagnostics,
  FoodAnalysisPackage,
} from './analysis.types';

// ==================== Stage 类型（V3.9 遗留，pipeline 编排用）====================

/**
 * V3.9: 分析阶段输出
 */
export interface AnalyzeStageResult {
  analysisId: string;
  foods: AnalyzedFoodItem[];
  totals: NutritionTotals;
  userContext: UnifiedUserContext;
  score: AnalysisScore;
  contextualAnalysis: ContextualAnalysis | null;
  avgConfidence: number;
  breakdown: NutritionScoreBreakdown | null;
  nutritionIssues: NutritionIssue[];
  analysisState: AnalysisState;
}

/**
 * V3.9: 决策阶段输出
 */
export interface DecideStageResult {
  decision: DecisionOutput;
  structuredDecision: StructuredDecision | null;
  summary: DecisionSummary;
}

/**
 * V3.9: 后处理阶段输出
 */
export interface PostProcessStageResult {
  shouldEatAction: ShouldEatAction | null;
  recoveryAction: RecoveryAction | undefined;
  evidencePack: EvidencePack;
  confidenceDiagnostics: ConfidenceDiagnostics;
  analysisAccuracy: FoodAnalysisPackage;
}

// ==================== V4.6: 语义化 Phase 类型 ====================

/**
 * V4.6 Phase 1 — 分析阶段结果
 *
 * 食物识别 + 营养汇总 + 上下文分析。
 * 不含评分和决策，纯数据提取。
 */
export interface AnalysisPhaseResult {
  analysisId: string;
  foods: AnalyzedFoodItem[];
  totals: NutritionTotals;
  userContext: UnifiedUserContext;
  contextualAnalysis: ContextualAnalysis | null;
  avgConfidence: number;
  nutritionIssues: NutritionIssue[];
  analysisState: AnalysisState;
}

/**
 * V4.6 Phase 2 — 评分阶段结果
 *
 * 基于分析结果 + 用户画像的多维评分。
 */
export interface ScoringPhaseResult {
  score: AnalysisScore;
  breakdown: NutritionScoreBreakdown | null;
}

/**
 * V4.6 Phase 3 — 决策阶段结果
 *
 * 吃/不吃判断 + 替代方案 + 结构化决策 + 摘要。
 */
export interface DecisionPhaseResult {
  decision: DecisionOutput;
  structuredDecision: StructuredDecision | null;
  summary: DecisionSummary;
  alternatives: FoodAlternative[];
}

/**
 * V4.6 Phase 4 — 教练阶段结果
 *
 * 置信诊断 + 证据包 + 行动建议 + 恢复方案。
 * Phase 3 完整实现，此处预留类型定义。
 */
export interface CoachPhaseResult {
  shouldEatAction: ShouldEatAction | null;
  recoveryAction: RecoveryAction | undefined;
  evidencePack: EvidencePack;
  confidenceDiagnostics: ConfidenceDiagnostics;
  analysisAccuracy: FoodAnalysisPackage;
  /** V4.6: 教练个性化消息（Phase 3 填充） */
  coachMessage?: string;
  /** V4.6: 行为洞察标签（Phase 3 填充） */
  behaviorTags?: string[];
}
