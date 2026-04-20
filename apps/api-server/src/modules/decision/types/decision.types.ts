/**
 * V4.4: 决策相关类型（从 analysis-result.types.ts 拆分）
 */

import { SignalTraceItem } from './user-context.types';
import { FoodAlternative, DietIssue } from './food-item.types';

/** V1.6: 评分维度解释 */
export interface BreakdownExplanation {
  /** 维度键 */
  dimension: string;
  /** 本地化标签 */
  label: string;
  /** 维度分数 0-100 */
  score: number;
  /** 影响等级 */
  impact: 'positive' | 'warning' | 'critical';
  /** 人类可读解释 */
  message: string;
  /** V1.7: 实际值 */
  actualValue?: number;
  /** V1.7: 目标/推荐值 */
  targetValue?: number;
  /** V1.7: 单位 */
  unit?: string;
  /** V1.9: 改善建议（当 impact 为 warning/critical 时） */
  suggestion?: string;
}

/** V1.6: 决策推理链步骤 */
export interface DecisionChainStep {
  /** 步骤名称 */
  step: string;
  /** 输入摘要 */
  input: string;
  /** 输出摘要 */
  output: string;
  /** V1.9: 步骤置信度 (0-1) */
  confidence?: number;
  /** V3.9 P2.4: 关键数据快照（每步附上决策依据数据） */
  snapshot?: Record<string, unknown>;
}

/**
 * 饮食决策建议
 */
export interface FoodDecision {
  /** 建议类型 */
  recommendation: 'recommend' | 'caution' | 'avoid';
  /** 是否建议食用 */
  shouldEat: boolean;
  /** 建议原因（一句话） */
  reason: string;
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high';
  /** P1-3: 具体行动建议 */
  advice?: string;
  /** V1.3: 结构化决策因子 */
  decisionFactors?: Array<{
    dimension: string;
    score: number;
    impact: 'critical' | 'warning' | 'positive';
    message: string;
  }>;
  /** V1.3: 最优份量建议 */
  optimalPortion?: {
    recommendedPercent: number;
    recommendedCalories: number;
  };
  /** V1.3: 下一餐建议 */
  nextMealAdvice?: {
    targetCalories: number;
    targetProtein: number;
    targetFat: number;
    targetCarbs: number;
    emphasis: string;
    suggestion: string;
  };
  /** V1.6: 决策推理链 */
  decisionChain?: DecisionChainStep[];
  /** V1.6: 7维评分解释 */
  breakdownExplanations?: BreakdownExplanation[];
  /** V1.7: 结构化问题识别 */
  issues?: DietIssue[];
}

/** V2.2: 决策结构化摘要 */
export interface DecisionSummary {
  /** 一句话摘要 */
  headline: string;
  /** 决策判定 */
  verdict: 'recommend' | 'caution' | 'avoid';
  /** 最严重的问题（最多 3 个） */
  topIssues: string[];
  /** 正面因素（最多 2 个） */
  topStrengths: string[];
  /** 可执行建议（最多 3 个） */
  actionItems: string[];
  /** 量化亮点 */
  quantitativeHighlight: string;
  /** V2.6: 供教练和前端直读的上下文信号 */
  contextSignals?: string[];
  /** V2.6: 当前这次判断最应该强调的教练关注点 */
  coachFocus?: string;
  /** 替代方案摘要 */
  alternativeSummary?: string;
  /** V2.8: 分析质量分层（高/中/低） */
  analysisQualityBand?: 'high' | 'medium' | 'low';
  /** V2.8: 分析质量一句话说明 */
  analysisQualityNote?: string;
  /** V2.8: 动态决策提示 */
  dynamicDecisionHint?: string;
  /** V2.8: 健康约束提示 */
  healthConstraintNote?: string;
  /** V2.9: 决策护栏 */
  decisionGuardrails?: string[];
  /** V2.9: 复核级别 */
  reviewLevel?: 'auto_review' | 'manual_review';
  /** V3.0: 有序信号追踪 */
  signalTrace?: SignalTraceItem[];
  /** V4.0: 行为上下文说明 */
  behaviorNote?: string;
}

/**
 * V3.3: 决策因素明细
 */
export interface DecisionFactorDetail {
  /** 维度评分 0-100 */
  score: number;
  /** 人类可读理由 */
  rationale: string;
}

/**
 * V3.3: 多维决策原因
 */
export interface DetailedRationale {
  /** 基础原因 */
  baseline: string;
  /** 上下文原因 */
  contextual: string;
  /** 目标对齐原因 */
  goalAlignment: string;
  /** 健康风险说明 */
  healthRisk: string | null;
  /** 时机建议 */
  timelinessNote: string | null;
}

/**
 * V3.3: 结构化决策
 */
export interface StructuredDecision {
  /** 三档判定 */
  verdict: 'recommend' | 'caution' | 'avoid';
  /** 四维决策因素 */
  factors: {
    nutritionAlignment: DecisionFactorDetail;
    macroBalance: DecisionFactorDetail;
    healthConstraint: DecisionFactorDetail;
    timeliness: DecisionFactorDetail;
  };
  /** 综合加权评分 0-100 */
  finalScore: number;
  /** 多维原因 */
  rationale: DetailedRationale;
}

// ==================== V4.5 P2.1: 冲突检测报告 ====================

/** 单条冲突项 */
export interface ConflictItem {
  /** 冲突类型 */
  type: 'allergen' | 'restriction' | 'health_condition';
  /** 严重程度 */
  severity: 'info' | 'warning' | 'critical';
  /** 是否强制覆盖决策 */
  decisionOverride?: 'avoid' | 'caution';
  /** 本地化消息 */
  message: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
}

/**
 * V4.5 P2.1: 冲突检测聚合报告
 * 统一 allergen / restriction / health_condition 三类冲突检测结果，
 * 消除 decision-engine 中对 contextReasons 字符串拼接的依赖。
 */
export interface ConflictReport {
  /** 是否存在任何冲突 */
  hasConflict: boolean;
  /** 最高严重等级（无冲突时为 'none'） */
  maxSeverity: 'none' | 'info' | 'warning' | 'critical';
  /** 最强决策覆盖（avoid > caution > undefined） */
  forceOverride?: 'avoid' | 'caution';
  /** 所有冲突条目（按 severity 降序排列） */
  items: ConflictItem[];
}

/**
 * V3.3: 推荐替代方案（结构化，融合推荐引擎）
 */
export interface RecommendationAlternative {
  /** 替代类型 */
  type: 'substitute' | 'adjust_portion' | 'combine_with';
  /** 建议文本 */
  suggestion: string;
  /** 推荐系统中的食物引用 */
  referenceFood?: {
    foodId: string;
    name: string;
    reason: string;
  };
  /** 替代方案的预期营养 */
  expectedNutrition: {
    calories: number;
    macros: { protein: number; fat: number; carbs: number };
  };
}
