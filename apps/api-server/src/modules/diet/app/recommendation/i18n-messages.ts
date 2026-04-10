/**
 * 推荐系统 i18n 文案资源 (V4 Phase 3.5)
 * V6 Phase 2.10 — i18n L1: 系统消息国际化框架
 *
 * 设计动机:
 * - 所有用户可见的 tip / strategy / label 集中管理
 * - V6 扩展: 支持 zh-CN / en-US / ja-JP 三种语言
 * - 模板字符串使用 {{var}} 占位符，由 t() 函数替换
 * - t() 支持可选的 locale 参数，优先级: 参数 > currentLocale > fallback(zh-CN)
 *
 * 用法:
 *   import { t, setLocale } from './i18n-messages';
 *   const tip = t('tip.caloriesOver');                    // 使用当前 locale
 *   const tip = t('tip.caloriesOver', {}, 'en-US');       // 指定 locale
 *   const note = t('adjust.lunchDinner', { lunchBudget: 800 });
 *
 * V6 2.10 新增:
 * - Locale 类型扩展: 'en-US' | 'ja-JP'
 * - t() 支持第三参数 locale 覆盖
 * - 系统消息 key: error.*, validation.*, notification.*
 * - 推荐解释 key: explain.*（预留给 2.11）
 */

export type Locale = 'zh-CN' | 'en-US' | 'ja-JP';

/** 默认回退语言 */
const FALLBACK_LOCALE: Locale = 'zh-CN';

// ==================== zh-CN 中文简体 ====================

const zhCN: Record<string, string> = {
  // ── meal-assembler.service.ts: buildTip() ──
  'tip.caloriesOver': '推荐总热量略超预算，可减少份量',
  'tip.caloriesUnder': '推荐量偏少，可适当加一份水果或酸奶',
  'tip.goal.fat_loss': '减脂期优先高蛋白低脂食物',
  'tip.goal.muscle_gain': '增肌期碳水蛋白并重',
  'tip.goal.health': '均衡搭配，注意蔬果',
  'tip.goal.habit': '保持规律即可',
  'tip.meal.breakfast': '早餐注意蛋白质摄入',
  'tip.meal.lunch': '午餐是一天的能量主力',
  'tip.meal.dinner': '晚餐清淡为主',
  'tip.meal.snack': '加餐控量，选择健康零食',

  // ── meal-assembler.service.ts: aggregateMealResult() ──
  'display.foodItem': '{{name}}（{{serving}}，{{calories}}kcal）',

  // ── daily-plan.service.ts: 跨餐补偿 ──
  'meal.label.breakfast': '早餐',
  'meal.label.lunch': '午餐',
  'meal.label.dinner': '晚餐',
  'meal.label.snack': '加餐',
  'compensation.adjusted': '已自动调整{{meal}}以平衡全天营养',
  'compensation.lowProtein': '全天蛋白质不足，建议晚餐加一份鸡蛋或豆腐',
  'compensation.highCalories': '全天热量偏高，建议减少加餐或晚餐份量',

  // ── daily-plan.service.ts: adjustPlan() ──
  'adjust.caloriesReached': '今日热量已达标，建议不再进食',
  'adjust.fallbackDinnerFoods': '一碗清汤 + 蔬菜',
  'adjust.fallbackDinnerTip': '超标后清淡收口',
  'adjust.lunchDinner':
    '午餐建议控制在 {{lunchBudget}} kcal，晚餐 {{dinnerBudget}} kcal',
  'adjust.dinnerBudget': '晚餐预算调整为 {{remaining}} kcal',
  'adjust.nightSnack': '剩余 {{remaining}} kcal，注意控制夜宵',

  // ── daily-plan.service.ts: buildStrategy() ──
  'strategy.fat_loss': '减脂阶段：优先高蛋白食物，控制碳水，晚餐尽量清淡',
  'strategy.muscle_gain': '增肌阶段：碳水蛋白并重，训练后及时补充',
  'strategy.health': '健康维持：三餐均衡，注意蔬果摄入',
  'strategy.habit': '习惯培养：保持规律饮食节奏，循序渐进',
  'strategy.lowCalorie': '低热量日，注意营养密度',
  'strategy.highCalorie': '高热量日，分散进食避免积食',
  'strategy.morningWater': '早起先喝一杯水',
  'strategy.afternoonHydration': '下午注意补水，防止假饥饿',

  // ── recommendation-engine.service.ts: recommendByScenario() ──
  'scenario.tip': '{{scenarioName}}推荐，约 {{calories}} kcal',
  'scenario.takeout': '外卖',
  'scenario.convenience': '便利店',
  'scenario.homeCook': '在家做',

  // ── V6 2.10: 系统错误消息 ──
  'error.notFound': '未找到请求的资源',
  'error.unauthorized': '请先登录',
  'error.forbidden': '无权限访问',
  'error.rateLimited': '请求过于频繁，请稍后再试',
  'error.serverError': '服务器内部错误，请稍后重试',
  'error.foodNotFound': '食物库中未找到"{{foodName}}"',
  'error.profileNotFound': '用户画像尚未设置，请先完善个人信息',
  'error.planNotFound': '今日饮食计划尚未生成',

  // ── V6 2.10: 验证消息 ──
  'validation.required': '{{field}}不能为空',
  'validation.invalidFormat': '{{field}}格式不正确',
  'validation.outOfRange': '{{field}}超出允许范围（{{min}}-{{max}}）',
  'validation.invalidMealType': '无效的餐次类型',
  'validation.invalidGoalType': '无效的目标类型',

  // ── V6 2.10: 通知消息 ──
  'notification.mealReminder.title': '{{meal}}时间到了',
  'notification.mealReminder.body': '查看今日{{meal}}推荐，保持健康饮食习惯',
  'notification.streakRisk.title': '别让连续记录中断',
  'notification.streakRisk.body':
    '你已经连续记录 {{streak}} 天了，今天还差一次记录就能继续保持！',
  'notification.goalProgress.title': '本周目标进展',
  'notification.goalProgress.body':
    '本周已达成 {{achieved}}/{{total}} 天目标，继续加油！',
  'notification.weeklyReport.title': '周度营养报告已生成',
  'notification.weeklyReport.body': '查看你的周度营养分析和改善建议',
  'notification.precomputedReady.title': '今日餐单已备好',
  'notification.precomputedReady.body': '查看为你精心准备的一日三餐推荐',

  // ── V6 2.10: API 响应消息 ──
  'response.success': '操作成功',
  'response.created': '创建成功',
  'response.updated': '更新成功',
  'response.deleted': '删除成功',
  'response.feedbackRecorded': '反馈已记录',
  'response.planAdjusted': '计划已调整',
  'response.planRegenerated': '计划已重新生成',
  'response.explainGenerated': '解释生成成功',

  // ── V6 2.10: 付费预览提示 ──
  'premium.upgradeTeaser':
    '升级 Pro 查看完整 10 维营养分析、营养素进度追踪和个性化对比报告',
  'premium.featureLocked': '此功能为 Pro 专属，升级后解锁',

  // ── V6 2.11: 评分维度标签 ──
  'explain.dim.calories': '热量匹配',
  'explain.dim.protein': '蛋白质',
  'explain.dim.carbs': '碳水化合物',
  'explain.dim.fat': '脂肪控制',
  'explain.dim.quality': '食物品质',
  'explain.dim.satiety': '饱腹感',
  'explain.dim.glycemic': '血糖友好',
  'explain.dim.nutrientDensity': '营养密度',
  'explain.dim.inflammation': '抗炎指数',
  'explain.dim.fiber': '膳食纤维',

  // ── V6 2.11: 目标类型文案 ──
  'explain.goal.fat_loss': '减脂',
  'explain.goal.muscle_gain': '增肌',
  'explain.goal.health': '健康维持',
  'explain.goal.habit': '饮食习惯养成',
  'explain.goal.default': '你的饮食',

  // ── V6 2.11: 推荐理由文案 ──
  'explain.reason.highProtein': '高蛋白含量有助于{{goal}}目标',
  'explain.reason.proteinModerate': '蛋白质含量适中，满足日常需求',
  'explain.reason.caloriesMatch': '热量与{{goal}}目标匹配度高',
  'explain.reason.richFiber': '富含膳食纤维，促进消化健康',
  'explain.reason.lowGI': '低升糖指数，有助于血糖稳定',
  'explain.reason.glycemicGood': '血糖友好度较好',
  'explain.reason.naturalFood': '低加工天然食材，营养保留更完整',
  'explain.reason.highNutrientDensity': '营养密度高，每一口都有价值',
  'explain.reason.balancedNutrition': '营养均衡',
  'explain.reason.highSatiety': '饱腹感评分较高，帮助控制食欲',
  'explain.reason.antiInflammation': '抗炎特性良好',
  'explain.reason.lowSaturatedFat': '低饱和脂肪，心血管更友好',
  'explain.reason.fatBalanced': '脂肪比例适宜',
  'explain.reason.carbsMatch': '碳水比例符合目标需求',
  'explain.reason.fallback': '综合评分较高，适合{{goal}}目标',

  // ── V6 2.11: 营养亮点标签 ──
  'explain.tag.highProtein': '高蛋白',
  'explain.tag.richFiber': '富含膳食纤维',
  'explain.tag.lowGI': '低GI',
  'explain.tag.naturalFood': '天然食材',
  'explain.tag.highNutrientDensity': '高营养密度',
  'explain.tag.lowSaturatedFat': '低饱和脂肪',
  'explain.tag.lowSodium': '低钠',
  'explain.tag.lowFODMAP': '低FODMAP',
  'explain.tag.highCalcium': '高钙',
  'explain.tag.richIron': '富含铁',

  // ── V6 2.11: 健康提示 ──
  'explain.health.diabetesLowGI': '低升糖指数食物，适合血糖管理',
  'explain.health.hypertensionLowSodium': '低钠食物，有助于血压控制',
  'explain.health.hyperlipidemiaLowChol': '低胆固醇食物，有助于血脂管理',
  'explain.health.goutLowPurine': '低嘌呤食物，痛风患者可放心食用',
  'explain.health.kidneyLowPhosK': '低磷低钾，适合肾功能受损人群',
  'explain.health.ibsLowFODMAP': '低FODMAP食物，减少肠道刺激',
  'explain.health.osteoHighCalcium': '高钙食物，有助于骨骼健康',
  'explain.health.anemiaHighIron': '铁含量丰富，有助于改善贫血',
  'explain.health.fattyLiverLowFat': '低脂食物，有助于肝脏减负',

  // ── V6 2.11: 反向解释文案 ──
  'explain.whyNot.healthRisk': '健康风险: {{reasons}}',
  'explain.whyNot.healthVetoed': '因健康条件限制，该食物被系统排除',
  'explain.whyNot.novaPenalty':
    '该食物加工程度较高（NOVA 惩罚因子 {{penalty}}%），不利于{{goal}}目标',
  'explain.whyNot.weakDimensions': '在以下维度表现较弱: {{dims}}',
  'explain.whyNot.preferenceNoMatch': '该食物与你的饮食偏好不匹配',
  'explain.whyNot.recentNegative': '你近期对该类食物的反馈较消极',
  'explain.whyNot.lowScore':
    '该食物综合评分偏低，在当前{{goal}}目标下有更优选择',
  'explain.whyNot.fallback':
    '该食物在当前推荐条件下未能入选，可能是营养搭配或多样性策略所致',

  // ── V6 2.11: 营养素进度条标签 ──
  'explain.nutrient.calories': '热量',
  'explain.nutrient.protein': '蛋白质',
  'explain.nutrient.carbs': '碳水化合物',
  'explain.nutrient.fat': '脂肪',
  'explain.nutrient.fiber': '膳食纤维',
};

// ==================== en-US 英文 ====================

const enUS: Record<string, string> = {
  // ── Tips ──
  'tip.caloriesOver':
    'Recommended calories slightly exceed budget, consider smaller portions',
  'tip.caloriesUnder':
    'Recommendation is a bit low, consider adding a fruit or yogurt',
  'tip.goal.fat_loss': 'Fat loss phase: prioritize high-protein, low-fat foods',
  'tip.goal.muscle_gain': 'Muscle gain phase: balance carbs and protein',
  'tip.goal.health': 'Balanced diet, focus on fruits and vegetables',
  'tip.goal.habit': 'Maintain regular eating habits',
  'tip.meal.breakfast': 'Ensure adequate protein at breakfast',
  'tip.meal.lunch': 'Lunch is the main energy source of the day',
  'tip.meal.dinner': 'Keep dinner light',
  'tip.meal.snack': 'Limit snack portions, choose healthy options',

  // ── Display ──
  'display.foodItem': '{{name}} ({{serving}}, {{calories}}kcal)',

  // ── Meal labels ──
  'meal.label.breakfast': 'Breakfast',
  'meal.label.lunch': 'Lunch',
  'meal.label.dinner': 'Dinner',
  'meal.label.snack': 'Snack',
  'compensation.adjusted':
    '{{meal}} has been auto-adjusted to balance daily nutrition',
  'compensation.lowProtein':
    'Daily protein is low, consider adding eggs or tofu at dinner',
  'compensation.highCalories':
    'Daily calories are high, consider reducing snacks or dinner portions',

  // ── Adjust ──
  'adjust.caloriesReached':
    "Today's calorie goal has been met, no more food recommended",
  'adjust.fallbackDinnerFoods': 'Light soup + vegetables',
  'adjust.fallbackDinnerTip': 'Keep it light after exceeding budget',
  'adjust.lunchDinner':
    'Lunch budget: {{lunchBudget}} kcal, dinner budget: {{dinnerBudget}} kcal',
  'adjust.dinnerBudget': 'Dinner budget adjusted to {{remaining}} kcal',
  'adjust.nightSnack':
    '{{remaining}} kcal remaining, watch late-night snacking',

  // ── Strategy ──
  'strategy.fat_loss':
    'Fat loss: prioritize high-protein foods, control carbs, keep dinner light',
  'strategy.muscle_gain':
    'Muscle gain: balance carbs and protein, refuel after training',
  'strategy.health':
    'Health maintenance: balanced meals, focus on fruits and veggies',
  'strategy.habit':
    'Habit building: maintain regular eating rhythm, gradual progress',
  'strategy.lowCalorie': 'Low calorie day, focus on nutrient density',
  'strategy.highCalorie': 'High calorie day, spread meals to avoid overeating',
  'strategy.morningWater': 'Start your day with a glass of water',
  'strategy.afternoonHydration':
    'Stay hydrated in the afternoon to avoid false hunger',

  // ── Scenario ──
  'scenario.tip': '{{scenarioName}} recommendation, ~{{calories}} kcal',
  'scenario.takeout': 'Takeout',
  'scenario.convenience': 'Convenience Store',
  'scenario.homeCook': 'Home Cook',

  // ── System errors ──
  'error.notFound': 'Requested resource not found',
  'error.unauthorized': 'Please log in first',
  'error.forbidden': 'Access denied',
  'error.rateLimited': 'Too many requests, please try again later',
  'error.serverError': 'Internal server error, please try again later',
  'error.foodNotFound': '"{{foodName}}" not found in the food database',
  'error.profileNotFound':
    'User profile not set up, please complete your profile first',
  'error.planNotFound': "Today's meal plan has not been generated yet",

  // ── Validation ──
  'validation.required': '{{field}} is required',
  'validation.invalidFormat': '{{field}} has an invalid format',
  'validation.outOfRange': '{{field}} is out of range ({{min}}-{{max}})',
  'validation.invalidMealType': 'Invalid meal type',
  'validation.invalidGoalType': 'Invalid goal type',

  // ── Notifications ──
  'notification.mealReminder.title': 'Time for {{meal}}',
  'notification.mealReminder.body':
    "Check today's {{meal}} recommendations and maintain healthy eating habits",
  'notification.streakRisk.title': "Don't break your streak!",
  'notification.streakRisk.body':
    "You've logged for {{streak}} consecutive days. Just one more entry today to keep it going!",
  'notification.goalProgress.title': 'Weekly Goal Progress',
  'notification.goalProgress.body':
    'Achieved {{achieved}}/{{total}} days this week, keep going!',
  'notification.weeklyReport.title': 'Weekly Nutrition Report is Ready',
  'notification.weeklyReport.body':
    'Check your weekly nutrition analysis and improvement tips',
  'notification.precomputedReady.title': "Today's Meal Plan is Ready",
  'notification.precomputedReady.body':
    'Check out the personalized meal recommendations prepared for you',

  // ── API responses ──
  'response.success': 'Success',
  'response.created': 'Created successfully',
  'response.updated': 'Updated successfully',
  'response.deleted': 'Deleted successfully',
  'response.feedbackRecorded': 'Feedback recorded',
  'response.planAdjusted': 'Plan adjusted',
  'response.planRegenerated': 'Plan regenerated',
  'response.explainGenerated': 'Explanation generated',

  // ── Premium ──
  'premium.upgradeTeaser':
    'Upgrade to Pro for full 10-dimension nutrition analysis, progress tracking, and personalized reports',
  'premium.featureLocked': 'This feature is Pro-exclusive, upgrade to unlock',

  // ── V6 2.11: Scoring dimension labels ──
  'explain.dim.calories': 'Calorie Match',
  'explain.dim.protein': 'Protein',
  'explain.dim.carbs': 'Carbohydrates',
  'explain.dim.fat': 'Fat Control',
  'explain.dim.quality': 'Food Quality',
  'explain.dim.satiety': 'Satiety',
  'explain.dim.glycemic': 'Glycemic Index',
  'explain.dim.nutrientDensity': 'Nutrient Density',
  'explain.dim.inflammation': 'Anti-inflammation',
  'explain.dim.fiber': 'Dietary Fiber',

  // ── V6 2.11: Goal type text ──
  'explain.goal.fat_loss': 'fat loss',
  'explain.goal.muscle_gain': 'muscle gain',
  'explain.goal.health': 'health maintenance',
  'explain.goal.habit': 'eating habit building',
  'explain.goal.default': 'your diet',

  // ── V6 2.11: Recommendation reasons ──
  'explain.reason.highProtein':
    'High protein content supports your {{goal}} goal',
  'explain.reason.proteinModerate':
    'Moderate protein content meets daily needs',
  'explain.reason.caloriesMatch':
    'Calorie content aligns well with your {{goal}} goal',
  'explain.reason.richFiber':
    'Rich in dietary fiber, promotes digestive health',
  'explain.reason.lowGI':
    'Low glycemic index, helps maintain stable blood sugar',
  'explain.reason.glycemicGood': 'Good glycemic index profile',
  'explain.reason.naturalFood': 'Minimally processed, retains more nutrients',
  'explain.reason.highNutrientDensity':
    'High nutrient density, every bite counts',
  'explain.reason.balancedNutrition': 'Well-balanced nutrition',
  'explain.reason.highSatiety': 'High satiety score, helps control appetite',
  'explain.reason.antiInflammation': 'Good anti-inflammatory properties',
  'explain.reason.lowSaturatedFat': 'Low in saturated fat, heart-friendly',
  'explain.reason.fatBalanced': 'Well-balanced fat content',
  'explain.reason.carbsMatch': 'Carb ratio matches your goal',
  'explain.reason.fallback':
    'High overall score, suitable for your {{goal}} goal',

  // ── V6 2.11: Nutrition highlight tags ──
  'explain.tag.highProtein': 'High Protein',
  'explain.tag.richFiber': 'Rich in Fiber',
  'explain.tag.lowGI': 'Low GI',
  'explain.tag.naturalFood': 'Natural Food',
  'explain.tag.highNutrientDensity': 'Nutrient Dense',
  'explain.tag.lowSaturatedFat': 'Low Sat. Fat',
  'explain.tag.lowSodium': 'Low Sodium',
  'explain.tag.lowFODMAP': 'Low FODMAP',
  'explain.tag.highCalcium': 'High Calcium',
  'explain.tag.richIron': 'Rich in Iron',

  // ── V6 2.11: Health tips ──
  'explain.health.diabetesLowGI':
    'Low glycemic index food, suitable for blood sugar management',
  'explain.health.hypertensionLowSodium':
    'Low sodium food, helps control blood pressure',
  'explain.health.hyperlipidemiaLowChol':
    'Low cholesterol food, helps manage blood lipid levels',
  'explain.health.goutLowPurine': 'Low purine food, safe for gout patients',
  'explain.health.kidneyLowPhosK':
    'Low phosphorus and potassium, suitable for kidney health',
  'explain.health.ibsLowFODMAP': 'Low FODMAP food, reduces gut irritation',
  'explain.health.osteoHighCalcium': 'High calcium food, supports bone health',
  'explain.health.anemiaHighIron': 'Rich in iron, helps improve anemia',
  'explain.health.fattyLiverLowFat': 'Low fat food, helps reduce liver burden',

  // ── V6 2.11: Why-not explanations ──
  'explain.whyNot.healthRisk': 'Health risk: {{reasons}}',
  'explain.whyNot.healthVetoed':
    'This food was excluded due to health condition restrictions',
  'explain.whyNot.novaPenalty':
    'This food is highly processed (NOVA penalty factor {{penalty}}%), not ideal for your {{goal}} goal',
  'explain.whyNot.weakDimensions': 'Weak performance in: {{dims}}',
  'explain.whyNot.preferenceNoMatch':
    'This food does not match your dietary preferences',
  'explain.whyNot.recentNegative':
    'Your recent feedback on this type of food was negative',
  'explain.whyNot.lowScore':
    'Overall score is low; there are better options for your {{goal}} goal',
  'explain.whyNot.fallback':
    'This food did not make the selection under current conditions, possibly due to nutrition balance or diversity strategy',

  // ── V6 2.11: Nutrient progress bar labels ──
  'explain.nutrient.calories': 'Calories',
  'explain.nutrient.protein': 'Protein',
  'explain.nutrient.carbs': 'Carbohydrates',
  'explain.nutrient.fat': 'Fat',
  'explain.nutrient.fiber': 'Dietary Fiber',
};

const jaJP: Record<string, string> = {
  // ── Tips ──
  'tip.caloriesOver':
    'おすすめのカロリーが予算を少し超えています。量を減らしてみてください',
  'tip.caloriesUnder':
    'おすすめが少なめです。フルーツやヨーグルトを追加してみてください',
  'tip.goal.fat_loss': '減量期：高タンパク・低脂質の食品を優先',
  'tip.goal.muscle_gain': '増量期：炭水化物とタンパク質をバランスよく',
  'tip.goal.health': 'バランスの良い食事、野菜と果物を意識',
  'tip.goal.habit': '規則正しい食事習慣を維持',
  'tip.meal.breakfast': '朝食はタンパク質の摂取を意識',
  'tip.meal.lunch': '昼食は一日のエネルギー源',
  'tip.meal.dinner': '夕食は軽めに',
  'tip.meal.snack': '間食は控えめに、ヘルシーなものを選択',

  // ── Display ──
  'display.foodItem': '{{name}}（{{serving}}、{{calories}}kcal）',

  // ── Meal labels ──
  'meal.label.breakfast': '朝食',
  'meal.label.lunch': '昼食',
  'meal.label.dinner': '夕食',
  'meal.label.snack': '間食',
  'compensation.adjusted':
    '{{meal}}を自動調整して一日の栄養バランスを整えました',
  'compensation.lowProtein':
    '一日のタンパク質が不足気味です。夕食に卵や豆腐を追加してみてください',
  'compensation.highCalories':
    '一日のカロリーが高めです。間食や夕食の量を減らしてみてください',

  // ── Adjust ──
  'adjust.caloriesReached':
    '本日のカロリー目標を達成しました。これ以上の食事は控えましょう',
  'adjust.fallbackDinnerFoods': 'スープ + 野菜',
  'adjust.fallbackDinnerTip': '予算超過後は軽めに',
  'adjust.lunchDinner':
    '昼食の目安: {{lunchBudget}} kcal、夕食: {{dinnerBudget}} kcal',
  'adjust.dinnerBudget': '夕食の予算を {{remaining}} kcal に調整',
  'adjust.nightSnack': '残り {{remaining}} kcal、夜食に注意',

  // ── Strategy ──
  'strategy.fat_loss':
    '減量フェーズ：高タンパク食品を優先、炭水化物を控え、夕食は軽めに',
  'strategy.muscle_gain':
    '増量フェーズ：炭水化物とタンパク質をバランスよく、トレーニング後に補給',
  'strategy.health': '健康維持：バランスの良い食事、果物と野菜を意識',
  'strategy.habit': '習慣づくり：規則正しい食事リズムを維持、少しずつ改善',
  'strategy.lowCalorie': '低カロリーデー、栄養密度を意識',
  'strategy.highCalorie': '高カロリーデー、食事を分散して消化を助ける',
  'strategy.morningWater': '朝起きたらまず一杯の水を',
  'strategy.afternoonHydration': '午後は水分補給を意識、空腹と脱水を区別',

  // ── Scenario ──
  'scenario.tip': '{{scenarioName}}おすすめ、約 {{calories}} kcal',
  'scenario.takeout': 'デリバリー',
  'scenario.convenience': 'コンビニ',
  'scenario.homeCook': '自炊',

  // ── System errors ──
  'error.notFound': 'リソースが見つかりません',
  'error.unauthorized': 'ログインしてください',
  'error.forbidden': 'アクセス権限がありません',
  'error.rateLimited':
    'リクエストが多すぎます。しばらくしてから再試行してください',
  'error.serverError':
    'サーバーエラーが発生しました。しばらくしてから再試行してください',
  'error.foodNotFound': '「{{foodName}}」はデータベースに見つかりません',
  'error.profileNotFound':
    'プロフィールが未設定です。まず個人情報を入力してください',
  'error.planNotFound': '本日の食事プランはまだ生成されていません',

  // ── Validation ──
  'validation.required': '{{field}}は必須です',
  'validation.invalidFormat': '{{field}}の形式が正しくありません',
  'validation.outOfRange': '{{field}}が範囲外です（{{min}}〜{{max}}）',
  'validation.invalidMealType': '無効な食事タイプ',
  'validation.invalidGoalType': '無効な目標タイプ',

  // ── Notifications ──
  'notification.mealReminder.title': '{{meal}}の時間です',
  'notification.mealReminder.body':
    '今日の{{meal}}のおすすめを確認して、健康的な食生活を維持しましょう',
  'notification.streakRisk.title': '連続記録を途切れさせないで！',
  'notification.streakRisk.body':
    '{{streak}}日連続で記録しています。今日あと1回記録すれば継続できます！',
  'notification.goalProgress.title': '今週の目標進捗',
  'notification.goalProgress.body':
    '今週 {{achieved}}/{{total}} 日達成しました。引き続き頑張りましょう！',
  'notification.weeklyReport.title': '週次栄養レポートが完成しました',
  'notification.weeklyReport.body':
    '週次栄養分析と改善アドバイスを確認してください',
  'notification.precomputedReady.title': '今日の食事プランが準備できました',
  'notification.precomputedReady.body':
    'あなたのためにカスタマイズされた食事おすすめを確認してください',

  // ── API responses ──
  'response.success': '成功',
  'response.created': '作成成功',
  'response.updated': '更新成功',
  'response.deleted': '削除成功',
  'response.feedbackRecorded': 'フィードバックを記録しました',
  'response.planAdjusted': 'プランを調整しました',
  'response.planRegenerated': 'プランを再生成しました',
  'response.explainGenerated': '説明を生成しました',

  // ── Premium ──
  'premium.upgradeTeaser':
    'Pro にアップグレードして、10次元の栄養分析、進捗トラッキング、パーソナライズレポートを利用しましょう',
  'premium.featureLocked': 'この機能は Pro 限定です。アップグレードして解除',

  // ── V6 2.11: スコアリング次元ラベル ──
  'explain.dim.calories': 'カロリー一致',
  'explain.dim.protein': 'タンパク質',
  'explain.dim.carbs': '炭水化物',
  'explain.dim.fat': '脂質コントロール',
  'explain.dim.quality': '食品品質',
  'explain.dim.satiety': '満腹感',
  'explain.dim.glycemic': '血糖値対応',
  'explain.dim.nutrientDensity': '栄養密度',
  'explain.dim.inflammation': '抗炎症指数',
  'explain.dim.fiber': '食物繊維',

  // ── V6 2.11: 目標タイプテキスト ──
  'explain.goal.fat_loss': '減量',
  'explain.goal.muscle_gain': '増量',
  'explain.goal.health': '健康維持',
  'explain.goal.habit': '食習慣づくり',
  'explain.goal.default': 'あなたの食事',

  // ── V6 2.11: おすすめ理由 ──
  'explain.reason.highProtein': '高タンパク質で{{goal}}目標に効果的',
  'explain.reason.proteinModerate': 'タンパク質が適量で日常のニーズに対応',
  'explain.reason.caloriesMatch': 'カロリーが{{goal}}目標にマッチ',
  'explain.reason.richFiber': '食物繊維が豊富で、消化の健康を促進',
  'explain.reason.lowGI': '低GI値で血糖値の安定に貢献',
  'explain.reason.glycemicGood': '血糖値への影響が少ない',
  'explain.reason.naturalFood': '低加工の天然食材で栄養がより完全',
  'explain.reason.highNutrientDensity': '栄養密度が高く、一口一口に価値がある',
  'explain.reason.balancedNutrition': '栄養バランスが良好',
  'explain.reason.highSatiety': '満腹感スコアが高く、食欲コントロールに有効',
  'explain.reason.antiInflammation': '抗炎症特性が良好',
  'explain.reason.lowSaturatedFat': '飽和脂肪が少なく、心血管に優しい',
  'explain.reason.fatBalanced': '脂質バランスが適切',
  'explain.reason.carbsMatch': '炭水化物の比率が目標に合致',
  'explain.reason.fallback': '総合スコアが高く、{{goal}}目標に適しています',

  // ── V6 2.11: 栄養ハイライトタグ ──
  'explain.tag.highProtein': '高タンパク',
  'explain.tag.richFiber': '食物繊維豊富',
  'explain.tag.lowGI': '低GI',
  'explain.tag.naturalFood': '天然食材',
  'explain.tag.highNutrientDensity': '高栄養密度',
  'explain.tag.lowSaturatedFat': '低飽和脂肪',
  'explain.tag.lowSodium': '低ナトリウム',
  'explain.tag.lowFODMAP': '低FODMAP',
  'explain.tag.highCalcium': '高カルシウム',
  'explain.tag.richIron': '鉄分豊富',

  // ── V6 2.11: 健康アドバイス ──
  'explain.health.diabetesLowGI': '低GI食品で血糖管理に適しています',
  'explain.health.hypertensionLowSodium':
    '低ナトリウム食品で血圧コントロールに有効',
  'explain.health.hyperlipidemiaLowChol':
    '低コレステロール食品で血中脂質管理に有効',
  'explain.health.goutLowPurine': '低プリン食品で痛風患者も安心',
  'explain.health.kidneyLowPhosK': '低リン・低カリウムで腎機能に配慮',
  'explain.health.ibsLowFODMAP': '低FODMAP食品で腸への刺激を軽減',
  'explain.health.osteoHighCalcium': '高カルシウム食品で骨の健康をサポート',
  'explain.health.anemiaHighIron': '鉄分豊富で貧血改善に有効',
  'explain.health.fattyLiverLowFat': '低脂肪食品で肝臓の負担を軽減',

  // ── V6 2.11: 不推薦理由 ──
  'explain.whyNot.healthRisk': '健康リスク: {{reasons}}',
  'explain.whyNot.healthVetoed':
    '健康上の制限により、この食品はシステムから除外されました',
  'explain.whyNot.novaPenalty':
    'この食品は加工度が高い（NOVAペナルティ {{penalty}}%）ため、{{goal}}目標に不向きです',
  'explain.whyNot.weakDimensions': '以下の項目で評価が低い: {{dims}}',
  'explain.whyNot.preferenceNoMatch': 'この食品はあなたの食事好みに合いません',
  'explain.whyNot.recentNegative':
    '最近このタイプの食品に対するフィードバックがネガティブです',
  'explain.whyNot.lowScore':
    '総合スコアが低く、現在の{{goal}}目標にはより良い選択肢があります',
  'explain.whyNot.fallback':
    '現在の条件ではこの食品は選出されませんでした。栄養バランスや多様性戦略による可能性があります',

  // ── V6 2.11: 栄養素プログレスバーラベル ──
  'explain.nutrient.calories': 'カロリー',
  'explain.nutrient.protein': 'タンパク質',
  'explain.nutrient.carbs': '炭水化物',
  'explain.nutrient.fat': '脂質',
  'explain.nutrient.fiber': '食物繊維',
};

// ==================== 消息注册表 ====================

const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP,
};

/** 当前默认 locale */
let currentLocale: Locale = 'zh-CN';

/**
 * 设置当前语言（运行时切换）
 */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/**
 * 获取当前语言
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * 获取所有支持的语言列表
 */
export function getSupportedLocales(): Locale[] {
  return Object.keys(messages) as Locale[];
}

/**
 * 检查指定 locale 是否受支持
 */
export function isLocaleSupported(locale: string): locale is Locale {
  return locale in messages;
}

/**
 * 翻译函数 — 获取指定 key 的文案，支持模板变量替换
 *
 * V6 2.10 升级:
 * - 新增第三参数 locale: 指定语言覆盖（不影响全局 currentLocale）
 * - 回退策略: 指定 locale → currentLocale → fallback(zh-CN) → key 本身
 *
 * @param key    文案 key，如 'tip.caloriesOver'
 * @param vars   模板变量，如 { lunchBudget: 800 }
 * @param locale 可选语言覆盖（不改变全局设置）
 * @returns 替换后的文案，key 不存在时返回 key 本身
 */
export function t(
  key: string,
  vars?: Record<string, string | number>,
  locale?: Locale,
): string {
  // 回退链: 指定 locale → 当前 locale → zh-CN fallback
  const resolvedLocale = locale || currentLocale;
  const dict = messages[resolvedLocale];
  let text = dict?.[key];

  // 如果指定 locale 没有该 key，回退到 zh-CN
  if (text === undefined && resolvedLocale !== FALLBACK_LOCALE) {
    text = messages[FALLBACK_LOCALE]?.[key];
  }

  // 最终兜底: 返回 key 本身
  if (text === undefined) {
    text = key;
  }

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }

  return text;
}
