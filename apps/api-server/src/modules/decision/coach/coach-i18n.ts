/**
 * V3.3 Phase 3 — Decision Coach i18n 标签
 *
 * 三语（zh / en / ja）文案，覆盖：
 * - 问题标题 / 说明 / 行动建议
 * - 状态摘要
 * - 教育内容
 * - 通用指导语
 */

export type CoachLocale = 'zh' | 'en' | 'ja';

export interface CoachI18nStrings {
  // ── 标题 ──
  'headline.balanced': string;
  'headline.minor_adjust': string;
  'headline.protein_deficit': string;
  'headline.carb_excess': string;
  'headline.sodium_excess': string;
  'headline.fiber_deficit': string;
  'headline.sugar_excess': string;
  'headline.fat_excess': string;
  'headline.calorie_excess': string;
  'headline.generic': string;

  // ── 问题说明（含占位符 {metric} {threshold}） ──
  'explain.protein_deficit': string;
  'explain.carb_excess': string;
  'explain.sodium_excess': string;
  'explain.fiber_deficit': string;
  'explain.sugar_excess': string;
  'explain.fat_excess': string;
  'explain.calorie_excess': string;

  // ── 行动建议 ──
  'action.protein_deficit': string;
  'action.carb_excess': string;
  'action.sodium_excess': string;
  'action.fiber_deficit': string;
  'action.sugar_excess': string;
  'action.fat_excess': string;
  'action.calorie_excess': string;
  'action.generic': string;

  // ── 状态摘要（含占位符 {protein} {carbs} {fat} {issueCount}） ──
  'summary.template': string;
  'summary.no_slots': string;

  // ── 通用指导语 ──
  'guidance.base': string;
  'guidance.protein': string;
  'guidance.carbs': string;
  'guidance.fat': string;
  'guidance.close': string;

  // ── 教育内容标题 ──
  'edu.protein.topic': string;
  'edu.protein.why': string;
  'edu.protein.fix': string;
  'edu.fiber.topic': string;
  'edu.fiber.why': string;
  'edu.fiber.fix': string;
  'edu.sugar.topic': string;
  'edu.sugar.why': string;
  'edu.sugar.fix': string;
  'edu.balanced.topic': string;
  'edu.balanced.why': string;
  'edu.balanced.fix': string;
  // V3.7: CoachFormat 文案
  'format.reason.pushOverload': string;
  'format.reason.noSignal': string;
  'format.suggestion.switchLighter': string;
  'format.suggestion.reduceFirst': string;
  'format.suggestion.observeHunger': string;
  'format.suggestion.nextMealProtein': string;
  'format.suggestion.keepPace': string;
  'format.suggestion.addProtein': string;
  'format.encouragement.strict': string;
  'format.encouragement.friendly': string;
  'format.encouragement.data': string;
  'format.scoreInsight': string;
  // V3.7: ContextualModifier 文案
  'modifier.cumulativeSaturation': string;
  'modifier.lateNightRisk': string;
  'modifier.multiDayExcess': string;
  'modifier.healthyStreak': string;
  'modifier.bingeRisk': string;
  'modifier.bingeRiskReason': string;
  'modifier.lowConfidence': string;
}

const ZH: CoachI18nStrings = {
  'headline.balanced': '你的宏量摄入保持均衡！',
  'headline.minor_adjust': '今天需要做一些小调整。',
  'headline.protein_deficit': '是时候补充蛋白质了！',
  'headline.carb_excess': '下一餐可以选择更轻的碳水。',
  'headline.sodium_excess': '今天注意控制钠的摄入。',
  'headline.fiber_deficit': '多吃富含膳食纤维的食物。',
  'headline.sugar_excess': '是时候减少添加糖了。',
  'headline.fat_excess': '可以考虑低脂替代方案。',
  'headline.calorie_excess': '你今天的热量已接近目标。',
  'headline.generic': '调整你的营养计划。',

  'explain.protein_deficit':
    '你的蛋白质摄入低于目标。缺口：{metric}g（目标：{threshold}g）。',
  'explain.carb_excess':
    '碳水化合物摄入超标。超出：{metric}g（上限：{threshold}g）。',
  'explain.sodium_excess':
    '钠摄入高于推荐值。超出：{metric}mg（上限：{threshold}mg）。',
  'explain.fiber_deficit':
    '膳食纤维摄入不足。缺口：{metric}g（目标：{threshold}g）。',
  'explain.sugar_excess':
    '添加糖超过推荐量。超出：{metric}g（上限：{threshold}g）。',
  'explain.fat_excess': '脂肪摄入超标。超出：{metric}g（上限：{threshold}g）。',
  'explain.calorie_excess': '你已接近或超出每日热量上限。超出：{metric}kcal。',

  'action.protein_deficit': '从鸡肉、鱼、乳制品或豆类中补充 20-30g 蛋白质。',
  'action.carb_excess': '选择低碳水替代食物或减少份量。',
  'action.sodium_excess': '减少加工食品，烹饪时少加盐。',
  'action.fiber_deficit': '多吃蔬菜、全谷物和豆类。',
  'action.sugar_excess': '避免含糖饮料和加工零食。',
  'action.fat_excess': '选择瘦蛋白，减少烹饪用油。',
  'action.calorie_excess': '注意份量，或选择低热量替代食物。',
  'action.generic': '通过饮食调整来改善 {type}。',

  'summary.template':
    '当前宏量状态：蛋白质 {protein}，碳水 {carbs}，脂肪 {fat}。发现问题：{issueCount} 个。',
  'summary.no_slots': '宏量分析暂时不可用。',

  'guidance.base': '保持均衡饮食，专注于持续的饮食计划。',
  'guidance.protein': '每餐优先选择富含蛋白质的食物。',
  'guidance.carbs': '考虑低碳水餐次或减小份量。',
  'guidance.fat': '选择健康脂肪，减少饱和脂肪摄入。',
  'guidance.close': '追踪你的摄入，根据饥饿感调整份量。',

  'edu.protein.topic': '蛋白质的重要性',
  'edu.protein.why':
    '蛋白质是肌肉修复、力量与饱腹感的基础，充足摄入可防止肌肉流失并促进恢复。',
  'edu.protein.fix':
    '每餐加入鸡肉、鱼、豆腐、鸡蛋、乳制品或豆类，目标每餐 25-30g。',
  'edu.fiber.topic': '膳食纤维的好处',
  'edu.fiber.why':
    '膳食纤维有助于消化健康、稳定血糖并延长饱腹感，同时对心血管健康有益。',
  'edu.fiber.fix':
    '餐食中增加蔬菜、水果、全谷物、豆类和种子，逐步增量以避免消化不适。',
  'edu.sugar.topic': '糖分管理',
  'edu.sugar.why':
    '过多糖分会导致能量崩溃、体重增加和代谢疾病风险。控制糖分摄入有助于持续供能和牙齿健康。',
  'edu.sugar.fix': '仔细看标签，用整果代替果汁，限制甜点，谨慎使用天然甜味剂。',
  'edu.balanced.topic': '均衡营养',
  'edu.balanced.why':
    '均衡的宏量摄入支持持续供能、肌肉维持和整体健康，每种宏量各有独特作用。',
  'edu.balanced.fix': '继续追踪摄入，保持适合自己生活方式的稳定餐次节律。',
  // V3.7: CoachFormat 文案
  'format.reason.pushOverload': '当前这份食物会进一步推高摄入负担',
  'format.reason.noSignal': '当前没有必须补充的信号',
  'format.suggestion.switchLighter': '优先换更轻的搭配',
  'format.suggestion.reduceFirst': '如果一定要吃，先减量再吃',
  'format.suggestion.observeHunger': '可以先观察饥饿感',
  'format.suggestion.nextMealProtein': '下一餐优先补蛋白和蔬菜',
  'format.suggestion.keepPace': '按当前节奏食用',
  'format.suggestion.addProtein': '可额外搭配一份高蛋白食物',
  'format.encouragement.strict': '保持边界感，先做最稳妥的选择',
  'format.encouragement.friendly': '一步一步调整，比一次做满更重要',
  'format.encouragement.data': '把这次当作一次可量化的小优化',
  'format.scoreInsight': '{label}({score}分): {message}',
  // V3.7: ContextualModifier 文案
  'modifier.cumulativeSaturation': '今日总摄入已超标{percent}%',
  'modifier.lateNightRisk': '深夜进食可能影响睡眠和代谢',
  'modifier.multiDayExcess': '连续{days}天超标',
  'modifier.healthyStreak': '连续{days}天健康饮食，适度放宽',
  'modifier.bingeRisk': '今日已记录{count}餐，注意暴食风险',
  'modifier.bingeRiskReason': '今日已记录{count}餐，请关注进食节奏',
  'modifier.lowConfidence': '当前结论偏保守，建议结合更清晰输入复核',
};

const EN: CoachI18nStrings = {
  'headline.balanced': "You're maintaining a balanced macronutrient intake!",
  'headline.minor_adjust': 'Minor nutrition adjustments needed today.',
  'headline.protein_deficit': 'Time to boost your protein intake!',
  'headline.carb_excess': 'Consider lighter carbs for your next meal.',
  'headline.sodium_excess': 'Watch your sodium intake today.',
  'headline.fiber_deficit': 'Add more fiber-rich foods to your diet.',
  'headline.sugar_excess': 'Time to reduce added sugars.',
  'headline.fat_excess': 'Consider lower-fat options.',
  'headline.calorie_excess': "You're nearing your daily calorie target.",
  'headline.generic': 'Make adjustments to your nutrition plan.',

  'explain.protein_deficit':
    'Your protein intake is below target. Deficit: {metric}g (Threshold: {threshold}g).',
  'explain.carb_excess':
    'Your carbohydrate intake exceeds recommended. Excess: {metric}g (Max: {threshold}g).',
  'explain.sodium_excess':
    'Your sodium intake is higher than recommended. Excess: {metric}mg (Max: {threshold}mg).',
  'explain.fiber_deficit':
    'Your fiber intake is insufficient. Deficit: {metric}g (Target: {threshold}g).',
  'explain.sugar_excess':
    'Added sugar exceeds recommended levels. Excess: {metric}g (Max: {threshold}g).',
  'explain.fat_excess':
    'Fat intake is above target. Excess: {metric}g (Max: {threshold}g).',
  'explain.calorie_excess':
    'You are approaching or exceeding your daily calorie limit. Excess: {metric}kcal.',

  'action.protein_deficit':
    'Add 20-30g of protein from chicken, fish, dairy, or legumes.',
  'action.carb_excess':
    'Choose lower-carb alternatives or reduce portion sizes.',
  'action.sodium_excess': 'Limit processed foods and use less salt in cooking.',
  'action.fiber_deficit': 'Eat more vegetables, whole grains, and legumes.',
  'action.sugar_excess': 'Avoid sugary drinks and processed snacks.',
  'action.fat_excess': 'Choose lean proteins and reduce cooking oils.',
  'action.calorie_excess':
    'Watch portion sizes or choose lower-calorie alternatives.',
  'action.generic': 'Address {type} by making dietary adjustments.',

  'summary.template':
    'Macronutrient status — Protein: {protein}, Carbs: {carbs}, Fat: {fat}. Issues detected: {issueCount}.',
  'summary.no_slots': 'Macronutrient analysis unavailable.',

  'guidance.base':
    'To maintain balanced nutrition, focus on consistent meal planning. ',
  'guidance.protein': 'Prioritize protein-rich foods at each meal. ',
  'guidance.carbs': 'Consider lower-carb meals or smaller portions. ',
  'guidance.fat': 'Choose healthier fats and reduce saturated fats. ',
  'guidance.close':
    'Track your intake and adjust portions based on how you feel.',

  'edu.protein.topic': 'Protein Importance',
  'edu.protein.why':
    'Protein is essential for muscle repair, strength, and satiety. Adequate intake prevents muscle breakdown and supports recovery.',
  'edu.protein.fix':
    'Include lean protein sources like chicken, fish, tofu, eggs, dairy, and legumes in every meal. Aim for 25-30g per meal.',
  'edu.fiber.topic': 'Fiber Benefits',
  'edu.fiber.why':
    'Fiber supports digestive health, stabilizes blood sugar, and promotes lasting satiety. It also supports overall cardiovascular health.',
  'edu.fiber.fix':
    'Add vegetables, fruits, whole grains, beans, and seeds to your meals. Increase fiber gradually to avoid digestive discomfort.',
  'edu.sugar.topic': 'Sugar Management',
  'edu.sugar.why':
    'Excess sugar can lead to energy crashes, weight gain, and increased risk of metabolic diseases. Controlling sugar intake improves sustained energy and dental health.',
  'edu.sugar.fix':
    'Read labels, choose whole fruits instead of juices, limit desserts, and use natural sweeteners sparingly.',
  'edu.balanced.topic': 'Balanced Nutrition',
  'edu.balanced.why':
    'Balanced macronutrients support sustained energy, muscle maintenance, and overall health. Each macronutrient plays a unique role.',
  'edu.balanced.fix':
    'Continue monitoring your intake and maintaining consistent meal patterns that work for your lifestyle.',
  // V3.7: CoachFormat texts
  'format.reason.pushOverload':
    'This food will further increase your intake burden',
  'format.reason.noSignal': 'No urgent replenishment signal detected',
  'format.suggestion.switchLighter': 'Switch to a lighter pairing first',
  'format.suggestion.reduceFirst': 'If you must eat, reduce the portion first',
  'format.suggestion.observeHunger': 'Observe your hunger level first',
  'format.suggestion.nextMealProtein':
    'Prioritize protein and vegetables next meal',
  'format.suggestion.keepPace': 'Continue eating at current pace',
  'format.suggestion.addProtein': 'Consider adding a high-protein side',
  'format.encouragement.strict':
    'Stay disciplined, make the safest choice first',
  'format.encouragement.friendly': 'Small steps matter more than perfection',
  'format.encouragement.data':
    'Treat this as a small, quantifiable optimization',
  'format.scoreInsight': '{label}({score}pts): {message}',
  // V3.7: ContextualModifier texts
  'modifier.cumulativeSaturation':
    "Today's intake already {percent}% over budget",
  'modifier.lateNightRisk': 'Late-night eating may affect sleep and metabolism',
  'modifier.multiDayExcess': '{days} consecutive days over budget',
  'modifier.healthyStreak': '{days} days of healthy eating, relaxing slightly',
  'modifier.bingeRisk': '{count} meals logged today, watch for binge risk',
  'modifier.bingeRiskReason':
    '{count} meals logged today, mind your eating pace',
  'modifier.lowConfidence':
    'Current conclusion is conservative, consider providing clearer input for review',
};

const JA: CoachI18nStrings = {
  'headline.balanced': '栄養バランスが保たれています！',
  'headline.minor_adjust': '今日は少し調整が必要です。',
  'headline.protein_deficit': 'タンパク質を補充する時間です！',
  'headline.carb_excess': '次の食事では炭水化物を控えめにしましょう。',
  'headline.sodium_excess': '今日はナトリウムの摂取に注意してください。',
  'headline.fiber_deficit': '食物繊維が豊富な食品を増やしましょう。',
  'headline.sugar_excess': '添加糖を減らす時間です。',
  'headline.fat_excess': '低脂肪の選択肢を検討しましょう。',
  'headline.calorie_excess': '今日のカロリー目標に近づいています。',
  'headline.generic': '栄養計画を見直しましょう。',

  'explain.protein_deficit':
    'タンパク質摂取が目標を下回っています。不足量：{metric}g（目標：{threshold}g）。',
  'explain.carb_excess':
    '炭水化物の摂取が推奨量を超えています。超過：{metric}g（上限：{threshold}g）。',
  'explain.sodium_excess':
    'ナトリウム摂取が推奨量を超えています。超過：{metric}mg（上限：{threshold}mg）。',
  'explain.fiber_deficit':
    '食物繊維の摂取が不足しています。不足量：{metric}g（目標：{threshold}g）。',
  'explain.sugar_excess':
    '添加糖が推奨量を超えています。超過：{metric}g（上限：{threshold}g）。',
  'explain.fat_excess':
    '脂肪摂取が目標を超えています。超過：{metric}g（上限：{threshold}g）。',
  'explain.calorie_excess':
    '1日のカロリー上限に近づいているか超えています。超過：{metric}kcal。',

  'action.protein_deficit':
    '鶏肉、魚、乳製品、豆類から20〜30gのタンパク質を補給してください。',
  'action.carb_excess': '低炭水化物の代替食品を選ぶか、量を減らしてください。',
  'action.sodium_excess': '加工食品を控え、調理の塩分を減らしてください。',
  'action.fiber_deficit': '野菜、全粒穀物、豆類を多く摂取してください。',
  'action.sugar_excess': '甘い飲み物や加工スナックを避けてください。',
  'action.fat_excess': '赤身のタンパク質を選び、調理油を減らしてください。',
  'action.calorie_excess':
    '食事量に注意するか、低カロリーの代替食品を選んでください。',
  'action.generic': '{type}を改善するために食事を調整してください。',

  'summary.template':
    '現在の栄養素状態：タンパク質 {protein}、炭水化物 {carbs}、脂肪 {fat}。検出された問題：{issueCount}件。',
  'summary.no_slots': '栄養素分析は利用できません。',

  'guidance.base':
    'バランスの取れた食事を維持するため、一貫した食事計画に取り組みましょう。',
  'guidance.protein': '毎食タンパク質豊富な食品を優先しましょう。',
  'guidance.carbs': '低炭水化物の食事や少量を検討してください。',
  'guidance.fat': '健康的な脂肪を選び、飽和脂肪を減らしましょう。',
  'guidance.close': '摂取量を記録し、空腹感に合わせて量を調整してください。',

  'edu.protein.topic': 'タンパク質の重要性',
  'edu.protein.why':
    'タンパク質は筋肉の修復、強度、満腹感に不可欠です。適切な摂取は筋肉の分解を防ぎ、回復をサポートします。',
  'edu.protein.fix':
    '毎食に鶏肉、魚、豆腐、卵、乳製品、豆類などの良質なタンパク質を取り入れましょう。1食あたり25〜30gを目標に。',
  'edu.fiber.topic': '食物繊維のメリット',
  'edu.fiber.why':
    '食物繊維は消化健康をサポートし、血糖を安定させ、持続的な満腹感を促進します。心血管の健康にも良い影響を与えます。',
  'edu.fiber.fix':
    '野菜、果物、全粒穀物、豆類、種子を食事に加えましょう。消化不快を避けるため、徐々に増やしてください。',
  'edu.sugar.topic': '糖分管理',
  'edu.sugar.why':
    '過剰な糖分はエネルギーの急落、体重増加、代謝疾患リスクにつながります。糖分のコントロールは持続的なエネルギーと歯の健康を改善します。',
  'edu.sugar.fix':
    'ラベルを確認し、ジュースの代わりに果物を選び、デザートを控え、天然甘味料は慎重に使用してください。',
  'edu.balanced.topic': 'バランスの取れた栄養',
  'edu.balanced.why':
    'バランスの取れた栄養素は持続的なエネルギー、筋肉維持、全体的な健康をサポートします。各栄養素は独自の役割を担っています。',
  'edu.balanced.fix':
    '摂取量の追跡を続け、自分のライフスタイルに合った安定した食事パターンを維持してください。',
  // V3.7: CoachFormat テキスト
  'format.reason.pushOverload': 'この食事は摂取負担をさらに増やします',
  'format.reason.noSignal': '緊急の補充シグナルはありません',
  'format.suggestion.switchLighter': 'まず軽めの組み合わせに切り替えましょう',
  'format.suggestion.reduceFirst':
    'どうしても食べるなら、まず量を減らしましょう',
  'format.suggestion.observeHunger': 'まず空腹感を確認してください',
  'format.suggestion.nextMealProtein': '次の食事ではタンパク質と野菜を優先',
  'format.suggestion.keepPace': '現在のペースで食事を続けてください',
  'format.suggestion.addProtein': '高タンパクのサイドメニューの追加を検討',
  'format.encouragement.strict': '規律を保ち、最も安全な選択をしましょう',
  'format.encouragement.friendly': '少しずつの調整が完璧を目指すより大切です',
  'format.encouragement.data': 'これを定量的な小さな最適化として捉えましょう',
  'format.scoreInsight': '{label}({score}点): {message}',
  // V3.7: ContextualModifier テキスト
  'modifier.cumulativeSaturation': '本日の摂取量が予算を{percent}%超過',
  'modifier.lateNightRisk': '深夜の食事は睡眠と代謝に影響する可能性があります',
  'modifier.multiDayExcess': '{days}日連続で超過',
  'modifier.healthyStreak': '{days}日間健康的な食事、少し余裕を',
  'modifier.bingeRisk': '本日{count}食記録、過食リスクに注意',
  'modifier.bingeRiskReason': '本日{count}食記録、食事ペースにご注意',
  'modifier.lowConfidence':
    '現在の結論は控えめです。より明確な入力で再確認をお勧めします',
};

export const COACH_I18N: Record<CoachLocale, CoachI18nStrings> = {
  zh: ZH,
  en: EN,
  ja: JA,
};

/**
 * 获取 i18n 文案，支持占位符替换
 * @param key - 文案键
 * @param locale - 语言（默认 zh）
 * @param vars - 占位符变量
 */
export function ci(
  key: keyof CoachI18nStrings,
  locale: CoachLocale = 'zh',
  vars?: Record<string, string | number>,
): string {
  const strings = COACH_I18N[locale] ?? COACH_I18N.zh;
  let text = strings[key] ?? COACH_I18N.zh[key] ?? String(key);

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }

  return text;
}

/** 将 Locale（来自 i18n-messages）映射到 CoachLocale */
export function toCoachLocale(locale?: string): CoachLocale {
  if (locale === 'en') return 'en';
  if (locale === 'ja' || locale === 'ja-JP') return 'ja';
  return 'zh';
}
