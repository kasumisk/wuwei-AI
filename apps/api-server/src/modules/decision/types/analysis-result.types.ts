/**
 * V6.1 Phase 1.4 — 统一食物分析结果结构
 *
 * 文本分析和图片分析链路必须返回同一结构，方便前端、记录、画像、推荐统一消费。
 *
 * 设计原则:
 * - 结构完整但字段可选: 不是所有分析都能填满所有字段
 * - 裁剪友好: ResultEntitlementService 通过 entitlement.fieldsHidden 告知前端哪些字段被隐藏
 * - 入库友好: ingestion 段告知后续是否需要入库
 * - 前端友好: decision 段给出明确的三档建议（recommend/caution/avoid）
 */

import { SubscriptionTier } from '../../subscription/subscription.types';
import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';

// ==================== V2.0: 统一用户上下文 ====================

/**
 * V2.0: 统一用户上下文接口
 *
 * 合并 user-context-builder.service.ts 和 food-decision.service.ts 中
 * 各自定义的 UserContext，作为全系统唯一的用户上下文类型。
 */
export interface UnifiedUserContext {
  userId?: string;
  goalType: string;
  goalLabel: string;
  todayCalories: number;
  todayProtein: number;
  todayFat: number;
  todayCarbs: number;
  goalCalories: number;
  goalProtein: number;
  goalFat: number;
  goalCarbs: number;
  remainingCalories: number;
  remainingProtein: number;
  remainingFat: number;
  remainingCarbs: number;
  mealCount: number;
  /** 餐次类型（breakfast/lunch/dinner/snack） */
  mealType?: string;
  profile?: any;
  /** 当前本地小时 (0-23) */
  localHour: number;
  /** 用户过敏原列表 */
  allergens: string[];
  /** 用户饮食限制 */
  dietaryRestrictions: string[];
  /** 用户健康状况 */
  healthConditions: string[];
  /** V2.6: 当前热量预算状态 */
  budgetStatus?: 'under_target' | 'near_limit' | 'over_limit';
  /** V2.6: 当前最值得优先修正的营养方向 */
  nutritionPriority?: string[];
  /** V2.6: 决策层可直接消费的上下文信号 */
  contextSignals?: string[];
  /** V3.0: 四维宏量槽位状态（各宏量独立的 deficit/ok/excess） */
  macroSlotStatus?: MacroSlotStatus;
}

// ==================== V3.0 新增类型 ====================

/** V3.0: 驱动决策的信号追踪条目 */
export interface SignalTraceItem {
  /** 信号键（如 'protein_gap'） */
  signal: string;
  /** 优先级分值（来自 signal-priority.config） */
  priority: number;
  /** 信号来源 */
  source: 'user_context' | 'nutrition' | 'health_constraint' | 'time_window';
  /** 人类可读描述 */
  description: string;
}

/** V3.0: 四维宏量槽位感知 */
export interface MacroSlotStatus {
  calories: 'deficit' | 'ok' | 'excess';
  protein: 'deficit' | 'ok' | 'excess';
  fat: 'deficit' | 'ok' | 'excess';
  carbs: 'deficit' | 'ok' | 'excess';
  /** 缺口最大的宏量（影响决策优先级） */
  dominantDeficit?: 'protein' | 'fat' | 'carbs' | 'calories';
  /** 超标最大的宏量 */
  dominantExcess?: 'protein' | 'fat' | 'carbs' | 'calories';
}

/** V3.0: 结构化解释节点（供 coach 按步骤输出逻辑清晰的解释） */
export interface ExplanationNode {
  /** 步骤序号（1-based） */
  step: number;
  /** 来源标注（如 'nutrition_analysis' | 'user_goal' | 'health_constraint'） */
  source: string;
  /** 节点内容 */
  content: string;
  /** 重要程度 */
  weight?: 'high' | 'medium' | 'low';
}

// ==================== 统一分析结果 ====================

/**
 * V6.1 统一食物分析结果
 *
 * 文本链路和图片链路的最终输出格式
 */
export interface FoodAnalysisResultV61 {
  /** 分析记录 ID（UUID） */
  analysisId: string;

  /** 输入类型 */
  inputType: 'text' | 'image';

  /** 输入快照（用于回溯和展示） */
  inputSnapshot: AnalysisInputSnapshot;

  /** 识别/解析出的食物列表 */
  foods: AnalyzedFoodItem[];

  /** 汇总营养数据 */
  totals: NutritionTotals;

  /** 综合评分 */
  score: AnalysisScore;

  /** 饮食决策建议 */
  decision: FoodDecision;

  /** 替代建议列表（免费版可能被裁剪） */
  alternatives: FoodAlternative[];

  /** 解释说明 */
  explanation: AnalysisExplanation;

  /** 入库决策信息（后端内部使用，可选返回前端） */
  ingestion?: IngestionDecision;

  /** 权益裁剪信息（告知前端哪些字段因订阅等级被隐藏） */
  entitlement: EntitlementInfo;

  /** V2.2: 决策结构化摘要（教练 prompt 优先消费此字段） */
  summary?: DecisionSummary;

  /** V2.3: 分析状态对象（吃前/吃后投影） */
  analysisState?: AnalysisState;

  /** V2.3: 分层置信度诊断 */
  confidenceDiagnostics?: ConfidenceDiagnostics;

  /** V2.3: 统一证据块 */
  evidencePack?: EvidencePack;

  /** V2.3: 可执行 Should Eat 行动对象 */
  shouldEatAction?: ShouldEatAction;

  /** V2.3: 教练行动计划骨架 */
  coachActionPlan?: CoachActionPlan;
}

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
  /** V2.8: 分析质量分层（基于 decisionConfidence） */
  analysisQualityBand?: 'high' | 'medium' | 'low';
  /** V2.8: 低质量来源信号，供决策/教练解释使用 */
  qualitySignals?: string[];
  /** V2.9: 分析完整度（0-1） */
  analysisCompletenessScore?: number;
  /** V2.9: 复核级别 */
  reviewLevel?: 'auto_review' | 'manual_review';
  uncertaintyReasons: string[];
}

/** V2.3: 统一证据块 */
// ==================== V3.1 新增类型 ====================

/**
 * V3.1: Prompt 输出深度级别
 * - brief: 置信度高、分析完整时，输出精简版（核心结论 + 1条建议）
 * - standard: 常规输出（结论 + 原因 + 2-3条建议）
 * - detailed: 置信度低/需要人工复核时，输出详细版（含免责 + 解释节点）
 */
export type PromptDepthLevel = 'brief' | 'standard' | 'detailed';

/**
 * V3.1: 结构化教练输出模板
 * 由 EvidencePackBuilderService 组装，供 coach-prompt-builder 消费
 */
export interface CoachOutputSchema {
  verdict: 'recommend' | 'caution' | 'avoid';
  /** 1-2 句核心原因 */
  mainReason: string;
  /** 2-3 条可执行建议 */
  actionSteps: string[];
  /** 警告/免责（可选，caution/avoid 时填充） */
  cautionNote?: string;
  /** 置信度说明（detailed 模式专用） */
  confidenceNote?: string;
}

// ==================== 证据包 ====================

export interface EvidencePack {
  scoreEvidence: string[];
  contextEvidence: string[];
  issueEvidence: string[];
  decisionEvidence: string[];
  /** V3.0: 结构化解释节点（有序，每节点含来源标注） */
  explanationNodes?: ExplanationNode[];
  /** V3.0: 解析出的语气修饰符（传递给 coach prompt） */
  toneModifier?: string;
  /** V3.1: prompt 输出深度驱动（由置信度和复核级别推导） */
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
  /** V2.6: 给前端或教练直接消费的后续动作清单 */
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
  why: string[];
  doNow: string[];
  ifAlreadyAte?: string[];
  alternatives?: string[];
  tone: 'strict' | 'encouraging' | 'neutral';
  /** V2.7: 下一餐前瞻建议 */
  nextMeal?: string;
}

// ==================== 子结构定义 ====================

/** 输入快照 */
export interface AnalysisInputSnapshot {
  /** 文本分析时的原始文本 */
  rawText?: string;
  /** 图片分析时的图片 URL */
  imageUrl?: string;
  /** 餐次 */
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
}

/**
 * 单个被分析的食物项
 */
export interface AnalyzedFoodItem {
  /** 食物名称（用户可见） */
  name: string;
  /** 标准化名称（别名归一后） */
  normalizedName?: string;
  /** 命中的标准食物库 ID */
  foodLibraryId?: string;
  /** 命中的候选食物 ID（V6.1 Phase 2） */
  candidateId?: string;
  /** 数量描述（如"一份"、"200g"） */
  quantity?: string;
  /** 估算重量（克） */
  estimatedWeightGrams?: number;
  /** 食物分类 */
  category?: string;
  /** 识别/匹配置信度（0-1） */
  confidence: number;
  /** 热量（千卡） */
  calories: number;
  /** 蛋白质（克） */
  protein?: number;
  /** 脂肪（克） */
  fat?: number;
  /** 碳水化合物（克） */
  carbs?: number;
  /** 膳食纤维（克，深度营养拆解字段） */
  fiber?: number;
  /** 钠（毫克，深度营养拆解字段） */
  sodium?: number;
  /** V6.3 P1-11: 饱和脂肪（克） */
  saturatedFat?: number | null;
  /** V6.3 P1-11: 添加糖（克） */
  addedSugar?: number | null;
  /** V6.3 P1-11: 维生素A（μg RAE） */
  vitaminA?: number | null;
  /** V6.3 P1-11: 维生素C（mg） */
  vitaminC?: number | null;
  /** V6.3 P1-11: 钙（mg） */
  calcium?: number | null;
  /** V6.3 P1-11: 铁（mg） */
  iron?: number | null;
  /** V6.3 P1-11: 是否为 AI 估算值 */
  estimated?: boolean;
}

/** 汇总营养数据 */
export interface NutritionTotals {
  /** 总热量（千卡） */
  calories: number;
  /** 总蛋白质（克） */
  protein: number;
  /** 总脂肪（克） */
  fat: number;
  /** 总碳水化合物（克） */
  carbs: number;
  /** 总膳食纤维（克，深度营养拆解字段） */
  fiber?: number;
  /** 总钠（毫克，深度营养拆解字段） */
  sodium?: number;
  /** V1.2: 总饱和脂肪（克） */
  saturatedFat?: number;
  /** V1.2: 总添加糖（克） */
  addedSugar?: number;
}

/** 综合评分 */
export interface AnalysisScore {
  /** 健康评分（0-100） */
  healthScore: number;
  /** 营养评分（0-100） */
  nutritionScore: number;
  /** 置信度评分（0-100，综合识别和估算的可信度） */
  confidenceScore: number;
  /** V1.3: 7维评分分解（energy/proteinRatio/macroBalance/foodQuality/satiety/stability/glycemicImpact） */
  breakdown?: {
    energy: number;
    proteinRatio: number;
    macroBalance: number;
    foodQuality: number;
    satiety: number;
    stability: number;
    glycemicImpact: number;
  };
}

/**
 * 饮食决策建议
 *
 * 三档建议:
 * - recommend: 当前目标下可优先选择
 * - caution: 能吃，但需要控量/换搭配
 * - avoid: 当前场景不建议
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
  /** P1-3: 具体行动建议（如"减少份量到半份"、"搭配蔬菜沙拉"） */
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
  /** V1.6: 决策推理链（从评分到建议的步骤记录） */
  decisionChain?: DecisionChainStep[];
  /** V1.6: 7维评分解释 */
  breakdownExplanations?: BreakdownExplanation[];
  /** V1.7: 结构化问题识别 */
  issues?: DietIssue[];
}

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
}

/** V1.7: 替代方案定量对比 */
export interface AlternativeComparison {
  /** 热量差（替代 - 原始，负值表示更低） */
  caloriesDiff: number;
  /** 蛋白质差（替代 - 原始，正值表示更高） */
  proteinDiff: number;
  /** 评分差（替代 - 原始） */
  scoreDiff?: number;
}

/** V1.7: 饮食问题识别 */
export interface DietIssue {
  /** 问题分类 */
  category:
    | 'calorie_excess'
    | 'protein_deficit'
    | 'fat_excess'
    | 'carb_excess'
    | 'late_night'
    | 'allergen'
    | 'restriction'
    | 'health_risk'
    | 'low_quality'
    | 'meal_balance'
    | 'binge_risk'
    | 'cumulative_excess'
    | 'multi_day_excess'
    | 'pre_meal_risk'
    | 'post_meal_consequence';
  /** 严重程度 */
  severity: 'info' | 'warning' | 'critical';
  /** 人类可读描述 */
  message: string;
  /** V1.9: 可执行的改善建议 */
  actionable?: string;
  /** 附加数据 */
  data?: Record<string, number | string>;
}

/** V1.7: 宏量营养素进度 */
export interface MacroProgressItem {
  consumed: number;
  target: number;
  percent: number;
}

export interface MacroProgress {
  calories: MacroProgressItem;
  protein: MacroProgressItem;
  fat: MacroProgressItem;
  carbs: MacroProgressItem;
}

/** 替代食物建议 */
export interface FoodAlternative {
  /** 替代食物名称 */
  name: string;
  /** 推荐替代的原因 */
  reason: string;
  /** V1.1: 标准食物库 ID（来自推荐引擎时） */
  foodLibraryId?: string;
  /** V1.1: 推荐引擎打分 0-1 */
  score?: number;
  /** V1.7: 定量对比（替代 vs 原始食物） */
  comparison?: AlternativeComparison;
  /** V2.1: 来源标记（推荐引擎 or 静态规则） */
  source?: 'engine' | 'static';
  /** V2.5: 推荐场景标记 */
  scenarioType?: 'takeout' | 'convenience' | 'homeCook' | 'standard';
  /** V3.0: 替代方案质量评分（0-1，越高越优先推荐） */
  rankScore?: number;
  /** V3.0: 质量评分理由（可读文案，如'+18%蛋白质 -25%脂肪'） */
  rankReasons?: string[];
}

/**
 * 分析解释说明
 *
 * 免费版只返回 summary，订阅版返回完整字段
 */
export interface AnalysisExplanation {
  /** 一句话总结（所有等级可见） */
  summary: string;
  /** 主要原因（Pro 及以上可见） */
  primaryReason?: string;
  /** 用户上下文影响因子列表（Pro 及以上可见） */
  userContextImpact?: string[];
  /** 升级引导文案（仅免费版可见） */
  upgradeTeaser?: string;
}

/**
 * 入库决策信息
 *
 * 告知后续的 AnalysisIngestionService 如何处理分析结果
 */
export interface IngestionDecision {
  /** 是否命中已有标准食物 */
  matchedExistingFoods: boolean;
  /** 是否建议创建候选食物 */
  shouldPersistCandidate: boolean;
  /** 是否需要人工审核 */
  reviewRequired: boolean;
}

/**
 * 权益裁剪信息
 *
 * 告知前端当前结果因订阅等级被隐藏了哪些内容
 */
export interface EntitlementInfo {
  /** 用户当前订阅等级 */
  tier: SubscriptionTier;
  /** 被隐藏的字段路径列表（如 ['alternatives', 'explanation.userContextImpact']） */
  fieldsHidden: string[];
}

/** V2.2: 决策结构化摘要 */
export interface DecisionSummary {
  /** 一句话摘要（如"这顿红烧肉饭热量偏高(850kcal)，建议减量到60%"） */
  headline: string;
  /** 决策判定 */
  verdict: 'recommend' | 'caution' | 'avoid';
  /** 最严重的问题（最多 3 个，按严重度排序） */
  topIssues: string[];
  /** 正面因素（最多 2 个） */
  topStrengths: string[];
  /** 可执行建议（最多 3 个） */
  actionItems: string[];
  /** 量化亮点（如"蛋白质 12g/目标120g(10%), 严重不足"） */
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
  /** V2.8: 动态决策提示（同食物不同时段/状态结论可不同） */
  dynamicDecisionHint?: string;
  /** V2.8: 健康约束提示 */
  healthConstraintNote?: string;
  /** V2.9: 决策护栏（执行顺序建议） */
  decisionGuardrails?: string[];
  /** V2.9: 复核级别 */
  reviewLevel?: 'auto_review' | 'manual_review';
  /** V3.0: 有序信号追踪（按优先级排序，驱动决策的信号列表） */
  signalTrace?: SignalTraceItem[];
}

// ==================== 裁剪相关常量 ====================

/**
 * 免费版需要隐藏的字段路径
 *
 * ResultEntitlementService 使用此列表裁剪 FoodAnalysisResultV61
 */
export const FREE_TIER_HIDDEN_FIELDS: string[] = [
  'alternatives',
  'explanation.primaryReason',
  'explanation.userContextImpact',
  'foods.*.fiber',
  'foods.*.sodium',
  'totals.fiber',
  'totals.sodium',
  'ingestion',
];

/**
 * Pro 版隐藏的字段路径（相对少）
 */
export const PRO_TIER_HIDDEN_FIELDS: string[] = ['ingestion'];

/**
 * Premium 版不隐藏任何字段
 */
export const PREMIUM_TIER_HIDDEN_FIELDS: string[] = [];

// ==================== V3.2 新增类型 ====================

/**
 * V3.2 Phase 1: 分析准确度级别
 */
export type AccuracyLevel = 'high' | 'medium' | 'low';

/**
 * V3.2 Phase 1: 食物分析包（单次分析结果的高级摘要）
 */
export interface FoodAnalysisPackage {
  // 基础营养数据
  totalCalories: number;
  macros: {
    protein: number;
    fat: number;
    carbs: number;
  };

  // V3.2: 分析准确度层级
  /** 准确度级别（high/medium/low） */
  accuracyLevel: AccuracyLevel;
  /** 准确度评分（0-100） */
  accuracyScore: number;
  /** 准确度影响因素 */
  accuracyFactors: {
    confidence: number; // 识别置信度
    reviewLevel: 'auto_review' | 'manual_review'; // 复核级别
    completenessScore: number; // 完整度（0-1）
  };

  // 营养评分 7 维度
  nutritionBreakdown: NutritionScoreBreakdown;
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
  | 'sugar_excess';

/**
 * V3.2 Phase 1: 结构化营养问题
 */
export interface NutritionIssue {
  /** 问题类型 */
  type: IssueType;
  /** 严重程度 */
  severity: 'low' | 'medium' | 'high';
  /** 偏差值（g 或 % 或 kcal） */
  metric: number;
  /** 阈值 */
  threshold: number;
  /** 中文说明 */
  implication: string;
}

/**
 * V3.2 Phase 1: 推荐系统上下文条件
 */
export interface RecommendationContext {
  /** 剩余热量 */
  remainingCalories: number;
  /** 目标宏量（剩余部分） */
  targetMacros: {
    protein: number;
    fat: number;
    carbs: number;
  };
  /** 已吃过的食物（用于去重） */
  excludeFoods: string[];
  /** 用户偏好场景（takeout/便利店/homeCook 等） */
  preferredScenarios: string[];
}

/**
 * V3.2 Phase 1: 上下文分析（结合当日摄入、用户画像、推荐条件）
 */
export interface ContextualAnalysis {
  // 宏量位置状态
  macroSlotStatus: MacroSlotStatus;
  // 当前进度
  macroProgress: {
    consumed: NutritionTotals;
    remaining: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
    };
  };

  // V3.2: 结构化问题识别
  /** 按严重程度排序的问题列表 */
  identifiedIssues: NutritionIssue[];

  // V3.2: 替代建议条件（供推荐系统使用）
  recommendationContext: RecommendationContext;
}

/**
 * V3.2 Phase 1: 分析准确度刷新包（从 ConfidenceDiagnostics 推导）
 * 用于给决策系统参考
 */
export interface AnalysisAccuracyMetrics {
  level: AccuracyLevel;
  score: number;
  factors: {
    confidence: number;
    reviewLevel: 'auto_review' | 'manual_review';
    completenessScore: number;
  };
}
