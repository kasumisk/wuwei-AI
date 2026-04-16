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

import { SubscriptionTier } from '../../../subscription/subscription.types';

// ==================== V2.0: 统一用户上下文 ====================

/**
 * V2.0: 统一用户上下文接口
 *
 * 合并 user-context-builder.service.ts 和 food-decision.service.ts 中
 * 各自定义的 UserContext，作为全系统唯一的用户上下文类型。
 */
export interface UnifiedUserContext {
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
  profile: any;
  /** 当前本地小时 (0-23) */
  localHour: number;
  /** 用户过敏原列表 */
  allergens: string[];
  /** 用户饮食限制 */
  dietaryRestrictions: string[];
  /** 用户健康状况 */
  healthConditions: string[];
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
    | 'multi_day_excess';
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
  /** 替代方案摘要 */
  alternativeSummary?: string;
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
