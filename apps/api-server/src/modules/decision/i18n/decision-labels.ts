/**
 * V2.1 Phase 3.1 — 统一 i18n 标签入口
 *
 * 1. COACH_LABELS + cl()：从 coach-prompt-builder.service.ts 提取，
 *    供教练 prompt 构建使用。
 * 2. DIMENSION_* 重导出：从 scoring-dimensions.ts 统一对外暴露，
 *    不移动原始数据（最小改动）。
 */

import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

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
    // V2.7 coach context labels
    summaryTitle: '分析摘要',
    verdictLabel: '判定',
    topIssuesLabel: '主要问题',
    strengthsLabel: '优点',
    dataLabel: '数据',
    actionItemsLabel: '建议行动',
    contextSignalLabel: '上下文信号',
    coachFocusLabel: '教练重点',
    alternativeLabel: '替代方案',
    coachPlanTitle: '教练行动计划',
    conclusionLabel: '结论',
    reasonLabel: '原因',
    doNowLabel: '现在怎么做',
    followUpLabel: '后续动作',
    ifAlreadyAteLabel: '如果已经吃了',
    nextMealLabel: '下一餐方向',
    alternativesLabel: '替代选择',
    uncertaintyLabel: '不确定性',
    macroInlineLabel: '宏量进度',
    analysisQualityLabel: '分析质量',
    dynamicHintLabel: '动态决策提示',
    healthConstraintLabel: '健康约束',
    decisionGuardrailsLabel: '决策护栏',
    reviewLevelLabel: '复核级别',
    decisionConfidenceLabel: '决策置信度',
    reviewAuto: '自动复核',
    reviewManual: '人工复核',
    // V3.0
    signalTraceLabel: '决策信号追踪',
    macroSlotLabel: '宏量槽位状态',
    toneModifierLabel: '教练语气',
    alternativeRankLabel: '替代方案评分',
    rankReasonsLabel: '评分理由',
    dominantDeficitLabel: '主要缺口',
    dominantExcessLabel: '主要超标',
    toneEncouraging: '鼓励型',
    // V3.1
    promptDepthLabel: 'Prompt深度',
    dynamicWeightLabel: '动态信号权重',
    structuredOutputLabel: '结构化输出',
    verdictLabel2: '判决结果',
    mainReasonLabel: '主要原因',
    actionStepsLabel: '行动建议',
    cautionNoteLabel: '注意事项',
    macroSummaryLabel: '每日宏量摘要',
    // V3.8 P3.1: coach-prompt section headers
    dailySummaryHeader: '每日摘要',
    explanationChainHeader: '解释链路',
    structuredAdviceHeader: '结构化建议',
    confidenceNoteLabel: '置信度说明',
    // V3.7: 决策引擎因素文案
    'factor.nutritionOk': '营养摄入在目标范围内',
    'factor.nutritionOver': '超出热量预算 {amount}kcal',
    'factor.noBreakdown': '暂无详细评分数据',
    'factor.macroBalanced': '宏量配比较为均衡',
    'factor.macroImbalanced': '宏量配比有偏差，建议调整',
    'factor.macroSeverelyImbalanced': '宏量严重失衡',
    'factor.noHealthIssue': '未检测到健康风险',
    'factor.goodTiming': '进食时间合理',
    'factor.lateNight': '深夜大量进食不利于代谢',
    'factor.lateNightLight': '深夜进食，建议少量',
    'factor.eveningHighCarb': '晚间高碳水不利于减脂',
    // V3.7: 决策引擎多维原因模板
    'rationale.contextual': '今日热量进度: 目标的{percent}%',
    'rationale.goalAlignment': '基于「{goalLabel}」目标的判断',
    'rationale.timelinessLateNight': '深夜进食可能影响睡眠和代谢',
    // V3.7: 量化后缀模板
    'suffix.excessCal': '（超出 {amount}kcal）',
    'suffix.currentProtein': '（当前 {amount}g）',
    // V3.7: 决策因素标签（来自 decision-coach FACTOR_LABELS）
    'factorLabel.nutritionAlignment': '营养目标匹配度',
    'factorLabel.macroBalance': '宏量均衡性',
    'factorLabel.healthConstraint': '健康约束',
    'factorLabel.timeliness': '时机合理性',
    // V3.7: 替代方案比较文案
    'alt.calLess': '热量少 {amount}kcal',
    'alt.calMore': '热量多 {amount}kcal',
    'alt.proteinMore': '蛋白质+{amount}g',
    'alt.proteinLess': '蛋白质-{amount}g',
    'alt.balanced': '综合均衡',
    'alt.lowGlycemicFallback': '低升糖选择（碳水 {carbs}g）',
    'alt.lateNightMilk': '温牛奶',
    'alt.lateNightFruit': '小份水果',
    // V3.8: 决策摘要文案
    'summary.join': '和',
    'summary.foodCount': '{first}等{count}种食物',
    'summary.recommend.nearLimit':
      '{food}({cal})可以吃，但已经接近今日预算，注意控制份量',
    'summary.recommend.ok': '{food}({cal})营养搭配不错，可以放心吃',
    'summary.avoid.overLimit': '{food}({cal})当前已超出今日预算，不建议继续吃',
    'summary.avoid.generic': '{food}({cal})当前不建议食用',
    'summary.caution.portion': '{food}({cal})建议减量到{percent}%',
    'summary.caution.overBudget':
      '{food}({cal})超出剩余预算{amount}kcal，建议调整',
    'summary.caution.reason': '{food}({cal})需要注意：{reason}',
    'summary.postEatAction':
      '已进食完毕，关注下一餐的热量和宏量平衡，适量运动辅助消耗。',
    'summary.strength': '{label}: {score}分 — {message}',
    'summary.macro.calories': '热量',
    'summary.macro.protein': '蛋白质',
    'summary.macro.fat': '脂肪',
    'summary.macro.carbs': '碳水',
    'summary.status.over': '超标',
    'summary.status.severeDeficit': '严重不足',
    'summary.status.low': '偏低',
    'summary.status.ok': '正常',
    'summary.quantitative':
      '{name} {consumed}{unit}/目标{target}{unit}({percent}%), {status}',
    'summary.quantitativeFallback':
      '今日总热量 {consumed}kcal/目标{target}kcal({percent}%)',
    'summary.altSummary.single': '建议替换为：{desc}',
    'summary.altSummary.multi': '建议替换为：{desc}（还有{count}个备选）',
    'summary.altCalLess': '少{amount}kcal',
    'summary.altProteinMore': '多{amount}g蛋白',
    'summary.focus.overLimit.fatLoss': '优先强调热量边界和份量控制',
    'summary.focus.overLimit.other': '今日已达热量目标上限，注意整体平衡',
    'summary.focus.proteinGap': '优先强调蛋白质补充和更优搭配',
    'summary.focus.healthConstraint':
      '优先满足健康约束与过敏/忌口，再做营养优化',
    'summary.focus.fatExcess': '控制脂肪摄入，优先选择低脂替代方案',
    'summary.focus.carbExcess': '降低碳水比例，优先补充蛋白质和蔬菜',
    'summary.focus.lateNight': '当前处于晚间餐次窗口，建议控制总量',
    'summary.focus.mealCountLow': '今日餐次不足，建议补充营养密度高的食物',
    'summary.focus.underTarget': '当前摄入低于目标，可适当增加摄入',
    'summary.focus.avoid': '优先解释为什么现在不适合继续吃',
    'summary.focus.topIssue': '优先围绕"{issue}"给出具体行动建议',
    'summary.focus.default': '优先给出简单、可执行、可坚持的下一步建议',
    'summary.focus.healthRisk': '健康风险优先：{detail}，请严格控制相关摄入',
    'summary.hint.overLimit':
      '同样食物在当前状态更容易超预算，建议优先控制份量或替代。',
    'summary.hint.nearLimit':
      '同样食物在接近预算上限时需要更谨慎，建议减量或调整搭配。',
    'summary.hint.lateNight': '同样食物在夜间窗口更应关注总量与消化负担。',
    'summary.hint.default': '同样食物在不同时段与摄入状态下，结论可能不同。',
    'summary.healthNote.issues': '健康约束提示：{details}',
    'summary.healthNote.generic':
      '存在健康约束（{constraints}），建议优先满足约束再优化营养。',
    'summary.dimension.nutritionAlignment': '营养匹配',
    'summary.dimension.macroBalance': '宏量均衡',
    'summary.dimension.healthConstraint': '健康约束',
    'summary.dimension.timeliness': '时机合理性',
    'summary.signal.healthConstraint': '健康约束（{details}）',
    'summary.signal.overLimit': '今日热量超标（已摄入 {consumed}/{goal}kcal）',
    'summary.signal.nearLimit': '今日热量接近上限（剩余 {remaining}kcal）',
    'summary.signal.underTarget': '今日摄入低于目标（剩余 {remaining}kcal）',
    'summary.signal.proteinGap': '蛋白质缺口较大（剩余 {remaining}g/{goal}g）',
    'summary.signal.fatExcess': '脂肪超标（超出 {amount}g）',
    'summary.signal.carbExcess': '碳水超标（超出 {amount}g）',
    'summary.signal.lateNight': '当前处于晚间餐次窗口（{hour}点）',
    'summary.signal.mealCountLow': '今日餐次偏少（已记录 {count} 餐）',
    'summary.signal.freshDay': '今日摄入较少，营养余量充足',
    // V3.8: 营养问题 implication
    'issue.proteinDeficit': '蛋白质还差 {amount}g，建议下餐补足',
    'issue.fatExcess': '脂肪超标 {amount}g，建议减少油炸食物',
    'issue.carbExcess': '碳水超标 {amount}g，建议减少主食',
    'issue.calorieExcess': '热量超标 {amount} kcal，建议今日剩余餐控制',
    'issue.calorieDeficit': '热量不足 {amount} kcal，建议适度增加摄入',
    'issue.fiberDeficit': '建议增加高纤维食物（蔬菜、全谷物）',
    'issue.sugarExcess': '碳水/糖分超标 {amount}g，注意控制甜食与精制主食',
    'issue.glycemicRisk':
      '糖尿病用户碳水超标 {amount}g，存在血糖风险，建议选择低GI食物',
    'issue.sodiumRisk': '高血压用户需注意钠摄入，避免高盐、高油加工食物',
    'issue.cardiovascularRisk':
      '心血管疾病用户脂肪超标 {amount}g，建议减少饱和脂肪摄入',
    'issue.purineRisk':
      '痛风用户蛋白质偏高，注意避免动物内脏、海鲜等高嘌呤食物',
    'issue.kidneyStress':
      '肾病用户蛋白质超标 {amount}g，增加肾脏负担，建议严格控制蛋白质总量',
    // V3.8 P2.1: 用户上下文 prompt 文案
    'ctx.goal.fat_loss': '减脂',
    'ctx.goal.muscle_gain': '增肌',
    'ctx.goal.health': '均衡健康',
    'ctx.goal.habit': '改善饮食习惯',
    'ctx.focus.fat_loss': '优先关注：热量不超标 + 蛋白质充足',
    'ctx.focus.muscle_gain': '优先关注：蛋白质是否充足 + 热量不能太低',
    'ctx.focus.health': '优先关注：食物质量和营养均衡',
    'ctx.focus.habit': '优先关注：食物质量和饱腹感，鼓励坚持记录',
    'ctx.meal.breakfast': '早餐',
    'ctx.meal.lunch': '午餐',
    'ctx.meal.afternoon': '下午茶',
    'ctx.meal.dinner': '晚餐',
    'ctx.prompt.goalHeader': '【用户饮食目标】',
    'ctx.prompt.budgetHeader': '【今日营养预算剩余】',
    'ctx.prompt.calories':
      '热量：剩余 {remaining} kcal（总目标 {goal}，已摄入 {consumed}）',
    'ctx.prompt.protein':
      '蛋白质：剩余 {remaining}g（总目标 {goal}g，已摄入 {consumed}g）',
    'ctx.prompt.fat':
      '脂肪：剩余 {remaining}g（总目标 {goal}g，已摄入 {consumed}g）',
    'ctx.prompt.carbs':
      '碳水：剩余 {remaining}g（总目标 {goal}g，已摄入 {consumed}g）',
    'ctx.prompt.mealCount': '已记录餐数：{count} 餐',
    'ctx.prompt.mealPeriod': '当前时段：{period}',
    'ctx.prompt.gender': '性别：{value}',
    'ctx.prompt.gender.male': '男',
    'ctx.prompt.gender.female': '女',
    'ctx.prompt.activityLevel': '活动等级：{value}',
    'ctx.prompt.foodPreferences': '饮食偏好：{value}',
    'ctx.prompt.dietaryRestrictions': '忌口：{value}',
    'ctx.prompt.budgetStatus': '预算状态：{value}',
    'ctx.prompt.nutritionPriority': '当前优先修正：{value}',
    'ctx.prompt.contextSignals': '决策信号：{value}',
    'ctx.health.header': '【健康条件特别注意】',
    'ctx.health.diabetes':
      '- 糖尿病用户：必须关注碳水化合物总量和升糖指数。高淀粉/高糖食物要在 reason 中明确标注风险，decision 倾向 LIMIT/AVOID。',
    'ctx.health.hypertension':
      '- 高血压用户：必须关注钠含量。腌制食品、酱料、外卖重口味食物要标注高钠风险，建议低钠替代，decision 倾向 LIMIT。',
    'ctx.health.heart':
      '- 心脏病/心血管风险用户：必须关注饱和脂肪和总脂肪。油炸食品、肥肉、全脂乳制品要明确标注风险，decision 倾向 LIMIT/AVOID。',
    'ctx.health.gout':
      '- 痛风用户：关注高嘌呤食物（海鲜、动物内脏、浓肉汤）。识别到高嘌呤食物时在 reason 中提示，建议低嘌呤替代。',
    'ctx.health.kidney':
      '- 肾病用户：关注蛋白质总量（不宜过高）、钾和磷含量。高蛋白食物不等于好，需在 suggestion 中提示适量。',
    // V3.8 P2.2: Pipeline 质量/fallback 文案
    'pipeline.fallback.reason': '暂时无法完成决策分析，建议适量食用',
    'pipeline.fallback.summary': '分析服务暂时不可用，请稍后重试',
    'pipeline.quality.high': '分析质量较高，可按当前建议执行。',
    'pipeline.quality.medium': '分析质量中等，建议结合饥饿感与份量微调。',
    'pipeline.quality.low':
      '分析质量偏低，建议先保守执行并补充更清晰输入复核。',
    'pipeline.guardrail.lowQuality': '当前分析质量偏低，先按保守策略执行。',
    'pipeline.guardrail.avoid': '当前建议为不建议继续吃，优先执行替代或减量。',
    'pipeline.guardrail.postEat':
      '已进食完毕，重点关注下一餐调整与适度运动消耗。',
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
    // V2.7 coach context labels
    summaryTitle: 'Analysis Summary',
    verdictLabel: 'Verdict',
    topIssuesLabel: 'Key Issues',
    strengthsLabel: 'Strengths',
    dataLabel: 'Data',
    actionItemsLabel: 'Recommended Actions',
    contextSignalLabel: 'Context Signals',
    coachFocusLabel: 'Coach Focus',
    alternativeLabel: 'Alternatives',
    coachPlanTitle: 'Coach Action Plan',
    conclusionLabel: 'Conclusion',
    reasonLabel: 'Reasons',
    doNowLabel: 'Do Now',
    followUpLabel: 'Follow-up',
    ifAlreadyAteLabel: 'If Already Eaten',
    nextMealLabel: 'Next Meal Direction',
    alternativesLabel: 'Alternative Choices',
    uncertaintyLabel: 'Uncertainty',
    macroInlineLabel: 'Macro Progress',
    analysisQualityLabel: 'Analysis Quality',
    dynamicHintLabel: 'Dynamic Decision Hint',
    healthConstraintLabel: 'Health Constraints',
    decisionGuardrailsLabel: 'Decision Guardrails',
    reviewLevelLabel: 'Review Level',
    decisionConfidenceLabel: 'Decision Confidence',
    reviewAuto: 'Auto Review',
    reviewManual: 'Manual Review',
    // V3.0
    signalTraceLabel: 'Decision Signal Trace',
    macroSlotLabel: 'Macro Slot Status',
    toneModifierLabel: 'Coach Tone',
    alternativeRankLabel: 'Alternative Rank',
    rankReasonsLabel: 'Rank Reasons',
    dominantDeficitLabel: 'Dominant Deficit',
    dominantExcessLabel: 'Dominant Excess',
    toneEncouraging: 'Encouraging',
    // V3.1
    promptDepthLabel: 'Prompt Depth',
    dynamicWeightLabel: 'Dynamic Signal Weight',
    structuredOutputLabel: 'Structured Output',
    verdictLabel2: 'Verdict',
    mainReasonLabel: 'Main Reason',
    actionStepsLabel: 'Action Steps',
    cautionNoteLabel: 'Caution Note',
    macroSummaryLabel: 'Daily Macro Summary',
    // V3.8 P3.1: coach-prompt section headers
    dailySummaryHeader: 'Daily Summary',
    explanationChainHeader: 'Explanation Chain',
    structuredAdviceHeader: 'Structured Advice',
    confidenceNoteLabel: 'Confidence Note',
    // V3.7: Decision engine factor texts
    'factor.nutritionOk': 'Nutrition intake is within target range',
    'factor.nutritionOver': 'Over calorie budget by {amount}kcal',
    'factor.noBreakdown': 'No detailed score data available',
    'factor.macroBalanced': 'Macro ratio is well balanced',
    'factor.macroImbalanced': 'Macro ratio is off, consider adjusting',
    'factor.macroSeverelyImbalanced': 'Macro ratio is severely imbalanced',
    'factor.noHealthIssue': 'No health risks detected',
    'factor.goodTiming': 'Good timing for this meal',
    'factor.lateNight': 'Late-night heavy eating harms metabolism',
    'factor.lateNightLight': 'Late-night eating, keep it light',
    'factor.eveningHighCarb': 'Evening high carbs may hinder fat loss',
    // V3.7: Decision engine rationale templates
    'rationale.contextual': "Today's calorie progress: {percent}% of target",
    'rationale.goalAlignment': 'Based on your "{goalLabel}" goal',
    'rationale.timelinessLateNight':
      'Late-night eating may affect sleep and metabolism',
    // V3.7: Quantitative suffix templates
    'suffix.excessCal': ' (over by {amount}kcal)',
    'suffix.currentProtein': ' (current: {amount}g)',
    // V3.7: Decision factor labels
    'factorLabel.nutritionAlignment': 'Nutrition Alignment',
    'factorLabel.macroBalance': 'Macro Balance',
    'factorLabel.healthConstraint': 'Health Constraint',
    'factorLabel.timeliness': 'Timeliness',
    // V3.7: Alternative comparison texts
    'alt.calLess': '{amount}kcal fewer',
    'alt.calMore': '{amount}kcal more',
    'alt.proteinMore': '+{amount}g protein',
    'alt.proteinLess': '-{amount}g protein',
    'alt.balanced': 'Balanced overall',
    'alt.lowGlycemicFallback': 'Low-glycemic option ({carbs}g carbs)',
    'alt.lateNightMilk': 'Warm milk',
    'alt.lateNightFruit': 'Small fruit serving',
    // V3.8: Decision summary texts
    'summary.join': ' and ',
    'summary.foodCount': '{first} and {count} other foods',
    'summary.recommend.nearLimit':
      "{food}({cal}) is okay, but you are near today's budget — watch portion size",
    'summary.recommend.ok': '{food}({cal}) has good nutrition balance, enjoy!',
    'summary.avoid.overLimit':
      "{food}({cal}) exceeds today's budget, not recommended",
    'summary.avoid.generic': '{food}({cal}) is not recommended right now',
    'summary.caution.portion': '{food}({cal}) — suggest reducing to {percent}%',
    'summary.caution.overBudget':
      '{food}({cal}) exceeds remaining budget by {amount}kcal, consider adjusting',
    'summary.caution.reason': '{food}({cal}) — note: {reason}',
    'summary.postEatAction':
      'Meal complete. Focus on calorie and macro balance for the next meal; light exercise can help.',
    'summary.strength': '{label}: {score}pts — {message}',
    'summary.macro.calories': 'Calories',
    'summary.macro.protein': 'Protein',
    'summary.macro.fat': 'Fat',
    'summary.macro.carbs': 'Carbs',
    'summary.status.over': 'over',
    'summary.status.severeDeficit': 'severely low',
    'summary.status.low': 'low',
    'summary.status.ok': 'normal',
    'summary.quantitative':
      '{name} {consumed}{unit}/target {target}{unit}({percent}%), {status}',
    'summary.quantitativeFallback':
      "Today's total calories {consumed}kcal/target {target}kcal({percent}%)",
    'summary.altSummary.single': 'Consider swapping for: {desc}',
    'summary.altSummary.multi':
      'Consider swapping for: {desc} ({count} more options)',
    'summary.altCalLess': '{amount}kcal less',
    'summary.altProteinMore': '+{amount}g protein',
    'summary.focus.overLimit.fatLoss':
      'Emphasize calorie limits and portion control',
    'summary.focus.overLimit.other':
      'Daily calorie target reached — maintain overall balance',
    'summary.focus.proteinGap':
      'Prioritize protein intake and better food pairing',
    'summary.focus.healthConstraint':
      'Prioritize health constraints and allergies before nutrition optimization',
    'summary.focus.fatExcess': 'Reduce fat intake; prefer low-fat alternatives',
    'summary.focus.carbExcess':
      'Reduce carb ratio; prioritize protein and vegetables',
    'summary.focus.lateNight': 'Late-night meal window — keep total intake low',
    'summary.focus.mealCountLow': 'Few meals today — add nutrient-dense foods',
    'summary.focus.underTarget':
      'Intake below target — consider eating a bit more',
    'summary.focus.avoid': 'Explain why eating more right now is not ideal',
    'summary.focus.topIssue': 'Focus on actionable advice for "{issue}"',
    'summary.focus.default':
      'Give simple, actionable, sustainable next-step advice',
    'summary.focus.healthRisk':
      'Health risk priority: {detail} — strictly control related intake',
    'summary.hint.overLimit':
      'The same food is more likely to push you over budget in this state — consider reducing portions or substituting.',
    'summary.hint.nearLimit':
      'Near your budget limit — be cautious with this food, consider reducing or adjusting.',
    'summary.hint.lateNight':
      'Late-night window — pay extra attention to total intake and digestion.',
    'summary.hint.default':
      'The same food may yield different conclusions at different times and intake states.',
    'summary.healthNote.issues': 'Health constraint note: {details}',
    'summary.healthNote.generic':
      'Health constraints ({constraints}) — satisfy constraints before optimizing nutrition.',
    'summary.dimension.nutritionAlignment': 'Nutrition Alignment',
    'summary.dimension.macroBalance': 'Macro Balance',
    'summary.dimension.healthConstraint': 'Health Constraint',
    'summary.dimension.timeliness': 'Timeliness',
    'summary.signal.healthConstraint': 'Health constraint ({details})',
    'summary.signal.overLimit':
      'Calorie limit exceeded ({consumed}/{goal}kcal consumed)',
    'summary.signal.nearLimit':
      'Near calorie limit ({remaining}kcal remaining)',
    'summary.signal.underTarget':
      'Below target intake ({remaining}kcal remaining)',
    'summary.signal.proteinGap':
      'Significant protein gap ({remaining}g/{goal}g remaining)',
    'summary.signal.fatExcess': 'Fat exceeded (over by {amount}g)',
    'summary.signal.carbExcess': 'Carbs exceeded (over by {amount}g)',
    'summary.signal.lateNight': 'Late-night meal window ({hour}:00)',
    'summary.signal.mealCountLow': 'Few meals today ({count} recorded)',
    'summary.signal.freshDay':
      'Low intake today — ample nutrition budget remaining',
    // V3.8: Nutrition issue implications
    'issue.proteinDeficit':
      'Protein gap of {amount}g — try to make up at the next meal',
    'issue.fatExcess': 'Fat over by {amount}g — reduce fried foods',
    'issue.carbExcess': 'Carbs over by {amount}g — reduce staple foods',
    'issue.calorieExcess':
      'Calories over by {amount}kcal — control remaining meals today',
    'issue.calorieDeficit':
      'Calories under by {amount}kcal — consider eating a bit more',
    'issue.fiberDeficit':
      'Add more high-fiber foods (vegetables, whole grains)',
    'issue.sugarExcess':
      'Carbs/sugar over by {amount}g — limit sweets and refined grains',
    'issue.glycemicRisk':
      'Diabetic user: carbs over by {amount}g, blood sugar risk — choose low-GI foods',
    'issue.sodiumRisk':
      'Hypertensive user: watch sodium — avoid high-salt, high-oil processed foods',
    'issue.cardiovascularRisk':
      'Cardiovascular user: fat over by {amount}g — reduce saturated fat intake',
    'issue.purineRisk':
      'Gout user: protein is high — avoid organ meats, seafood and other high-purine foods',
    'issue.kidneyStress':
      'Kidney disease user: protein over by {amount}g — strictly control total protein intake',
    // V3.8 P2.1: User context prompt texts
    'ctx.goal.fat_loss': 'Fat Loss',
    'ctx.goal.muscle_gain': 'Muscle Gain',
    'ctx.goal.health': 'Balanced Health',
    'ctx.goal.habit': 'Improve Eating Habits',
    'ctx.focus.fat_loss':
      'Priority: keep calories under budget + sufficient protein',
    'ctx.focus.muscle_gain':
      'Priority: sufficient protein + calories not too low',
    'ctx.focus.health': 'Priority: food quality and nutritional balance',
    'ctx.focus.habit': 'Priority: food quality and satiety, encourage tracking',
    'ctx.meal.breakfast': 'Breakfast',
    'ctx.meal.lunch': 'Lunch',
    'ctx.meal.afternoon': 'Afternoon Snack',
    'ctx.meal.dinner': 'Dinner',
    'ctx.prompt.goalHeader': '[Dietary Goal]',
    'ctx.prompt.budgetHeader': "[Today's Remaining Nutrition Budget]",
    'ctx.prompt.calories':
      'Calories: {remaining} kcal remaining (target {goal}, consumed {consumed})',
    'ctx.prompt.protein':
      'Protein: {remaining}g remaining (target {goal}g, consumed {consumed}g)',
    'ctx.prompt.fat':
      'Fat: {remaining}g remaining (target {goal}g, consumed {consumed}g)',
    'ctx.prompt.carbs':
      'Carbs: {remaining}g remaining (target {goal}g, consumed {consumed}g)',
    'ctx.prompt.mealCount': 'Meals recorded: {count}',
    'ctx.prompt.mealPeriod': 'Current period: {period}',
    'ctx.prompt.gender': 'Gender: {value}',
    'ctx.prompt.gender.male': 'Male',
    'ctx.prompt.gender.female': 'Female',
    'ctx.prompt.activityLevel': 'Activity level: {value}',
    'ctx.prompt.foodPreferences': 'Food preferences: {value}',
    'ctx.prompt.dietaryRestrictions': 'Dietary restrictions: {value}',
    'ctx.prompt.budgetStatus': 'Budget status: {value}',
    'ctx.prompt.nutritionPriority': 'Nutrition priority: {value}',
    'ctx.prompt.contextSignals': 'Decision signals: {value}',
    'ctx.health.header': '[Health Condition — Special Attention]',
    'ctx.health.diabetes':
      '- Diabetic user: must monitor total carbs and glycemic index. Flag high-starch/sugar foods as risky, decision tends toward LIMIT/AVOID.',
    'ctx.health.hypertension':
      '- Hypertensive user: must monitor sodium. Flag pickled foods, sauces, and salty takeout as high-sodium risk, suggest low-sodium alternatives, decision tends toward LIMIT.',
    'ctx.health.heart':
      '- Cardiovascular risk user: must monitor saturated and total fat. Flag fried foods, fatty meats, full-fat dairy as risky, decision tends toward LIMIT/AVOID.',
    'ctx.health.gout':
      '- Gout user: monitor high-purine foods (seafood, organ meats, rich broth). Flag when detected, suggest low-purine alternatives.',
    'ctx.health.kidney':
      '- Kidney disease user: monitor total protein (not too high), potassium and phosphorus. High protein is not always good, suggest moderation.',
    // V3.8 P2.2: Pipeline quality/fallback texts
    'pipeline.fallback.reason':
      'Unable to complete decision analysis, eat in moderation',
    'pipeline.fallback.summary':
      'Analysis service temporarily unavailable, please try again later',
    'pipeline.quality.high':
      'High analysis quality — follow the current recommendation.',
    'pipeline.quality.medium':
      'Medium analysis quality — adjust based on hunger and portion size.',
    'pipeline.quality.low':
      'Low analysis quality — proceed conservatively and provide clearer input for review.',
    'pipeline.guardrail.lowQuality':
      'Analysis quality is low — follow a conservative strategy.',
    'pipeline.guardrail.avoid':
      'Current advice is to avoid eating — prioritize substitution or portion reduction.',
    'pipeline.guardrail.postEat':
      'Meal complete — focus on next meal adjustment and moderate exercise.',
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
    // V2.7 coach context labels
    summaryTitle: '分析サマリー',
    verdictLabel: '判定',
    topIssuesLabel: '主な問題',
    strengthsLabel: '優れた点',
    dataLabel: 'データ',
    actionItemsLabel: '推奨アクション',
    contextSignalLabel: 'コンテキストシグナル',
    coachFocusLabel: 'コーチの重点',
    alternativeLabel: '代替案',
    coachPlanTitle: 'コーチアクションプラン',
    conclusionLabel: '結論',
    reasonLabel: '理由',
    doNowLabel: '今すぐすること',
    followUpLabel: 'フォローアップ',
    ifAlreadyAteLabel: 'すでに食べた場合',
    nextMealLabel: '次の食事の方向',
    alternativesLabel: '代替の選択肢',
    uncertaintyLabel: '不確実性',
    macroInlineLabel: 'マクロ進捗',
    analysisQualityLabel: '分析品質',
    dynamicHintLabel: '動的判定ヒント',
    healthConstraintLabel: '健康制約',
    decisionGuardrailsLabel: '意思決定ガードレール',
    reviewLevelLabel: 'レビュー区分',
    decisionConfidenceLabel: '判定信頼度',
    reviewAuto: '自動レビュー',
    reviewManual: '手動レビュー',
    // V3.0
    signalTraceLabel: '決定シグナル追跡',
    macroSlotLabel: 'マクロスロット状態',
    toneModifierLabel: 'コーチトーン',
    alternativeRankLabel: '代替案ランク',
    rankReasonsLabel: 'ランク理由',
    dominantDeficitLabel: '主要不足',
    dominantExcessLabel: '主要超過', // V3.1
    promptDepthLabel: 'プロンプト深度',
    dynamicWeightLabel: 'ダイナミック信号重み',
    structuredOutputLabel: '構造化出力',
    verdictLabel2: '判定',
    mainReasonLabel: '主な理由',
    actionStepsLabel: 'アクション提案',
    cautionNoteLabel: '注意事項',
    macroSummaryLabel: '本日マクロ摘要',
    // V3.8 P3.1: coach-prompt section headers
    dailySummaryHeader: '日次サマリー',
    explanationChainHeader: '説明チェーン',
    structuredAdviceHeader: '構造化アドバイス',
    confidenceNoteLabel: '信頼度説明',
    toneEncouraging: '励まし型',
    // V3.7: 決定エンジンファクターテキスト
    'factor.nutritionOk': '栄養摂取は目標範囲内です',
    'factor.nutritionOver': 'カロリー予算を{amount}kcal超過',
    'factor.noBreakdown': '詳細なスコアデータがありません',
    'factor.macroBalanced': 'マクロバランスが良好です',
    'factor.macroImbalanced': 'マクロバランスに偏りがあります',
    'factor.macroSeverelyImbalanced': 'マクロバランスが著しく偏っています',
    'factor.noHealthIssue': '健康リスクは検出されませんでした',
    'factor.goodTiming': '食事のタイミングは適切です',
    'factor.lateNight': '深夜の大量摂食は代謝に悪影響です',
    'factor.lateNightLight': '深夜の食事は少量にしましょう',
    'factor.eveningHighCarb': '夕方の高炭水化物は減脂に不向きです',
    // V3.7: 決定エンジン理由テンプレート
    'rationale.contextual': '本日のカロリー進捗: 目標の{percent}%',
    'rationale.goalAlignment': '「{goalLabel}」目標に基づく判断',
    'rationale.timelinessLateNight':
      '深夜の食事は睡眠と代謝に影響する可能性があります',
    // V3.7: 定量サフィックス
    'suffix.excessCal': '（{amount}kcal超過）',
    'suffix.currentProtein': '（現在 {amount}g）',
    // V3.7: 決定因素ラベル
    'factorLabel.nutritionAlignment': '栄養目標適合度',
    'factorLabel.macroBalance': 'マクロバランス',
    'factorLabel.healthConstraint': '健康制約',
    'factorLabel.timeliness': 'タイミング',
    // V3.7: 代替案比較テキスト
    'alt.calLess': 'カロリー{amount}kcal少ない',
    'alt.calMore': 'カロリー{amount}kcal多い',
    'alt.proteinMore': 'タンパク質+{amount}g',
    'alt.proteinLess': 'タンパク質-{amount}g',
    'alt.balanced': '総合的にバランス良好',
    'alt.lowGlycemicFallback': '低GI選択肢（炭水化物{carbs}g）',
    'alt.lateNightMilk': 'ホットミルク',
    'alt.lateNightFruit': '少量のフルーツ',
    // V3.8: 決定サマリーテキスト
    'summary.join': 'と',
    'summary.foodCount': '{first}など{count}種類の食品',
    'summary.recommend.nearLimit':
      '{food}({cal})は食べても大丈夫ですが、本日の予算に近づいています。量に注意してください',
    'summary.recommend.ok':
      '{food}({cal})は栄養バランスが良好です。安心してお召し上がりください',
    'summary.avoid.overLimit':
      '{food}({cal})は本日の予算を超過しています。おすすめしません',
    'summary.avoid.generic': '{food}({cal})は現在おすすめできません',
    'summary.caution.portion':
      '{food}({cal})は{percent}%に減量することをおすすめします',
    'summary.caution.overBudget':
      '{food}({cal})は残り予算を{amount}kcal超過しています。調整をおすすめします',
    'summary.caution.reason': '{food}({cal})にご注意：{reason}',
    'summary.postEatAction':
      '食事完了。次の食事のカロリーとマクロバランスに注目し、軽い運動で消費を補助しましょう。',
    'summary.strength': '{label}: {score}点 — {message}',
    'summary.macro.calories': 'カロリー',
    'summary.macro.protein': 'タンパク質',
    'summary.macro.fat': '脂質',
    'summary.macro.carbs': '炭水化物',
    'summary.status.over': '超過',
    'summary.status.severeDeficit': '著しく不足',
    'summary.status.low': 'やや不足',
    'summary.status.ok': '正常',
    'summary.quantitative':
      '{name} {consumed}{unit}/目標{target}{unit}({percent}%), {status}',
    'summary.quantitativeFallback':
      '本日の総カロリー {consumed}kcal/目標{target}kcal({percent}%)',
    'summary.altSummary.single': '代替案：{desc}',
    'summary.altSummary.multi': '代替案：{desc}（他に{count}件の選択肢）',
    'summary.altCalLess': '{amount}kcal少ない',
    'summary.altProteinMore': 'タンパク質+{amount}g',
    'summary.focus.overLimit.fatLoss':
      'カロリー上限と量のコントロールを最優先に',
    'summary.focus.overLimit.other':
      '本日のカロリー目標に到達しました。全体のバランスに注意',
    'summary.focus.proteinGap': 'タンパク質補充とより良い組み合わせを優先',
    'summary.focus.healthConstraint':
      '栄養最適化の前に、健康制約とアレルギーを優先してください',
    'summary.focus.fatExcess': '脂質摂取を控え、低脂肪の代替品を優先',
    'summary.focus.carbExcess': '炭水化物の比率を下げ、タンパク質と野菜を優先',
    'summary.focus.lateNight': '夜間の食事ウィンドウです。総量を控えめに',
    'summary.focus.mealCountLow':
      '本日の食事回数が少ないです。栄養密度の高い食品を追加',
    'summary.focus.underTarget':
      '摂取量が目標を下回っています。もう少し食べても大丈夫です',
    'summary.focus.avoid': '今食べ続けるのが適切でない理由を優先的に説明',
    'summary.focus.topIssue':
      '「{issue}」に対する具体的なアクションアドバイスを優先',
    'summary.focus.default': 'シンプルで実行可能、続けやすい次のステップを提案',
    'summary.focus.healthRisk':
      '健康リスク優先：{detail}、関連摂取を厳格に管理してください',
    'summary.hint.overLimit':
      '現在の状態では同じ食品でも予算超過しやすくなっています。量の調整や代替をおすすめします。',
    'summary.hint.nearLimit':
      '予算上限に近づいています。この食品は減量か組み合わせの調整をおすすめします。',
    'summary.hint.lateNight':
      '夜間ウィンドウです。総量と消化負担に特に注意してください。',
    'summary.hint.default':
      '同じ食品でも、時間帯や摂取状態によって結論が異なる場合があります。',
    'summary.healthNote.issues': '健康制約に関する注意：{details}',
    'summary.healthNote.generic':
      '健康制約（{constraints}）があります。制約を満たしてから栄養を最適化してください。',
    'summary.dimension.nutritionAlignment': '栄養適合度',
    'summary.dimension.macroBalance': 'マクロバランス',
    'summary.dimension.healthConstraint': '健康制約',
    'summary.dimension.timeliness': 'タイミング',
    'summary.signal.healthConstraint': '健康制約（{details}）',
    'summary.signal.overLimit':
      '本日のカロリー超過（{consumed}/{goal}kcal摂取済み）',
    'summary.signal.nearLimit': 'カロリー上限に接近（残り{remaining}kcal）',
    'summary.signal.underTarget':
      '目標摂取量を下回っています（残り{remaining}kcal）',
    'summary.signal.proteinGap':
      'タンパク質の不足が大きい（残り{remaining}g/{goal}g）',
    'summary.signal.fatExcess': '脂質超過（{amount}g超過）',
    'summary.signal.carbExcess': '炭水化物超過（{amount}g超過）',
    'summary.signal.lateNight': '夜間の食事ウィンドウ（{hour}時）',
    'summary.signal.mealCountLow':
      '本日の食事回数が少ない（{count}食記録済み）',
    'summary.signal.freshDay': '本日の摂取量が少なく、栄養余裕が十分あります',
    // V3.8: 栄養問題インプリケーション
    'issue.proteinDeficit':
      'タンパク質が{amount}g不足しています。次の食事で補いましょう',
    'issue.fatExcess': '脂質が{amount}g超過しています。揚げ物を減らしましょう',
    'issue.carbExcess':
      '炭水化物が{amount}g超過しています。主食を減らしましょう',
    'issue.calorieExcess':
      'カロリーが{amount}kcal超過しています。残りの食事で調整しましょう',
    'issue.calorieDeficit':
      'カロリーが{amount}kcal不足しています。もう少し摂取を増やしましょう',
    'issue.fiberDeficit':
      '食物繊維の多い食品（野菜、全粒穀物）を増やしましょう',
    'issue.sugarExcess':
      '炭水化物/糖分が{amount}g超過しています。甘いものと精製主食を控えましょう',
    'issue.glycemicRisk':
      '糖尿病の方：炭水化物が{amount}g超過、血糖リスクあり。低GI食品を選びましょう',
    'issue.sodiumRisk':
      '高血圧の方：ナトリウム摂取に注意。高塩分・高油の加工食品を避けましょう',
    'issue.cardiovascularRisk':
      '心血管疾患の方：脂質が{amount}g超過しています。飽和脂肪の摂取を減らしましょう',
    'issue.purineRisk':
      '痛風の方：タンパク質が高めです。内臓肉、海鮮などの高プリン食品を避けましょう',
    'issue.kidneyStress':
      '腎臓病の方：タンパク質が{amount}g超過しています。タンパク質の総量を厳格に管理しましょう',
    // V3.8 P2.1: ユーザーコンテキストプロンプトテキスト
    'ctx.goal.fat_loss': '減脂',
    'ctx.goal.muscle_gain': '筋肉増量',
    'ctx.goal.health': 'バランスの取れた健康',
    'ctx.goal.habit': '食習慣の改善',
    'ctx.focus.fat_loss': '優先事項：カロリーを予算内に + タンパク質を十分に',
    'ctx.focus.muscle_gain':
      '優先事項：タンパク質が十分か + カロリーが低すぎないか',
    'ctx.focus.health': '優先事項：食品の質と栄養バランス',
    'ctx.focus.habit': '優先事項：食品の質と満腹感、記録の継続を奨励',
    'ctx.meal.breakfast': '朝食',
    'ctx.meal.lunch': '昼食',
    'ctx.meal.afternoon': 'おやつ',
    'ctx.meal.dinner': '夕食',
    'ctx.prompt.goalHeader': '【食事目標】',
    'ctx.prompt.budgetHeader': '【本日の栄養予算残り】',
    'ctx.prompt.calories':
      'カロリー：残り {remaining} kcal（目標 {goal}、摂取済み {consumed}）',
    'ctx.prompt.protein':
      'タンパク質：残り {remaining}g（目標 {goal}g、摂取済み {consumed}g）',
    'ctx.prompt.fat':
      '脂質：残り {remaining}g（目標 {goal}g、摂取済み {consumed}g）',
    'ctx.prompt.carbs':
      '炭水化物：残り {remaining}g（目標 {goal}g、摂取済み {consumed}g）',
    'ctx.prompt.mealCount': '記録済み食事数：{count} 食',
    'ctx.prompt.mealPeriod': '現在の時間帯：{period}',
    'ctx.prompt.gender': '性別：{value}',
    'ctx.prompt.gender.male': '男性',
    'ctx.prompt.gender.female': '女性',
    'ctx.prompt.activityLevel': '活動レベル：{value}',
    'ctx.prompt.foodPreferences': '食の好み：{value}',
    'ctx.prompt.dietaryRestrictions': '忌避食品：{value}',
    'ctx.prompt.budgetStatus': '予算状態：{value}',
    'ctx.prompt.nutritionPriority': '現在の優先修正：{value}',
    'ctx.prompt.contextSignals': '決定シグナル：{value}',
    'ctx.health.header': '【健康条件特別注意】',
    'ctx.health.diabetes':
      '- 糖尿病の方：炭水化物の総量とGI値を必ず監視。高でんぷん/高糖食品はリスクとして明記、決定はLIMIT/AVOID傾向。',
    'ctx.health.hypertension':
      '- 高血圧の方：ナトリウム含量を必ず監視。漬物、調味料、濃い味の外食は高ナトリウムリスクとして標記、低ナトリウム代替を推奨、決定はLIMIT傾向。',
    'ctx.health.heart':
      '- 心血管リスクの方：飽和脂肪と総脂肪を必ず監視。揚げ物、脂肪の多い肉、全脂乳製品はリスクとして明記、決定はLIMIT/AVOID傾向。',
    'ctx.health.gout':
      '- 痛風の方：高プリン食品（海鮮、内臓肉、濃厚なスープ）を監視。検出時にrasonで提示、低プリン代替を推奨。',
    'ctx.health.kidney':
      '- 腎臓病の方：タンパク質の総量（多すぎないこと）、カリウムとリンの含量を監視。高タンパク食品が常に良いわけではなく、適量を提案。',
    // V3.8 P2.2: pipeline i18n
    'pipeline.fallback.reason':
      '一時的に決定分析を完了できません。適量の摂取をお勧めします',
    'pipeline.fallback.summary':
      '分析サービスが一時的に利用できません。しばらくしてから再試行してください',
    'pipeline.quality.high': '分析品質が高く、現在の推奨に従って実行できます。',
    'pipeline.quality.medium':
      '分析品質は中程度です。空腹感と量を考慮して微調整してください。',
    'pipeline.quality.low':
      '分析品質が低めです。まず保守的に実行し、より明確な入力で再確認してください。',
    'pipeline.guardrail.lowQuality':
      '現在の分析品質が低いため、保守的な戦略で実行してください。',
    'pipeline.guardrail.avoid':
      '現在の推奨は摂取を控えることです。代替または減量を優先してください。',
    'pipeline.guardrail.postEat':
      '食事完了。次の食事の調整と適度な運動に重点を置いてください。',
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
