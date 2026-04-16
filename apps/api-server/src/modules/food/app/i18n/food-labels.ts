/**
 * V2.1 Phase 3.1 — 统一 i18n 标签入口
 *
 * 1. COACH_LABELS + cl()：从 coach-prompt-builder.service.ts 提取，
 *    供教练 prompt 构建使用。
 * 2. DIMENSION_* 重导出：从 scoring-dimensions.ts 统一对外暴露，
 *    不移动原始数据（最小改动）。
 */

import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';

// ==================== Coach 上下文标签国际化 ====================

export const COACH_LABELS: Record<string, Record<string, string>> = {
  'zh-CN': {
    analyzedFood: '刚分析的食物',
    food: '食物',
    totalCalories: '总热量',
    macros: '宏量',
    aiDecision: 'AI判定',
    riskLevel: '风险等级',
    nutritionScore: '营养评分',
    aiAdvice: 'AI建议',
    mealType: '餐次',
    unknown: '未知',
    none: '无',
    points: '分',
    breakdown7d: '7维评分分解',
    decisionFactors: '决策因子',
    suggestedPortion: '建议份量',
    portionTemplate: '当前的{{percent}}%（约{{cal}}kcal）',
    nextMealAdvice: '下一餐建议',
    nextMealTemplate: '{{emphasis}}，目标{{cal}}kcal/蛋白{{protein}}g',
    protein: '蛋白质',
    fat: '脂肪',
    carbs: '碳水',
    scoreBreakdown: '评分维度分析',
    decisionChain: '决策推理链',
    issuesTitle: '识别问题',
    macroProgressTitle: '今日宏量进度',
    consumed: '已摄入',
    target: '目标',
    contextHint: '请结合以上分析结果给出针对性建议。',
    impactPositive: '正面',
    impactWarning: '警告',
    impactCritical: '严重',
    severityInfo: '提示',
    severityWarning: '警告',
    severityCritical: '严重',
  },
  'en-US': {
    analyzedFood: 'Analyzed Food',
    food: 'Food',
    totalCalories: 'Total Calories',
    macros: 'Macros',
    aiDecision: 'AI Decision',
    riskLevel: 'Risk Level',
    nutritionScore: 'Nutrition Score',
    aiAdvice: 'AI Advice',
    mealType: 'Meal Type',
    unknown: 'Unknown',
    none: 'None',
    points: 'pts',
    breakdown7d: '7-Dimension Score Breakdown',
    decisionFactors: 'Decision Factors',
    suggestedPortion: 'Suggested Portion',
    portionTemplate: '{{percent}}% of current (≈{{cal}}kcal)',
    nextMealAdvice: 'Next Meal Advice',
    nextMealTemplate: '{{emphasis}}, target {{cal}}kcal / protein {{protein}}g',
    protein: 'Protein',
    fat: 'Fat',
    carbs: 'Carbs',
    scoreBreakdown: 'Score Breakdown Analysis',
    decisionChain: 'Decision Reasoning Chain',
    issuesTitle: 'Identified Issues',
    macroProgressTitle: "Today's Macro Progress",
    consumed: 'Consumed',
    target: 'Target',
    contextHint: 'Please provide targeted advice based on the above analysis.',
    impactPositive: 'positive',
    impactWarning: 'warning',
    impactCritical: 'critical',
    severityInfo: 'info',
    severityWarning: 'warning',
    severityCritical: 'critical',
  },
  'ja-JP': {
    analyzedFood: '分析した食品',
    food: '食品',
    totalCalories: '総カロリー',
    macros: 'マクロ栄養素',
    aiDecision: 'AI判定',
    riskLevel: 'リスクレベル',
    nutritionScore: '栄養スコア',
    aiAdvice: 'AIアドバイス',
    mealType: '食事タイプ',
    unknown: '不明',
    none: 'なし',
    points: '点',
    breakdown7d: '7次元スコア内訳',
    decisionFactors: '判定要因',
    suggestedPortion: '推奨量',
    portionTemplate: '現在の{{percent}}%（約{{cal}}kcal）',
    nextMealAdvice: '次の食事アドバイス',
    nextMealTemplate: '{{emphasis}}、目標{{cal}}kcal/タンパク質{{protein}}g',
    protein: 'タンパク質',
    fat: '脂質',
    carbs: '炭水化物',
    scoreBreakdown: 'スコア内訳分析',
    decisionChain: '判定推論チェーン',
    issuesTitle: '特定された問題',
    macroProgressTitle: '本日のマクロ進捗',
    consumed: '摂取済み',
    target: '目標',
    contextHint: '上記の分析結果に基づいて、的確なアドバイスをお願いします。',
    impactPositive: '良好',
    impactWarning: '注意',
    impactCritical: '危険',
    severityInfo: '情報',
    severityWarning: '注意',
    severityCritical: '危険',
  },
};

/**
 * Coach 标签查询辅助函数。
 * 按 locale 查找 key，fallback 到 zh-CN，再 fallback 到 key 本身。
 */
export function cl(key: string, locale?: Locale): string {
  const loc = locale || 'zh-CN';
  return COACH_LABELS[loc]?.[key] || COACH_LABELS['zh-CN']?.[key] || key;
}

// ==================== 评分维度标签重导出 ====================

export {
  SCORING_DIMENSIONS,
  type ScoringDimension,
  DIMENSION_LABELS,
  DIMENSION_EXPLANATIONS,
  DIMENSION_SUGGESTIONS,
  getDimensionLabel,
  getDimensionExplanation,
  getDimensionSuggestion,
  scoreToImpact,
} from '../config/scoring-dimensions';
