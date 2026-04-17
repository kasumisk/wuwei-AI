/**
 * V2.4 Decision Module Types
 *
 * 决策系统的核心类型扩展：
 * - ShouldEatRequest: 决策输入请求
 * - ShouldEatDecision: 完整决策体（含理由、替代、补偿）
 * - DecisionReason: 单个决策理由
 * - Alternative: 替代方案
 */

export interface ShouldEatRequest {
  foodId: string;
  foodName: string;
  qty: number; // 计划摄入量(克)
  userId: string;
  currentScore?: any; // NutritionScore
  analysisConfidence?: number;
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  userProfile?: any;
}

export interface ShouldEatDecision {
  action: 'must_eat' | 'should_eat' | 'can_skip' | 'should_avoid';
  confidence: number; // 决策置信度 (0-1)

  // 决策理由（多个维度）
  reasons: DecisionReason[];

  // 替代方案
  alternatives?: Alternative[];

  // 补偿建议
  compensationSuggestions?: string[];

  // 元数据
  scoredAt: Date;
}

export interface DecisionReason {
  dimension: 'nutrition' | 'health' | 'allergy' | 'preference';
  reason_i18n: string; // i18n key
  weight: number; // 权重 (0-1)
  explanation?: string; // 可选的详细解释
}

export interface Alternative {
  foodId: string;
  foodName: string;
  qty: number;
  reason_i18n: string; // i18n key: 为什么推荐这个
  scenarioType?: 'takeout' | 'convenience' | 'homeCook' | 'standard';
  score?: number; // 匹配度 (0-100)
}
