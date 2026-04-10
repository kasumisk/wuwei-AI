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
}

/** 综合评分 */
export interface AnalysisScore {
  /** 健康评分（0-100） */
  healthScore: number;
  /** 营养评分（0-100） */
  nutritionScore: number;
  /** 置信度评分（0-100，综合识别和估算的可信度） */
  confidenceScore: number;
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
}

/** 替代食物建议 */
export interface FoodAlternative {
  /** 替代食物名称 */
  name: string;
  /** 推荐替代的原因 */
  reason: string;
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
