/**
 * V1.9 Phase 1.1 — 共享评分维度常量
 *
 * 统一 DIMENSION_LABELS + DIMENSION_EXPLANATIONS，消除三处重复。
 * 所有评分/决策/解释服务统一引用此文件。
 */

// ==================== 维度键名 ====================

export const SCORING_DIMENSIONS = [
  'energy',
  'proteinRatio',
  'macroBalance',
  'foodQuality',
  'satiety',
  'stability',
  'glycemicImpact',
] as const;

export type ScoringDimension = (typeof SCORING_DIMENSIONS)[number];

// ==================== 维度标签（三语言） ====================

export const DIMENSION_LABELS: Record<
  string,
  Record<ScoringDimension, string>
> = {
  'zh-CN': {
    energy: '热量控制',
    proteinRatio: '蛋白质比例',
    macroBalance: '宏量均衡',
    foodQuality: '食物质量',
    satiety: '饱腹感',
    stability: '饮食稳定性',
    glycemicImpact: '血糖影响',
  },
  'en-US': {
    energy: 'Calorie Control',
    proteinRatio: 'Protein Ratio',
    macroBalance: 'Macro Balance',
    foodQuality: 'Food Quality',
    satiety: 'Satiety',
    stability: 'Diet Stability',
    glycemicImpact: 'Glycemic Impact',
  },
  'ja-JP': {
    energy: 'カロリー管理',
    proteinRatio: 'タンパク質比率',
    macroBalance: 'マクロバランス',
    foodQuality: '食品品質',
    satiety: '満腹感',
    stability: '食事安定性',
    glycemicImpact: '血糖影響',
  },
};

// ==================== 维度解释模板（三语言） ====================

export const DIMENSION_EXPLANATIONS: Record<
  string,
  Record<ScoringDimension, Record<'positive' | 'warning' | 'critical', string>>
> = {
  'zh-CN': {
    energy: {
      positive: '热量摄入合理，在目标范围内',
      warning: '热量略有偏差，建议适当调整',
      critical: '热量严重超标或不足，需要注意',
    },
    proteinRatio: {
      positive: '蛋白质比例充足，有助于目标达成',
      warning: '蛋白质比例偏低，建议增加优质蛋白',
      critical: '蛋白质严重不足，影响身体恢复和代谢',
    },
    macroBalance: {
      positive: '三大营养素比例均衡',
      warning: '营养素比例有偏差，建议调整搭配',
      critical: '营养素比例严重失衡',
    },
    foodQuality: {
      positive: '食物品质优良，以天然食材为主',
      warning: '食物加工程度较高，建议选择更天然的食材',
      critical: '食物品质较差，建议减少超加工食品',
    },
    satiety: {
      positive: '饱腹感充足，有助于控制食欲',
      warning: '饱腹感一般，可能较快感到饥饿',
      critical: '饱腹感不足，容易导致加餐',
    },
    stability: {
      positive: '饮食习惯稳定，保持得很好',
      warning: '饮食记录不够规律，建议坚持打卡',
      critical: '饮食习惯波动较大，需要建立规律',
    },
    glycemicImpact: {
      positive: '血糖影响较小，有利于稳定能量',
      warning: '血糖波动中等，建议搭配纤维和蛋白质',
      critical: '血糖影响较大，建议避免高GI食物',
    },
  },
  'en-US': {
    energy: {
      positive: 'Calorie intake is within target range',
      warning: 'Calorie intake slightly off target, consider adjusting',
      critical: 'Calorie intake significantly over or under target',
    },
    proteinRatio: {
      positive: 'Protein ratio is adequate for your goals',
      warning: 'Protein ratio is low, consider adding lean protein',
      critical: 'Protein is severely insufficient, affecting recovery',
    },
    macroBalance: {
      positive: 'Macronutrient balance is well distributed',
      warning: 'Macro ratio is slightly off, consider adjusting',
      critical: 'Macronutrient ratio is severely imbalanced',
    },
    foodQuality: {
      positive: 'Food quality is excellent, mostly whole foods',
      warning: 'Food is moderately processed, opt for whole foods',
      critical: 'Food quality is poor, reduce ultra-processed foods',
    },
    satiety: {
      positive: 'Good satiety, helps control appetite',
      warning: 'Moderate satiety, you may feel hungry soon',
      critical: 'Low satiety, likely to cause snacking',
    },
    stability: {
      positive: 'Diet habits are stable and consistent',
      warning: 'Diet tracking is irregular, try to log consistently',
      critical: 'Diet habits are unstable, establish a routine',
    },
    glycemicImpact: {
      positive: 'Low glycemic impact, stable energy levels',
      warning: 'Moderate glycemic impact, pair with fiber and protein',
      critical: 'High glycemic impact, avoid high-GI foods',
    },
  },
  'ja-JP': {
    energy: {
      positive: 'カロリー摂取は目標範囲内です',
      warning: 'カロリーがやや目標から外れています',
      critical: 'カロリーが大幅に目標を超過または不足しています',
    },
    proteinRatio: {
      positive: 'タンパク質比率は目標に適しています',
      warning: 'タンパク質比率が低め、良質なタンパク質を追加しましょう',
      critical: 'タンパク質が著しく不足、回復に影響します',
    },
    macroBalance: {
      positive: '三大栄養素のバランスが良好です',
      warning: '栄養素バランスがやや偏っています',
      critical: '栄養素バランスが著しく偏っています',
    },
    foodQuality: {
      positive: '食品品質が優秀、自然食材中心です',
      warning: '加工度がやや高め、自然食材を選びましょう',
      critical: '食品品質が低い、超加工食品を減らしましょう',
    },
    satiety: {
      positive: '満腹感が十分、食欲コントロールに有効です',
      warning: '満腹感が普通、すぐにお腹が空くかもしれません',
      critical: '満腹感が不足、間食しやすくなります',
    },
    stability: {
      positive: '食習慣が安定しています',
      warning: '食事記録が不規則、継続的な記録を心がけましょう',
      critical: '食習慣が不安定、規則正しい習慣を作りましょう',
    },
    glycemicImpact: {
      positive: '血糖への影響が少なく、安定したエネルギーレベルです',
      warning: '血糖への影響が中程度、食物繊維とタンパク質を組み合わせましょう',
      critical: '血糖への影響が大きい、高GI食品を避けましょう',
    },
  },
};

// ==================== V1.9: 维度改善建议模板（三语言） ====================

export const DIMENSION_SUGGESTIONS: Record<
  string,
  Record<ScoringDimension, Record<'warning' | 'critical', string>>
> = {
  'zh-CN': {
    energy: {
      warning: '适当调整份量，控制在目标热量范围内',
      critical: '大幅减少份量或选择低热量替代食物',
    },
    proteinRatio: {
      warning: '搭配鸡蛋、鸡胸肉等高蛋白食物',
      critical: '优先补充优质蛋白质，如鱼、豆腐、瘦肉',
    },
    macroBalance: {
      warning: '调整碳水和脂肪的比例，增加蔬菜摄入',
      critical: '重新规划这一餐的搭配，确保三大营养素均衡',
    },
    foodQuality: {
      warning: '尝试用天然食材替代加工食品',
      critical: '优先选择新鲜蔬菜、水果和全谷物',
    },
    satiety: {
      warning: '增加膳食纤维和蛋白质的摄入',
      critical: '选择高纤维、高蛋白的食物组合以增强饱腹感',
    },
    stability: {
      warning: '坚持每天记录饮食，建立规律',
      critical: '设定固定的用餐时间，逐步建立稳定的饮食习惯',
    },
    glycemicImpact: {
      warning: '搭配蔬菜或蛋白质以减缓血糖上升',
      critical: '避免精制碳水，选择全谷物和低GI食物',
    },
  },
  'en-US': {
    energy: {
      warning: 'Adjust portion size to stay within calorie target',
      critical:
        'Significantly reduce portion or choose a lower-calorie alternative',
    },
    proteinRatio: {
      warning: 'Add eggs, chicken breast, or other high-protein foods',
      critical:
        'Prioritize quality protein sources like fish, tofu, or lean meat',
    },
    macroBalance: {
      warning: 'Adjust carb and fat ratios, add more vegetables',
      critical: "Rethink this meal's composition for better macro balance",
    },
    foodQuality: {
      warning: 'Try replacing processed foods with whole ingredients',
      critical: 'Choose fresh vegetables, fruits, and whole grains',
    },
    satiety: {
      warning: 'Increase fiber and protein intake',
      critical:
        'Choose high-fiber, high-protein food combinations for better satiety',
    },
    stability: {
      warning: 'Log your meals daily to build consistency',
      critical: 'Set fixed meal times and gradually build stable eating habits',
    },
    glycemicImpact: {
      warning: 'Pair with vegetables or protein to slow blood sugar rise',
      critical: 'Avoid refined carbs, choose whole grains and low-GI foods',
    },
  },
  'ja-JP': {
    energy: {
      warning: '分量を調整して目標カロリー内に収めましょう',
      critical: '大幅に分量を減らすか、低カロリーの代替品を選びましょう',
    },
    proteinRatio: {
      warning: '卵や鶏胸肉などの高タンパク食品を組み合わせましょう',
      critical: '魚、豆腐、赤身肉などの良質なタンパク質を優先しましょう',
    },
    macroBalance: {
      warning: '炭水化物と脂質の比率を調整し、野菜を増やしましょう',
      critical: 'この食事の構成を見直し、三大栄養素のバランスを確保しましょう',
    },
    foodQuality: {
      warning: '加工食品を天然食材に置き換えてみましょう',
      critical: '新鮮な野菜、果物、全粒穀物を優先しましょう',
    },
    satiety: {
      warning: '食物繊維とタンパク質の摂取を増やしましょう',
      critical: '高繊維・高タンパクの食品の組み合わせで満腹感を高めましょう',
    },
    stability: {
      warning: '毎日食事を記録して習慣を作りましょう',
      critical: '固定の食事時間を設定し、安定した食習慣を築きましょう',
    },
    glycemicImpact: {
      warning: '野菜やタンパク質と組み合わせて血糖上昇を緩やかにしましょう',
      critical: '精製炭水化物を避け、全粒穀物や低GI食品を選びましょう',
    },
  },
};

// ==================== Impact 阈值 ====================

export const IMPACT_THRESHOLDS = {
  positive: 70,
  warning: 40,
  // < 40 = critical
} as const;

/**
 * 分数 → 影响等级
 */
export function scoreToImpact(
  score: number,
): 'positive' | 'warning' | 'critical' {
  if (score >= IMPACT_THRESHOLDS.positive) return 'positive';
  if (score >= IMPACT_THRESHOLDS.warning) return 'warning';
  return 'critical';
}

/**
 * 获取维度标签
 */
export function getDimensionLabel(
  dimension: string,
  locale: string = 'zh-CN',
): string {
  const labels = DIMENSION_LABELS[locale] || DIMENSION_LABELS['zh-CN'];
  return labels[dimension as ScoringDimension] || dimension;
}

/**
 * 获取维度解释
 */
export function getDimensionExplanation(
  dimension: string,
  impact: 'positive' | 'warning' | 'critical',
  locale: string = 'zh-CN',
): string {
  const explanations =
    DIMENSION_EXPLANATIONS[locale] || DIMENSION_EXPLANATIONS['zh-CN'];
  return explanations[dimension as ScoringDimension]?.[impact] || '';
}

/**
 * V1.9: 获取维度改善建议
 */
export function getDimensionSuggestion(
  dimension: string,
  impact: 'warning' | 'critical',
  locale: string = 'zh-CN',
): string | undefined {
  const suggestions =
    DIMENSION_SUGGESTIONS[locale] || DIMENSION_SUGGESTIONS['zh-CN'];
  return suggestions[dimension as ScoringDimension]?.[impact];
}
