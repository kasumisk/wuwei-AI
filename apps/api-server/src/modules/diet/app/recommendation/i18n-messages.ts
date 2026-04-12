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

  // ════════════════════════════════════════════════════════
  // V6.8 Phase 1-F: 新增消息分组
  // ════════════════════════════════════════════════════════

  // ── health_modifier: 健康修改器原因（28 个） ──
  'health_modifier.diabetes_type2.highGI': '高升糖食物不适合2型糖尿病',
  'health_modifier.diabetes_type2.highSugar': '添加糖含量过高',
  'health_modifier.diabetes_type2.lowFiber': '纤维含量不足，血糖波动风险',
  'health_modifier.hypertension.highSodium': '钠含量偏高，不利于血压控制',
  'health_modifier.hypertension.processed': '加工食品钠含量通常较高',
  'health_modifier.hypertension.pickled': '腌制食品含盐量过高',
  'health_modifier.hyperlipidemia.highCholesterol': '胆固醇含量偏高',
  'health_modifier.hyperlipidemia.highSatFat': '饱和脂肪过多',
  'health_modifier.hyperlipidemia.transFat': '含反式脂肪，不利于血脂',
  'health_modifier.gout.highPurine': '嘌呤含量高，痛风风险',
  'health_modifier.gout.organ': '动物内脏嘌呤含量极高',
  'health_modifier.gout.seafood': '海鲜嘌呤偏高，适量食用',
  'health_modifier.kidney_disease.highProtein': '蛋白质过量加重肾脏负担',
  'health_modifier.kidney_disease.highPotassium': '钾含量偏高',
  'health_modifier.kidney_disease.highPhosphorus': '磷含量偏高',
  'health_modifier.fatty_liver.highFat': '脂肪含量高，加重脂肪肝',
  'health_modifier.fatty_liver.highFructose': '高果糖不利于脂肪肝',
  'health_modifier.fatty_liver.alcohol': '含酒精成分',
  'health_modifier.celiac_disease.gluten': '含麸质成分',
  'health_modifier.celiac_disease.wheat': '含小麦成分',
  'health_modifier.ibs.highFODMAP': '高FODMAP食物可能刺激肠道',
  'health_modifier.ibs.dairy': '乳制品可能加重肠易激症状',
  'health_modifier.ibs.cruciferous': '十字花科蔬菜可能产气',
  'health_modifier.iron_deficiency.enhancer': '富含铁或促进铁吸收',
  'health_modifier.iron_deficiency.inhibitor': '含抑制铁吸收的成分',
  'health_modifier.osteoporosis.highCalcium': '富含钙质，有益骨骼',
  'health_modifier.osteoporosis.vitaminD': '含维生素D，促进钙吸收',
  'health_modifier.osteoporosis.highOxalate': '草酸含量高，影响钙吸收',

  // ── nutrition_highlight: 营养评分高亮（16 个） ──
  'nutrition_highlight.excellentProtein': '优质蛋白含量突出',
  'nutrition_highlight.richOmega3': '富含 Omega-3 脂肪酸',
  'nutrition_highlight.highVitaminC': '维生素C含量丰富',
  'nutrition_highlight.highVitaminA': '维生素A含量丰富',
  'nutrition_highlight.highVitaminD': '维生素D含量丰富',
  'nutrition_highlight.highVitaminE': '维生素E含量丰富',
  'nutrition_highlight.richMinerals': '矿物质含量丰富',
  'nutrition_highlight.antioxidant': '含丰富抗氧化成分',
  'nutrition_highlight.probiotics': '含有益生菌',
  'nutrition_highlight.prebiotics': '含益生元（膳食纤维）',
  'nutrition_highlight.completeAmino': '必需氨基酸组成完整',
  'nutrition_highlight.lowCalorieDense': '低能量密度，适合控制体重',
  'nutrition_highlight.highSatiety': '饱腹感指数高',
  'nutrition_highlight.slowDigest': '消化缓慢，血糖平稳',
  'nutrition_highlight.electrolyte': '含电解质，运动后补充',
  'nutrition_highlight.hydrating': '含水量高，有助补水',

  // ── behavior_notification: 行为通知（9 个） ──
  'behavior_notification.complianceDropping':
    '近期饮食依从性有所下降，建议适当调整目标',
  'behavior_notification.complianceImproving': '饮食依从性持续提升，继续保持！',
  'behavior_notification.calorieOvershoot': '近几天热量持续超标，注意控制份量',
  'behavior_notification.proteinDeficit':
    '蛋白质摄入不足，建议增加优质蛋白食物',
  'behavior_notification.fiberDeficit': '膳食纤维不足，建议多吃蔬菜水果',
  'behavior_notification.skippedMeal': '检测到跳餐行为，规律进食更有利于代谢',
  'behavior_notification.lateNightEating': '近期多次深夜进食，建议调整作息',
  'behavior_notification.diversityLow': '食物多样性偏低，尝试不同品类',
  'behavior_notification.weeklyGoalMet': '本周目标已达成，表现出色！',

  // ── filter_reason: 过滤原因（7 个） ──
  'filter_reason.allergen': '含有过敏原: {{allergen}}',
  'filter_reason.dietary': '不符合饮食限制: {{restriction}}',
  'filter_reason.healthCondition': '因健康状况 {{condition}} 被排除',
  'filter_reason.calorieTooHigh': '热量过高，超出本餐预算',
  'filter_reason.recentlyEaten': '近期已推荐，避免重复',
  'filter_reason.userRejected': '用户近期拒绝了该食物',
  'filter_reason.unavailable': '当前渠道无法获取该食物',

  // ── channel_label: 获取渠道标签（5 个） ──
  'channel_label.home_cook': '在家烹饪',
  'channel_label.restaurant': '餐厅堂食',
  'channel_label.delivery': '外卖配送',
  'channel_label.convenience': '便利店',
  'channel_label.canteen': '食堂',

  // ── cooking_method: 烹饪方式标签（5 个） ──
  'cooking_method.stir_fry': '炒',
  'cooking_method.steam': '蒸',
  'cooking_method.boil': '煮',
  'cooking_method.bake': '烤',
  'cooking_method.raw': '生食/凉拌',

  // ── meal_narrative: 餐食叙事模板（10 个） ──
  'meal_narrative.balanced': '这顿搭配营养均衡，蛋白质、碳水和脂肪比例适宜',
  'meal_narrative.highProtein': '高蛋白搭配，适合{{goal}}阶段的营养需求',
  'meal_narrative.lowCalorie': '低卡路里组合，帮助控制每日热量摄入',
  'meal_narrative.fiberRich': '膳食纤维丰富，有助于消化健康和血糖稳定',
  'meal_narrative.quickPrep': '快手搭配，{{cookTime}}分钟即可完成',
  'meal_narrative.budgetFriendly': '经济实惠的选择，性价比高',
  'meal_narrative.seasonal': '采用应季食材，新鲜营养',
  'meal_narrative.recovery': '运动后恢复餐，蛋白质和碳水兼顾',
  'meal_narrative.lateNight': '深夜轻食，低GI低脂肪，不影响睡眠',
  'meal_narrative.comfort': '暖心搭配，兼顾营养与口感',

  // ── V7.3 P2-G: narrative — 自然语言推荐理由模板（7 个） ──
  'narrative.preference_match': '{{food}}符合你的口味偏好（{{reason}}）',
  'narrative.scene_fit': '{{food}}适合{{scene}}的用餐场景（{{reason}}）',
  'narrative.diversity':
    '为了饮食多样性，减少{{recentCategory}}，推荐尝试{{food}}',
  'narrative.health_benefit': '{{food}}有助于你的健康目标（{{healthBenefit}}）',
  'narrative.seasonal': '{{food}}是当季食材，新鲜营养',
  'narrative.execution_boost': '{{food}}是你容易获取且常吃的食物，执行率高',
  'narrative.nutrition_gap': '你近期{{nutrient}}摄入不足，{{food}}可以帮助补充',

  // ── V7.3 P2-G: nutrient.*.benefit — 营养素健康益处知识模板（11 个） ──
  'nutrient.protein.benefit': '蛋白质有助于肌肉修复和免疫功能',
  'nutrient.fiber.benefit': '膳食纤维促进肠道健康和血糖稳定',
  'nutrient.vitaminA.benefit': '维生素A保护视力和皮肤健康',
  'nutrient.vitaminC.benefit': '维生素C增强免疫力，促进铁吸收',
  'nutrient.vitaminD.benefit': '维生素D促进钙吸收，维护骨骼健康',
  'nutrient.vitaminE.benefit': '维生素E抗氧化，保护细胞免受损伤',
  'nutrient.calcium.benefit': '钙质强健骨骼和牙齿',
  'nutrient.iron.benefit': '铁元素预防贫血，输送氧气到全身',
  'nutrient.potassium.benefit': '钾帮助调节血压和心脏功能',
  'nutrient.zinc.benefit': '锌增强免疫功能和伤口愈合',
  'nutrient.magnesium.benefit': '镁参与肌肉放松和神经传导',

  // ── diversity_tip: 多样性建议（5 个） ──
  'diversity_tip.trySomethingNew': '试试你没吃过的食材吧！',
  'diversity_tip.colorVariety': '尝试不同颜色的蔬果，摄取更多植化素',
  'diversity_tip.proteinRotation': '轮换不同蛋白质来源（鱼、禽、豆、蛋）',
  'diversity_tip.grainVariety': '全谷物搭配精白米面，营养更全面',
  'diversity_tip.cookingMethodSwitch': '换种烹饪方式，同样食材不同风味',

  // ── export_header: CSV 导出表头（25 个） ──
  'export_header.date': '日期',
  'export_header.mealType': '餐次',
  'export_header.foodName': '食物名称',
  'export_header.calories': '热量(kcal)',
  'export_header.protein': '蛋白质(g)',
  'export_header.fat': '脂肪(g)',
  'export_header.carbs': '碳水化合物(g)',
  'export_header.fiber': '膳食纤维(g)',
  'export_header.sodium': '钠(mg)',
  'export_header.sugar': '糖(g)',
  'export_header.cholesterol': '胆固醇(mg)',
  'export_header.vitaminA': '维生素A(μgRAE)',
  'export_header.vitaminC': '维生素C(mg)',
  'export_header.vitaminD': '维生素D(μg)',
  'export_header.calcium': '钙(mg)',
  'export_header.iron': '铁(mg)',
  'export_header.potassium': '钾(mg)',
  'export_header.serving': '份量',
  'export_header.score': '综合评分',
  'export_header.category': '食物分类',
  'export_header.novaClass': 'NOVA分级',
  'export_header.gi': '升糖指数',
  'export_header.goal': '目标类型',
  'export_header.compliance': '达标情况',
  'export_header.feedback': '用户反馈',

  // ── ab_conclusion: A/B 分析结论（7 个） ──
  'ab_conclusion.controlWins': '对照组表现更优，建议保持现有策略',
  'ab_conclusion.treatmentWins': '实验组表现更优，建议推广新策略',
  'ab_conclusion.noSignificance': '差异未达显著水平，建议继续观察',
  'ab_conclusion.sampleTooSmall': '样本量不足，结论不可靠',
  'ab_conclusion.complianceImproved': '实验组依从性显著提升',
  'ab_conclusion.diversityImproved': '实验组食物多样性显著提升',
  'ab_conclusion.satisfactionImproved': '实验组用户满意度更高',

  // ════════════════════════════════════════════════════════
  // V6.8 Phase 2-D: explanation-generator + health-modifier i18n 清理
  // ════════════════════════════════════════════════════════

  // ── explain.synergy: 营养互补配对 ──
  'explain.synergy.label.iron': '铁',
  'explain.synergy.label.vitaminC': '维生素C',
  'explain.synergy.label.calcium': '钙',
  'explain.synergy.label.vitaminD': '维生素D',
  'explain.synergy.label.fat': '脂肪',
  'explain.synergy.label.vitaminA': '维生素A',
  'explain.synergy.label.protein': '蛋白质',
  'explain.synergy.label.vitaminB12': '维生素B12',
  'explain.synergy.iron_vitaminC': '维C帮助铁吸收，提高铁的生物利用率',
  'explain.synergy.calcium_vitaminD': '维D促进钙的肠道吸收',
  'explain.synergy.fat_vitaminA': '脂肪帮助脂溶性维生素A的吸收',
  'explain.synergy.protein_vitaminB12': 'B12参与蛋白质代谢和合成',

  // ── explain.diversity: 多样性建议 ──
  'explain.diversity.ingredientRepeat':
    '部分食材重复，建议替换为不同食材的菜品',
  'explain.diversity.cookingMethodTooMany':
    '{{method}}类菜品较多，建议增加一道{{alternative}}的菜',
  'explain.diversity.cookAlt.stir_fry': '蒸或煮',
  'explain.diversity.cookAlt.deep_fry': '蒸或烤',
  'explain.diversity.cookAlt.default': '其他烹饪方式',
  'explain.diversity.flavorMonotone': '口味较为单一，建议搭配不同风味的菜品',
  'explain.diversity.textureMonotone':
    '菜品质感较为单一，建议搭配不同口感的食物（如脆+软、嫩+弹）',
  'explain.diversity.addVitaminC':
    '建议搭配富含维C的蔬菜水果，帮助铁等矿物质的吸收',

  // ── explain.meal: 餐食叙事 ──
  'explain.meal.mainProtein': '{{name}}提供主要蛋白质',
  'explain.meal.fiberSource': '{{name}}补充膳食纤维和饱腹感',
  'explain.meal.theme.nutrientDensity': '整体搭配注重营养密度',
  'explain.meal.theme.glycemic': '整体搭配兼顾血糖稳定',
  'explain.meal.theme.protein': '整体搭配偏向高蛋白恢复',
  'explain.meal.theme.fiber': '整体搭配强调纤维补充',
  'explain.meal.goalBalance': '这餐围绕{{goal}}目标做了均衡搭配',
  'explain.meal.healthConstraint': '并兼顾你的健康约束',
  'explain.meal.coachingSuffix': '继续按这个方向吃，更容易贴近{{goal}}目标',

  // ── explain.delta: 推荐变化原因 ──
  'explain.delta.postExercise': '今日有运动计划，已为你优化了蛋白质补充',
  'explain.delta.lateNight': '深夜时段，已为你调整为更轻量的选择',
  'explain.delta.weekday': '工作日场景，推荐更方便快手的搭配',
  'explain.delta.nutritionGap':
    '根据近期饮食分析，你的 {{gaps}} 摄入偏少，已优先推荐含量更高的食物',
  'explain.delta.diversityRotation':
    '为保持饮食多样性，今日为你推荐了不同类型的食物组合',
  'explain.delta.strategyRefresh': '推荐系统已根据你的饮食习惯更新了今日方案',

  // ── explain.channel: 渠道过滤解释 ──
  'explain.channel.delivery': '外卖',
  'explain.channel.homeCook': '自己做',
  'explain.channel.canteen': '食堂',
  'explain.channel.convenience': '便利店',
  'explain.channel.restaurant': '餐厅',
  'explain.channel.default': '当前场景',
  'explain.channel.filterNote':
    '基于你当前的{{channel}}场景，已筛除 {{count}} 个不适合的选项',

  // ── health.veto: 一票否决原因 ──
  'health.veto.allergen': '过敏原匹配: {{matched}}',
  'health.veto.transFat': '反式脂肪严重超标: {{amount}}g/100g',
  'health.veto.goutExtremePurine': '痛风: 极高嘌呤 ({{amount}}mg/100g) — 禁用',
  'health.veto.celiacGluten': '乳糜泻: 含麸质 — 禁用',

  // ── health.penalty: 惩罚原因 ──
  'health.penalty.fried': '油炸食品',
  'health.penalty.highSodiumSevere': '高钠: {{amount}}mg/100g (严重超标)',
  'health.penalty.highSodium': '高钠: {{amount}}mg/100g',

  // ── health.goal: 目标惩罚 ──
  'health.goal.fatLossHighSugar': '减脂目标: 高糖 {{amount}}g/100g',
  'health.goal.muscleGainLowProtein': '增肌目标: 蛋白含量极低',

  // ── health.condition: 健康状况惩罚 ──
  'health.condition.diabetesHighGI': '糖尿病: 高GI食物 ({{value}})',
  'health.condition.diabetesMidGI': '糖尿病: 中GI食物 ({{value}})',
  'health.condition.hypertensionSodium': '高血压: 钠含量偏高 ({{amount}}mg)',
  'health.condition.hyperlipidemiaHighSatFat':
    '高血脂: 高饱和脂肪 ({{amount}}g)',
  'health.condition.hyperlipidemiaHighChol': '高血脂: 高胆固醇 ({{amount}}mg)',
  'health.condition.goutHighPurine': '痛风: 高嘌呤 ({{amount}}mg/100g)',
  'health.condition.goutMidPurine': '痛风: 中嘌呤 ({{amount}}mg/100g)',
  'health.condition.kidneyHighPhos': '肾病: 高磷 ({{amount}}mg/100g)',
  'health.condition.kidneyMidPhos': '肾病: 中磷 ({{amount}}mg/100g)',
  'health.condition.kidneyHighK': '肾病: 高钾 ({{amount}}mg/100g)',
  'health.condition.fattyLiverHighSatFat':
    '脂肪肝: 高饱和脂肪 ({{amount}}g/100g)',
  'health.condition.fattyLiverHighSugar': '脂肪肝: 高糖 ({{amount}}g/100g)',
  'health.condition.ibsHighFODMAP': 'IBS: 高FODMAP食物',
  'health.condition.anemiaTeaCoffee': '贫血: 茶/咖啡抑制铁吸收',

  // ── health.bonus: 正向增益 ──
  'health.bonus.hyperlipidemiaOmega3': '高血脂: Omega-3丰富，有益血脂',
  'health.bonus.diabetesLowGI': '糖尿病: 低GI食物 ({{value}})，有益血糖控制',
  'health.bonus.hypertensionHighKLowNa':
    '高血压: 高钾({{potassium}}mg)+低钠({{sodium}}mg)，有益血压',
  'health.bonus.anemiaHighIron': '贫血: 高铁食物 ({{amount}}mg/100g)，有益补铁',
  'health.bonus.osteoHighCalcium':
    '骨质疏松: 高钙食物 ({{amount}}mg/100g)，有益骨骼',

  // ── error: 补充错误消息（6 个） ──
  'error.noFoodsAvailable': '当前条件下没有可推荐的食物',
  'error.targetCalcFailed': '营养目标计算失败，使用默认值',
  'error.profileIncomplete': '画像信息不完整，推荐结果可能不够精准',
  'error.scoringTimeout': '评分计算超时，使用缓存结果',
  'error.redisUnavailable': '缓存服务暂时不可用',
  'error.strategyNotFound': '策略 {{strategyId}} 未找到',

  // ── behavior.prompt: 行为画像 AI prompt 标签 ──
  'behavior.prompt.sectionHeader': '【用户行为画像】',
  'behavior.prompt.preferredFoods': '- 偏好食物：',
  'behavior.prompt.bingePeriods': '- 容易暴食时段：',
  'behavior.prompt.suggestionRate': '- 建议执行率：',
  'behavior.prompt.streakDays': '- 连续达标天数：',
  'behavior.prompt.streakUnit': ' 天',
  'behavior.prompt.separator': '、',

  // ── behavior.notification: 行为主动提醒 ──
  'behavior.notification.snackReminder':
    '你这个时间容易想吃零食，可以提前喝杯水或准备低热量替代',
  'behavior.notification.remainingCalories':
    '剩余 {{remaining}} kcal，注意控制后续饮食',
  'behavior.notification.lunchReminder':
    '别忘了记录午餐，让 AI 帮你规划下午和晚上的饮食',
  'behavior.notification.streakWarning':
    '已连续达标 {{streakDays}} 天，今天差一点就超标了，注意控制！',

  // ── nutrition.highlight: 营养评分高亮 ──
  'nutrition.highlight.caloriesOver': '⚠️ 热量超标 {{percent}}%',
  'nutrition.highlight.caloriesUnder': '⚠️ 热量不足 {{percent}}%',
  'nutrition.highlight.caloriesGood': '✅ 热量达标',
  'nutrition.highlight.proteinLow': '⚠️ 蛋白质不足 {{percent}}%',
  'nutrition.highlight.proteinHigh': '⚠️ 蛋白质超标 {{percent}}%',
  'nutrition.highlight.proteinGood': '✅ 蛋白质达标',
  'nutrition.highlight.fatHigh': '⚠️ 脂肪超标 {{percent}}%',
  'nutrition.highlight.fatLow': '⚠️ 脂肪不足 {{percent}}%',
  'nutrition.highlight.fatGood': '✅ 脂肪达标',
  'nutrition.highlight.carbsHigh': '⚠️ 碳水超标 {{percent}}%',
  'nutrition.highlight.carbsLow': '⚠️ 碳水不足 {{percent}}%',
  'nutrition.highlight.carbsGood': '✅ 碳水达标',
  'nutrition.highlight.fiberLow': '⚠️ 膳食纤维不足 {{percent}}%',
  'nutrition.highlight.fiberGood': '✅ 膳食纤维达标',
  'nutrition.highlight.sodiumHigh': '⚠️ 钠超标 {{percent}}%',
  'nutrition.highlight.sodiumGood': '✅ 钠达标',

  // ── nutrition.feedback: 营养评分反馈 ──
  'nutrition.feedback.allGood': '今日饮食各项达标，继续保持！',
  'nutrition.feedback.caloriesTip': '热量{{direction}}，建议调整食物份量',
  'nutrition.feedback.proteinTip': '蛋白质{{direction}}，建议调整蛋白质来源',
  'nutrition.feedback.fatTip': '脂肪{{direction}}，建议调整油脂摄入',
  'nutrition.feedback.carbsTip': '碳水{{direction}}，建议调整主食份量',
  'nutrition.feedback.separator': '；',

  // ── food.suggestion: 食物建议 ──
  'food.suggestion.caloriesReached': '今日热量已达标',
  'food.suggestion.noMoreFood': '建议不再进食，喝水或零卡饮品',

  // ── export.section: CSV section headers ──
  'export.section.foodRecords': '# 饮食记录 (Food Records)\n',
  'export.section.dailySummaries': '# 每日汇总 (Daily Summaries)\n',
  'export.section.separator': '\n',

  // ── export.record_header: food_records CSV 表头 ──
  'export.record_header.date': '日期',
  'export.record_header.mealType': '餐次',
  'export.record_header.food': '食物',
  'export.record_header.totalCalories': '总热量(kcal)',
  'export.record_header.protein': '蛋白质(g)',
  'export.record_header.fat': '脂肪(g)',
  'export.record_header.carbs': '碳水(g)',
  'export.record_header.fiber': '膳食纤维(g)',
  'export.record_header.sodium': '钠(mg)',
  'export.record_header.quantity': '份量',
  'export.record_header.unit': '单位',
  'export.record_header.source': '来源',

  // ── export.summary_header: daily_summaries CSV 表头 ──
  'export.summary_header.date': '日期',
  'export.summary_header.totalCalories': '总热量(kcal)',
  'export.summary_header.caloriesTarget': '热量目标(kcal)',
  'export.summary_header.caloriesPercent': '热量达成(%)',
  'export.summary_header.protein': '蛋白质(g)',
  'export.summary_header.proteinTarget': '蛋白质目标(g)',
  'export.summary_header.fat': '脂肪(g)',
  'export.summary_header.fatTarget': '脂肪目标(g)',
  'export.summary_header.carbs': '碳水(g)',
  'export.summary_header.carbsTarget': '碳水目标(g)',
  'export.summary_header.fiber': '膳食纤维(g)',
  'export.summary_header.sodium': '钠(mg)',
  'export.summary_header.score': '评分',

  // ── export.fallback ──
  'export.fallback.unknown': '未知',

  // ── ab.analysis: A/B 测试分析结论 ──
  'ab.analysis.insufficientGroups':
    '数据不足：需要至少 2 个分组的反馈数据才能进行分析',
  'ab.analysis.noControl':
    '无法分析：未找到 control 组（组名需包含 "control"）',
  'ab.analysis.insufficientSample':
    '样本量不足：部分组用户数 < {{minSample}}，建议继续收集数据',
  'ab.analysis.controlWins':
    'Control 组 "{{controlGroup}}" 表现更优，建议保持现有策略',
  'ab.analysis.noSignificantDiff':
    '各组之间无统计显著差异，建议保持 control 策略或调整实验参数',
  'ab.analysis.singleWinner':
    '实验组 "{{winner}}" 显著优于 control，接受率提升 {{lift}}%，建议采用',
  'ab.analysis.multipleWinners':
    '多个实验组优于 control，"{{winner}}" 提升最大 ({{lift}}%)，建议采用',

  // ── meal.recipe: 菜谱相关 ──
  'meal.recipe.categoryFallback': '菜谱',
  'meal.recipe.servings': '{{servings}}人份',
  'meal.recipe.vegetable': '蔬菜',

  // ── composition.pair: 营养对标签 ──
  'composition.pair.ironVitC': '铁+维C→铁吸收增强',
  'composition.pair.calciumVitD': '钙+维D→钙吸收增强',
  'composition.pair.fatVitA': '脂肪+维A→脂溶性维生素吸收',
  'composition.pair.proteinB12': '蛋白质+B12→蛋白质合成',
  'composition.pair.calciumOxalate': '钙+草酸→钙吸收降低',
  'composition.pair.ironCalcium': '高铁+高钙→铁吸收竞争',
  'composition.pair.zincPhytate': '锌+植酸→锌吸收降低',

  // ════════════════════════════════════════════════════════
  // V6.9 Phase 1-F: 场景/菜谱/可解释性消息
  // ════════════════════════════════════════════════════════

  // ── scene.label: 12种场景标签 ──
  'scene.label.quick_breakfast': '快手早餐',
  'scene.label.leisurely_brunch': '悠闲早午餐',
  'scene.label.office_lunch': '工作日午餐',
  'scene.label.home_cooking': '家常菜',
  'scene.label.eating_out': '外出用餐',
  'scene.label.convenience_meal': '便捷餐',
  'scene.label.canteen_meal': '食堂推荐',
  'scene.label.post_workout': '运动后加餐',
  'scene.label.late_night_snack': '夜宵',
  'scene.label.family_dinner': '家庭晚餐',
  'scene.label.meal_prep': '备餐计划',
  'scene.label.general': '均衡搭配',

  // ── scene.tip: 场景化推荐提示 ──
  'scene.tip.quick_breakfast': '早晨时间紧，推荐简单快手的高蛋白早餐',
  'scene.tip.leisurely_brunch': '周末悠闲时光，享受一顿丰盛的早午餐',
  'scene.tip.office_lunch': '工作日午餐，兼顾营养和便捷性',
  'scene.tip.home_cooking': '在家动手做，营养又实惠',
  'scene.tip.eating_out': '外出用餐，注意选择健康菜品',
  'scene.tip.convenience_meal': '便利店选择，快捷不将就',
  'scene.tip.canteen_meal': '食堂打饭，荤素搭配好',
  'scene.tip.post_workout': '运动后及时补充蛋白质和碳水',
  'scene.tip.late_night_snack': '夜宵控量，选择清淡易消化的',
  'scene.tip.family_dinner': '家庭聚餐，兼顾全家口味',
  'scene.tip.meal_prep': '提前备餐，一次准备多餐享用',
  'scene.tip.general': '均衡搭配，满足每日营养需求',

  // ── scene.realism: 场景现实性说明 ──
  'scene.realism.strict': '严格模式：仅推荐该场景下最容易获取的食物',
  'scene.realism.normal': '标准模式：平衡推荐多样性与可获得性',
  'scene.realism.relaxed': '宽松模式：扩大推荐范围，探索更多可能',

  // ── recipe.theme: 菜谱方案主题 ──
  'recipe.theme.prefix': '{{sceneLabel}} · {{mealLabel}}方案',
  'recipe.theme.fallback': '今日推荐方案',

  // ── recipe.assembled: 组装菜谱消息 ──
  'recipe.assembled.matched': '为你匹配了 {{count}} 道菜谱',
  'recipe.assembled.smart': '为你智能搭配了 {{count}} 道菜',
  'recipe.assembled.difficulty.easy': '简单',
  'recipe.assembled.difficulty.medium': '中等',
  'recipe.assembled.difficulty.hard': '较难',
  'recipe.assembled.cookTime': '预计烹饪时间 {{minutes}} 分钟',
  'recipe.assembled.ingredients': '共需 {{count}} 种食材',

  // ── recipe.role: 菜谱中食物角色 ──
  'recipe.role.main': '主菜',
  'recipe.role.side': '配菜',
  'recipe.role.staple': '主食',
  'recipe.role.soup': '汤品',
  'recipe.role.dessert': '甜点',

  // ── availability: 可获得性相关 ──
  'availability.channel.HOME_COOK': '自己做',
  'availability.channel.RESTAURANT': '餐厅',
  'availability.channel.DELIVERY': '外卖',
  'availability.channel.CONVENIENCE': '便利店',
  'availability.channel.CANTEEN': '食堂',
  'availability.channel.UNKNOWN': '未知',
  'availability.score.high': '容易获取',
  'availability.score.medium': '可以获取',
  'availability.score.low': '较难获取',

  // ── insight: 结构化可解释性洞察（Phase 2-B 使用的 key 预注册） ──
  'insight.protein_contribution.title': '蛋白质贡献',
  'insight.protein_contribution.content':
    '{{foodName}} 提供 {{protein}}g 蛋白质，占本餐目标的 {{ratio}}%',
  'insight.calorie_match.title': '热量匹配度',
  'insight.calorie_match.excellent':
    '本餐热量与目标高度匹配（偏差 {{deviation}}%）',
  'insight.calorie_match.moderate':
    '本餐热量与目标基本匹配（偏差 {{deviation}}%）',
  'insight.scene_match.title': '场景适配',
  'insight.scene_match.quick_breakfast': '适合快节奏早餐，准备时间短',
  'insight.scene_match.leisurely_brunch': '适合周末慢享的早午餐',
  'insight.scene_match.office_lunch': '适合办公室午餐，方便获取',
  'insight.scene_match.home_cooking': '适合在家烹饪，食材常见',
  'insight.scene_match.eating_out': '适合外出就餐时点选',
  'insight.scene_match.convenience_meal': '便利店即可买到',
  'insight.scene_match.canteen_meal': '食堂常见菜品',
  'insight.scene_match.post_workout': '运动后快速补充能量',
  'insight.scene_match.late_night_snack': '清淡不加重肠胃负担',
  'insight.scene_match.family_dinner': '全家老少都能接受',
  'insight.scene_match.meal_prep': '适合批量备餐，保存性好',
  'insight.scene_match.general': '多场景通用的健康选择',
  'insight.new_category.title': '新品类探索',
  'insight.new_category.content':
    '{{foodName}} 属于"{{category}}"类，是你近期较少尝试的品类',
  'insight.diversity.title': '多样性加分',
  'insight.diversity.content':
    '本餐推荐覆盖 {{categoryCount}} 个品类，营养来源更全面',
  'insight.execution.title': '执行难度评估',
  'insight.execution.easy': '本餐方案简单易做，预计 {{minutes}} 分钟完成',
  'insight.execution.medium': '本餐方案难度适中，需要一定烹饪基础',
  'insight.execution.hard': '本餐方案较复杂，建议有空时尝试',

  // ── explain.dim: 新增维度标签（V6.9 扩展） ──
  'explain.dim.popularity': '流行度',
  'explain.dim.executability': '可执行性',
  'explain.dim.diversity': '多样性',
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

  // ════════════════════════════════════════════════════════
  // V6.8 Phase 1-F: New message groups (English)
  // ════════════════════════════════════════════════════════

  // ── health_modifier ──
  'health_modifier.diabetes_type2.highGI':
    'High glycemic food not suitable for type 2 diabetes',
  'health_modifier.diabetes_type2.highSugar': 'Added sugar content too high',
  'health_modifier.diabetes_type2.lowFiber':
    'Low fiber, blood sugar fluctuation risk',
  'health_modifier.hypertension.highSodium':
    'High sodium, unfavorable for blood pressure',
  'health_modifier.hypertension.processed':
    'Processed foods typically high in sodium',
  'health_modifier.hypertension.pickled': 'Pickled foods are too salty',
  'health_modifier.hyperlipidemia.highCholesterol': 'High cholesterol content',
  'health_modifier.hyperlipidemia.highSatFat': 'Too much saturated fat',
  'health_modifier.hyperlipidemia.transFat':
    'Contains trans fat, unfavorable for blood lipids',
  'health_modifier.gout.highPurine': 'High purine content, gout risk',
  'health_modifier.gout.organ': 'Organ meats are extremely high in purine',
  'health_modifier.gout.seafood': 'Seafood is moderately high in purine',
  'health_modifier.kidney_disease.highProtein':
    'Excess protein burdens the kidneys',
  'health_modifier.kidney_disease.highPotassium': 'Potassium content is high',
  'health_modifier.kidney_disease.highPhosphorus': 'Phosphorus content is high',
  'health_modifier.fatty_liver.highFat': 'High fat worsens fatty liver',
  'health_modifier.fatty_liver.highFructose':
    'High fructose unfavorable for fatty liver',
  'health_modifier.fatty_liver.alcohol': 'Contains alcohol',
  'health_modifier.celiac_disease.gluten': 'Contains gluten',
  'health_modifier.celiac_disease.wheat': 'Contains wheat',
  'health_modifier.ibs.highFODMAP': 'High FODMAP may irritate the gut',
  'health_modifier.ibs.dairy': 'Dairy may worsen IBS symptoms',
  'health_modifier.ibs.cruciferous': 'Cruciferous vegetables may cause gas',
  'health_modifier.iron_deficiency.enhancer':
    'Rich in iron or enhances absorption',
  'health_modifier.iron_deficiency.inhibitor':
    'Contains iron absorption inhibitors',
  'health_modifier.osteoporosis.highCalcium': 'Rich in calcium, good for bones',
  'health_modifier.osteoporosis.vitaminD':
    'Contains vitamin D, aids calcium absorption',
  'health_modifier.osteoporosis.highOxalate':
    'High oxalate, may inhibit calcium absorption',

  // ── nutrition_highlight ──
  'nutrition_highlight.excellentProtein': 'Excellent protein content',
  'nutrition_highlight.richOmega3': 'Rich in Omega-3 fatty acids',
  'nutrition_highlight.highVitaminC': 'High in Vitamin C',
  'nutrition_highlight.highVitaminA': 'High in Vitamin A',
  'nutrition_highlight.highVitaminD': 'High in Vitamin D',
  'nutrition_highlight.highVitaminE': 'High in Vitamin E',
  'nutrition_highlight.richMinerals': 'Rich in minerals',
  'nutrition_highlight.antioxidant': 'Rich in antioxidants',
  'nutrition_highlight.probiotics': 'Contains probiotics',
  'nutrition_highlight.prebiotics': 'Contains prebiotics (dietary fiber)',
  'nutrition_highlight.completeAmino': 'Complete essential amino acid profile',
  'nutrition_highlight.lowCalorieDense':
    'Low energy density, good for weight control',
  'nutrition_highlight.highSatiety': 'High satiety index',
  'nutrition_highlight.slowDigest': 'Slow digesting, stable blood sugar',
  'nutrition_highlight.electrolyte': 'Contains electrolytes for post-workout',
  'nutrition_highlight.hydrating': 'High water content, aids hydration',

  // ── behavior_notification ──
  'behavior_notification.complianceDropping':
    'Diet compliance has been declining recently',
  'behavior_notification.complianceImproving':
    'Diet compliance is improving, keep it up!',
  'behavior_notification.calorieOvershoot':
    'Calories have been over target recently',
  'behavior_notification.proteinDeficit': 'Protein intake is insufficient',
  'behavior_notification.fiberDeficit': 'Dietary fiber is insufficient',
  'behavior_notification.skippedMeal':
    'Meal skipping detected, regular eating aids metabolism',
  'behavior_notification.lateNightEating':
    'Frequent late-night eating detected',
  'behavior_notification.diversityLow':
    'Food diversity is low, try different categories',
  'behavior_notification.weeklyGoalMet': 'Weekly goal achieved, great job!',

  // ── filter_reason ──
  'filter_reason.allergen': 'Contains allergen: {{allergen}}',
  'filter_reason.dietary': 'Does not meet dietary restriction: {{restriction}}',
  'filter_reason.healthCondition':
    'Excluded due to health condition: {{condition}}',
  'filter_reason.calorieTooHigh': 'Calories too high for this meal budget',
  'filter_reason.recentlyEaten': 'Recently recommended, avoiding repetition',
  'filter_reason.userRejected': 'User recently rejected this food',
  'filter_reason.unavailable': 'Not available through current channel',

  // ── channel_label ──
  'channel_label.home_cook': 'Home Cook',
  'channel_label.restaurant': 'Restaurant',
  'channel_label.delivery': 'Delivery',
  'channel_label.convenience': 'Convenience Store',
  'channel_label.canteen': 'Canteen',

  // ── cooking_method ──
  'cooking_method.stir_fry': 'Stir-fry',
  'cooking_method.steam': 'Steam',
  'cooking_method.boil': 'Boil',
  'cooking_method.bake': 'Bake',
  'cooking_method.raw': 'Raw/Salad',

  // ── meal_narrative ──
  'meal_narrative.balanced':
    'This meal is nutritionally balanced with appropriate macros',
  'meal_narrative.highProtein':
    'High-protein combo, great for your {{goal}} phase',
  'meal_narrative.lowCalorie':
    'Low-calorie combination, helps control daily intake',
  'meal_narrative.fiberRich':
    'Fiber-rich meal, aids digestion and blood sugar stability',
  'meal_narrative.quickPrep': 'Quick meal, ready in {{cookTime}} minutes',
  'meal_narrative.budgetFriendly': 'Budget-friendly choice with great value',
  'meal_narrative.seasonal':
    'Features seasonal ingredients, fresh and nutritious',
  'meal_narrative.recovery':
    'Post-workout recovery meal, balancing protein and carbs',
  'meal_narrative.lateNight': 'Light late-night meal, low GI and low fat',
  'meal_narrative.comfort': 'Comfort meal, balancing nutrition and taste',

  // ── V7.3 P2-G: narrative — NL recommendation reason templates ──
  'narrative.preference_match':
    '{{food}} matches your taste preferences ({{reason}})',
  'narrative.scene_fit':
    '{{food}} suits your {{scene}} dining scenario ({{reason}})',
  'narrative.diversity':
    'For dietary variety, less {{recentCategory}}, try {{food}} instead',
  'narrative.health_benefit':
    '{{food}} supports your health goals ({{healthBenefit}})',
  'narrative.seasonal': '{{food}} is in season — fresh and nutritious',
  'narrative.execution_boost':
    '{{food}} is easy to access and you eat it often — high adherence',
  'narrative.nutrition_gap':
    'Your recent {{nutrient}} intake is low; {{food}} can help supplement it',

  // ── V7.3 P2-G: nutrient.*.benefit — nutrient health benefit templates ──
  'nutrient.protein.benefit':
    'Protein supports muscle repair and immune function',
  'nutrient.fiber.benefit':
    'Dietary fiber promotes gut health and blood sugar stability',
  'nutrient.vitaminA.benefit': 'Vitamin A protects vision and skin health',
  'nutrient.vitaminC.benefit': 'Vitamin C boosts immunity and iron absorption',
  'nutrient.vitaminD.benefit':
    'Vitamin D promotes calcium absorption and bone health',
  'nutrient.vitaminE.benefit':
    'Vitamin E is an antioxidant that protects cells',
  'nutrient.calcium.benefit': 'Calcium strengthens bones and teeth',
  'nutrient.iron.benefit':
    'Iron prevents anemia and carries oxygen throughout the body',
  'nutrient.potassium.benefit':
    'Potassium helps regulate blood pressure and heart function',
  'nutrient.zinc.benefit': 'Zinc boosts immune function and wound healing',
  'nutrient.magnesium.benefit':
    'Magnesium supports muscle relaxation and nerve function',

  // ── diversity_tip ──
  'diversity_tip.trySomethingNew': "Try ingredients you haven't had before!",
  'diversity_tip.colorVariety': 'Eat a rainbow of fruits and vegetables',
  'diversity_tip.proteinRotation':
    'Rotate protein sources (fish, poultry, beans, eggs)',
  'diversity_tip.grainVariety': 'Mix whole grains with refined grains',
  'diversity_tip.cookingMethodSwitch':
    'Try a different cooking method for variety',

  // ── export_header ──
  'export_header.date': 'Date',
  'export_header.mealType': 'Meal Type',
  'export_header.foodName': 'Food Name',
  'export_header.calories': 'Calories(kcal)',
  'export_header.protein': 'Protein(g)',
  'export_header.fat': 'Fat(g)',
  'export_header.carbs': 'Carbohydrates(g)',
  'export_header.fiber': 'Dietary Fiber(g)',
  'export_header.sodium': 'Sodium(mg)',
  'export_header.sugar': 'Sugar(g)',
  'export_header.cholesterol': 'Cholesterol(mg)',
  'export_header.vitaminA': 'Vitamin A(μgRAE)',
  'export_header.vitaminC': 'Vitamin C(mg)',
  'export_header.vitaminD': 'Vitamin D(μg)',
  'export_header.calcium': 'Calcium(mg)',
  'export_header.iron': 'Iron(mg)',
  'export_header.potassium': 'Potassium(mg)',
  'export_header.serving': 'Serving',
  'export_header.score': 'Overall Score',
  'export_header.category': 'Category',
  'export_header.novaClass': 'NOVA Class',
  'export_header.gi': 'Glycemic Index',
  'export_header.goal': 'Goal Type',
  'export_header.compliance': 'Compliance',
  'export_header.feedback': 'User Feedback',

  // ── ab_conclusion ──
  'ab_conclusion.controlWins':
    'Control group performed better, keep current strategy',
  'ab_conclusion.treatmentWins':
    'Treatment group performed better, recommend rollout',
  'ab_conclusion.noSignificance':
    'No significant difference, continue observation',
  'ab_conclusion.sampleTooSmall':
    'Sample size too small, conclusion unreliable',
  'ab_conclusion.complianceImproved':
    'Treatment group compliance significantly improved',
  'ab_conclusion.diversityImproved':
    'Treatment group food diversity significantly improved',
  'ab_conclusion.satisfactionImproved':
    'Treatment group user satisfaction higher',

  // ════════════════════════════════════════════════════════
  // V6.8 Phase 2-D: explanation-generator + health-modifier i18n (English)
  // ════════════════════════════════════════════════════════

  // ── explain.synergy ──
  'explain.synergy.label.iron': 'Iron',
  'explain.synergy.label.vitaminC': 'Vitamin C',
  'explain.synergy.label.calcium': 'Calcium',
  'explain.synergy.label.vitaminD': 'Vitamin D',
  'explain.synergy.label.fat': 'Fat',
  'explain.synergy.label.vitaminA': 'Vitamin A',
  'explain.synergy.label.protein': 'Protein',
  'explain.synergy.label.vitaminB12': 'Vitamin B12',
  'explain.synergy.iron_vitaminC':
    'Vitamin C enhances iron absorption and bioavailability',
  'explain.synergy.calcium_vitaminD':
    'Vitamin D promotes intestinal calcium absorption',
  'explain.synergy.fat_vitaminA':
    'Dietary fat aids absorption of fat-soluble vitamin A',
  'explain.synergy.protein_vitaminB12':
    'B12 participates in protein metabolism and synthesis',

  // ── explain.diversity ──
  'explain.diversity.ingredientRepeat':
    'Some ingredients repeat, consider swapping for different items',
  'explain.diversity.cookingMethodTooMany':
    'Too many {{method}} dishes, try adding a {{alternative}} dish',
  'explain.diversity.cookAlt.stir_fry': 'steamed or boiled',
  'explain.diversity.cookAlt.deep_fry': 'steamed or baked',
  'explain.diversity.cookAlt.default': 'other cooking methods',
  'explain.diversity.flavorMonotone':
    'Flavors are monotonous, try pairing different tastes',
  'explain.diversity.textureMonotone':
    'Textures are monotonous, try pairing different textures (crispy+soft, tender+chewy)',
  'explain.diversity.addVitaminC':
    'Add vitamin C-rich fruits/veggies to boost mineral absorption',

  // ── explain.meal ──
  'explain.meal.mainProtein': '{{name}} provides the main protein',
  'explain.meal.fiberSource': '{{name}} contributes dietary fiber and satiety',
  'explain.meal.theme.nutrientDensity':
    'Overall combo focuses on nutrient density',
  'explain.meal.theme.glycemic':
    'Overall combo considers blood sugar stability',
  'explain.meal.theme.protein':
    'Overall combo leans toward high-protein recovery',
  'explain.meal.theme.fiber': 'Overall combo emphasizes fiber intake',
  'explain.meal.goalBalance': 'This meal is balanced around your {{goal}} goal',
  'explain.meal.healthConstraint': 'while respecting your health constraints',
  'explain.meal.coachingSuffix':
    'Keep eating this way to get closer to your {{goal}} goal',

  // ── explain.delta ──
  'explain.delta.postExercise':
    'You have an exercise plan today, protein replenishment has been optimized',
  'explain.delta.lateNight':
    'Late-night window, lighter options have been selected',
  'explain.delta.weekday':
    'Weekday scenario, quick and convenient combos recommended',
  'explain.delta.nutritionGap':
    'Based on recent diet analysis, your {{gaps}} intake is low, higher-content foods are prioritized',
  'explain.delta.diversityRotation':
    'To maintain dietary diversity, different food types are recommended today',
  'explain.delta.strategyRefresh':
    'Recommendations have been updated based on your eating habits',

  // ── explain.channel ──
  'explain.channel.delivery': 'Delivery',
  'explain.channel.homeCook': 'Home Cook',
  'explain.channel.canteen': 'Canteen',
  'explain.channel.convenience': 'Convenience Store',
  'explain.channel.restaurant': 'Restaurant',
  'explain.channel.default': 'Current scenario',
  'explain.channel.filterNote':
    'Based on your {{channel}} scenario, {{count}} unsuitable options were filtered out',

  // ── health.veto ──
  'health.veto.allergen': 'Allergen match: {{matched}}',
  'health.veto.transFat': 'Trans fat critically high: {{amount}}g/100g',
  'health.veto.goutExtremePurine':
    'Gout: extremely high purine ({{amount}}mg/100g) — prohibited',
  'health.veto.celiacGluten': 'Celiac disease: contains gluten — prohibited',

  // ── health.penalty ──
  'health.penalty.fried': 'Deep-fried food',
  'health.penalty.highSodiumSevere':
    'High sodium: {{amount}}mg/100g (critically high)',
  'health.penalty.highSodium': 'High sodium: {{amount}}mg/100g',

  // ── health.goal ──
  'health.goal.fatLossHighSugar': 'Fat loss goal: high sugar {{amount}}g/100g',
  'health.goal.muscleGainLowProtein': 'Muscle gain goal: extremely low protein',

  // ── health.condition ──
  'health.condition.diabetesHighGI': 'Diabetes: high GI food ({{value}})',
  'health.condition.diabetesMidGI': 'Diabetes: medium GI food ({{value}})',
  'health.condition.hypertensionSodium':
    'Hypertension: sodium is high ({{amount}}mg)',
  'health.condition.hyperlipidemiaHighSatFat':
    'Hyperlipidemia: high saturated fat ({{amount}}g)',
  'health.condition.hyperlipidemiaHighChol':
    'Hyperlipidemia: high cholesterol ({{amount}}mg)',
  'health.condition.goutHighPurine': 'Gout: high purine ({{amount}}mg/100g)',
  'health.condition.goutMidPurine': 'Gout: medium purine ({{amount}}mg/100g)',
  'health.condition.kidneyHighPhos':
    'Kidney disease: high phosphorus ({{amount}}mg/100g)',
  'health.condition.kidneyMidPhos':
    'Kidney disease: medium phosphorus ({{amount}}mg/100g)',
  'health.condition.kidneyHighK':
    'Kidney disease: high potassium ({{amount}}mg/100g)',
  'health.condition.fattyLiverHighSatFat':
    'Fatty liver: high saturated fat ({{amount}}g/100g)',
  'health.condition.fattyLiverHighSugar':
    'Fatty liver: high sugar ({{amount}}g/100g)',
  'health.condition.ibsHighFODMAP': 'IBS: high FODMAP food',
  'health.condition.anemiaTeaCoffee':
    'Anemia: tea/coffee inhibits iron absorption',

  // ── health.bonus ──
  'health.bonus.hyperlipidemiaOmega3':
    'Hyperlipidemia: rich in Omega-3, beneficial for blood lipids',
  'health.bonus.diabetesLowGI':
    'Diabetes: low GI food ({{value}}), beneficial for blood sugar control',
  'health.bonus.hypertensionHighKLowNa':
    'Hypertension: high potassium({{potassium}}mg)+low sodium({{sodium}}mg), good for BP',
  'health.bonus.anemiaHighIron':
    'Anemia: iron-rich food ({{amount}}mg/100g), beneficial for iron intake',
  'health.bonus.osteoHighCalcium':
    'Osteoporosis: calcium-rich food ({{amount}}mg/100g), beneficial for bones',

  // ── error (additional) ──
  'error.noFoodsAvailable': 'No foods available under current conditions',
  'error.targetCalcFailed':
    'Nutrition target calculation failed, using defaults',
  'error.profileIncomplete':
    'Profile incomplete, recommendations may be less precise',
  'error.scoringTimeout': 'Scoring timed out, using cached results',
  'error.redisUnavailable': 'Cache service temporarily unavailable',
  'error.strategyNotFound': 'Strategy {{strategyId}} not found',

  // ── behavior.prompt ──
  'behavior.prompt.sectionHeader': '[User Behavior Profile]',
  'behavior.prompt.preferredFoods': '- Preferred foods: ',
  'behavior.prompt.bingePeriods': '- Binge-prone periods: ',
  'behavior.prompt.suggestionRate': '- Suggestion compliance rate: ',
  'behavior.prompt.streakDays': '- Consecutive on-target days: ',
  'behavior.prompt.streakUnit': ' days',
  'behavior.prompt.separator': ', ',

  // ── behavior.notification ──
  'behavior.notification.snackReminder':
    'You tend to crave snacks at this time. Try drinking water or preparing low-calorie alternatives.',
  'behavior.notification.remainingCalories':
    '{{remaining}} kcal remaining, watch your intake for the rest of the day',
  'behavior.notification.lunchReminder':
    "Don't forget to log lunch so AI can help plan your afternoon and evening meals",
  'behavior.notification.streakWarning':
    "{{streakDays}}-day streak! You're close to going over today — stay mindful!",

  // ── nutrition.highlight ──
  'nutrition.highlight.caloriesOver': '⚠️ Calories over by {{percent}}%',
  'nutrition.highlight.caloriesUnder': '⚠️ Calories under by {{percent}}%',
  'nutrition.highlight.caloriesGood': '✅ Calories on target',
  'nutrition.highlight.proteinLow': '⚠️ Protein low by {{percent}}%',
  'nutrition.highlight.proteinHigh': '⚠️ Protein over by {{percent}}%',
  'nutrition.highlight.proteinGood': '✅ Protein on target',
  'nutrition.highlight.fatHigh': '⚠️ Fat over by {{percent}}%',
  'nutrition.highlight.fatLow': '⚠️ Fat low by {{percent}}%',
  'nutrition.highlight.fatGood': '✅ Fat on target',
  'nutrition.highlight.carbsHigh': '⚠️ Carbs over by {{percent}}%',
  'nutrition.highlight.carbsLow': '⚠️ Carbs low by {{percent}}%',
  'nutrition.highlight.carbsGood': '✅ Carbs on target',
  'nutrition.highlight.fiberLow': '⚠️ Fiber low by {{percent}}%',
  'nutrition.highlight.fiberGood': '✅ Fiber on target',
  'nutrition.highlight.sodiumHigh': '⚠️ Sodium over by {{percent}}%',
  'nutrition.highlight.sodiumGood': '✅ Sodium on target',

  // ── nutrition.feedback ──
  'nutrition.feedback.allGood': 'All nutrition targets met today, keep it up!',
  'nutrition.feedback.caloriesTip':
    'Calories {{direction}}, consider adjusting portion sizes',
  'nutrition.feedback.proteinTip':
    'Protein {{direction}}, consider adjusting protein sources',
  'nutrition.feedback.fatTip':
    'Fat {{direction}}, consider adjusting oil/fat intake',
  'nutrition.feedback.carbsTip':
    'Carbs {{direction}}, consider adjusting staple portions',
  'nutrition.feedback.separator': '; ',

  // ── food.suggestion ──
  'food.suggestion.caloriesReached': 'Daily calorie target reached',
  'food.suggestion.noMoreFood':
    'Recommend no more food — try water or zero-calorie drinks',

  // ── export.section ──
  'export.section.foodRecords': '# Food Records\n',
  'export.section.dailySummaries': '# Daily Summaries\n',
  'export.section.separator': '\n',

  // ── export.record_header ──
  'export.record_header.date': 'Date',
  'export.record_header.mealType': 'Meal',
  'export.record_header.food': 'Food',
  'export.record_header.totalCalories': 'Calories(kcal)',
  'export.record_header.protein': 'Protein(g)',
  'export.record_header.fat': 'Fat(g)',
  'export.record_header.carbs': 'Carbs(g)',
  'export.record_header.fiber': 'Fiber(g)',
  'export.record_header.sodium': 'Sodium(mg)',
  'export.record_header.quantity': 'Quantity',
  'export.record_header.unit': 'Unit',
  'export.record_header.source': 'Source',

  // ── export.summary_header ──
  'export.summary_header.date': 'Date',
  'export.summary_header.totalCalories': 'Calories(kcal)',
  'export.summary_header.caloriesTarget': 'Calorie Target(kcal)',
  'export.summary_header.caloriesPercent': 'Calorie %',
  'export.summary_header.protein': 'Protein(g)',
  'export.summary_header.proteinTarget': 'Protein Target(g)',
  'export.summary_header.fat': 'Fat(g)',
  'export.summary_header.fatTarget': 'Fat Target(g)',
  'export.summary_header.carbs': 'Carbs(g)',
  'export.summary_header.carbsTarget': 'Carbs Target(g)',
  'export.summary_header.fiber': 'Fiber(g)',
  'export.summary_header.sodium': 'Sodium(mg)',
  'export.summary_header.score': 'Score',

  // ── export.fallback ──
  'export.fallback.unknown': 'Unknown',

  // ── ab.analysis ──
  'ab.analysis.insufficientGroups':
    'Insufficient data: at least 2 groups with feedback are required',
  'ab.analysis.noControl':
    'Cannot analyze: no control group found (group name must contain "control")',
  'ab.analysis.insufficientSample':
    'Insufficient sample: some groups have < {{minSample}} users, continue collecting data',
  'ab.analysis.controlWins':
    'Control group "{{controlGroup}}" performs better, recommend keeping current strategy',
  'ab.analysis.noSignificantDiff':
    'No significant difference between groups, recommend keeping control strategy or adjusting experiment',
  'ab.analysis.singleWinner':
    'Experiment group "{{winner}}" significantly outperforms control, acceptance rate +{{lift}}%, recommend adopting',
  'ab.analysis.multipleWinners':
    'Multiple groups outperform control, "{{winner}}" has largest improvement ({{lift}}%), recommend adopting',

  // ── meal.recipe ──
  'meal.recipe.categoryFallback': 'Recipe',
  'meal.recipe.servings': '{{servings}} servings',
  'meal.recipe.vegetable': 'Vegetable',

  // ── composition.pair ──
  'composition.pair.ironVitC': 'Iron+VitC→Enhanced iron absorption',
  'composition.pair.calciumVitD': 'Calcium+VitD→Enhanced calcium absorption',
  'composition.pair.fatVitA': 'Fat+VitA→Fat-soluble vitamin absorption',
  'composition.pair.proteinB12': 'Protein+B12→Protein synthesis',
  'composition.pair.calciumOxalate':
    'Calcium+Oxalate→Reduced calcium absorption',
  'composition.pair.ironCalcium':
    'High Iron+High Calcium→Iron absorption competition',
  'composition.pair.zincPhytate': 'Zinc+Phytate→Reduced zinc absorption',

  // ════════════════════════════════════════════════════════
  // V6.9 Phase 1-F: Scene / Recipe / Explainability messages
  // ════════════════════════════════════════════════════════

  // ── scene.label ──
  'scene.label.quick_breakfast': 'Quick Breakfast',
  'scene.label.leisurely_brunch': 'Leisurely Brunch',
  'scene.label.office_lunch': 'Office Lunch',
  'scene.label.home_cooking': 'Home Cooking',
  'scene.label.eating_out': 'Eating Out',
  'scene.label.convenience_meal': 'Convenience Meal',
  'scene.label.canteen_meal': 'Canteen Meal',
  'scene.label.post_workout': 'Post-Workout',
  'scene.label.late_night_snack': 'Late Night Snack',
  'scene.label.family_dinner': 'Family Dinner',
  'scene.label.meal_prep': 'Meal Prep',
  'scene.label.general': 'Balanced Meal',

  // ── scene.tip ──
  'scene.tip.quick_breakfast': 'Short on time — quick high-protein breakfast',
  'scene.tip.leisurely_brunch': 'Weekend vibes — enjoy a hearty brunch',
  'scene.tip.office_lunch': 'Workday lunch — nutritious and convenient',
  'scene.tip.home_cooking': 'Cook at home — healthy and affordable',
  'scene.tip.eating_out': 'Dining out — choose wisely for health',
  'scene.tip.convenience_meal': 'Convenience pick — quick but smart',
  'scene.tip.canteen_meal': 'Cafeteria meal — mix proteins and veggies',
  'scene.tip.post_workout': 'Refuel with protein and carbs after exercise',
  'scene.tip.late_night_snack': 'Keep it light and easy to digest',
  'scene.tip.family_dinner': 'Family meal — something for everyone',
  'scene.tip.meal_prep': 'Prep ahead — cook once, eat multiple meals',
  'scene.tip.general': 'Balanced nutrition for daily needs',

  // ── scene.realism ──
  'scene.realism.strict':
    'Strict mode: only the most accessible foods for this scene',
  'scene.realism.normal': 'Standard mode: balancing variety and accessibility',
  'scene.realism.relaxed': 'Relaxed mode: exploring a wider range of options',

  // ── recipe.theme ──
  'recipe.theme.prefix': '{{sceneLabel}} · {{mealLabel}} Plan',
  'recipe.theme.fallback': "Today's Recommended Plan",

  // ── recipe.assembled ──
  'recipe.assembled.matched': 'Matched {{count}} recipes for you',
  'recipe.assembled.smart': 'Smart-assembled {{count}} dishes for you',
  'recipe.assembled.difficulty.easy': 'Easy',
  'recipe.assembled.difficulty.medium': 'Medium',
  'recipe.assembled.difficulty.hard': 'Hard',
  'recipe.assembled.cookTime': 'Estimated cooking time: {{minutes}} min',
  'recipe.assembled.ingredients': '{{count}} ingredients needed',

  // ── recipe.role ──
  'recipe.role.main': 'Main Dish',
  'recipe.role.side': 'Side Dish',
  'recipe.role.staple': 'Staple',
  'recipe.role.soup': 'Soup',
  'recipe.role.dessert': 'Dessert',

  // ── availability ──
  'availability.channel.HOME_COOK': 'Home Cook',
  'availability.channel.RESTAURANT': 'Restaurant',
  'availability.channel.DELIVERY': 'Delivery',
  'availability.channel.CONVENIENCE': 'Convenience Store',
  'availability.channel.CANTEEN': 'Canteen',
  'availability.channel.UNKNOWN': 'Unknown',
  'availability.score.high': 'Easy to get',
  'availability.score.medium': 'Available',
  'availability.score.low': 'Hard to get',

  // ── insight ──
  'insight.protein_contribution.title': 'Protein Contribution',
  'insight.protein_contribution.content':
    '{{foodName}} provides {{protein}}g protein, {{ratio}}% of meal target',
  'insight.calorie_match.title': 'Calorie Match',
  'insight.calorie_match.excellent':
    'Meal calories closely match target ({{deviation}}% off)',
  'insight.calorie_match.moderate':
    'Meal calories roughly match target ({{deviation}}% off)',
  'insight.scene_match.title': 'Scene Fit',
  'insight.scene_match.quick_breakfast':
    'Perfect for a quick breakfast, minimal prep time',
  'insight.scene_match.leisurely_brunch': 'Great for a relaxed weekend brunch',
  'insight.scene_match.office_lunch': 'Easy to get near the office',
  'insight.scene_match.home_cooking':
    'Simple to cook at home with common ingredients',
  'insight.scene_match.eating_out': 'A good pick when dining out',
  'insight.scene_match.convenience_meal': 'Available at convenience stores',
  'insight.scene_match.canteen_meal': 'Commonly found in cafeterias',
  'insight.scene_match.post_workout':
    'Quick energy replenishment after exercise',
  'insight.scene_match.late_night_snack': 'Light and gentle on the stomach',
  'insight.scene_match.family_dinner': 'Suitable for the whole family',
  'insight.scene_match.meal_prep': 'Great for batch prep, stores well',
  'insight.scene_match.general': 'A versatile healthy choice',
  'insight.new_category.title': 'New Category',
  'insight.new_category.content':
    '{{foodName}} is a "{{category}}" item you haven\'t tried recently',
  'insight.diversity.title': 'Diversity Bonus',
  'insight.diversity.content':
    'This meal covers {{categoryCount}} categories for well-rounded nutrition',
  'insight.execution.title': 'Execution Difficulty',
  'insight.execution.easy': 'Easy to make, about {{minutes}} min',
  'insight.execution.medium': 'Moderate difficulty, some cooking skills needed',
  'insight.execution.hard': 'Complex recipe, try when you have time',

  // ── explain.dim (V6.9 extension) ──
  'explain.dim.popularity': 'Popularity',
  'explain.dim.executability': 'Executability',
  'explain.dim.diversity': 'Diversity',
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

  // ════════════════════════════════════════════════════════
  // V6.8 Phase 1-F: 新メッセージグループ（日本語 — Phase 2 で完全翻訳予定）
  // ════════════════════════════════════════════════════════

  // ── channel_label ──
  'channel_label.home_cook': '自炊',
  'channel_label.restaurant': 'レストラン',
  'channel_label.delivery': 'デリバリー',
  'channel_label.convenience': 'コンビニ',
  'channel_label.canteen': '食堂',

  // ── cooking_method ──
  'cooking_method.stir_fry': '炒め',
  'cooking_method.steam': '蒸し',
  'cooking_method.boil': '煮',
  'cooking_method.bake': '焼き',
  'cooking_method.raw': '生食・サラダ',

  // ════════════════════════════════════════════════════════
  // V6.8 Phase 2-D: explanation-generator + health-modifier i18n (日本語)
  // ════════════════════════════════════════════════════════

  // ── explain.synergy ──
  'explain.synergy.label.iron': '鉄',
  'explain.synergy.label.vitaminC': 'ビタミンC',
  'explain.synergy.label.calcium': 'カルシウム',
  'explain.synergy.label.vitaminD': 'ビタミンD',
  'explain.synergy.label.fat': '脂質',
  'explain.synergy.label.vitaminA': 'ビタミンA',
  'explain.synergy.label.protein': 'タンパク質',
  'explain.synergy.label.vitaminB12': 'ビタミンB12',
  'explain.synergy.iron_vitaminC': 'ビタミンCが鉄の吸収を促進します',
  'explain.synergy.calcium_vitaminD': 'ビタミンDがカルシウムの吸収を促進します',
  'explain.synergy.fat_vitaminA': '脂質が脂溶性ビタミンAの吸収を助けます',
  'explain.synergy.protein_vitaminB12':
    'B12がタンパク質の代謝と合成に関与します',

  // ── explain.diversity ──
  'explain.diversity.ingredientRepeat':
    '一部の食材が重複しています。異なる食材に置き換えてみてください',
  'explain.diversity.cookingMethodTooMany':
    '{{method}}料理が多いです。{{alternative}}の料理を追加してみてください',
  'explain.diversity.cookAlt.stir_fry': '蒸しまたは煮',
  'explain.diversity.cookAlt.deep_fry': '蒸しまたは焼き',
  'explain.diversity.cookAlt.default': 'その他の調理法',
  'explain.diversity.flavorMonotone':
    '味が単調です。異なる風味の料理を組み合わせてみてください',
  'explain.diversity.textureMonotone':
    '食感が単調です。異なる食感を組み合わせてみてください',
  'explain.diversity.addVitaminC':
    'ビタミンC豊富な野菜や果物を追加してミネラルの吸収を促進しましょう',

  // ── explain.meal ──
  'explain.meal.mainProtein': '{{name}}が主なタンパク質源です',
  'explain.meal.fiberSource': '{{name}}が食物繊維と満腹感を補います',
  'explain.meal.theme.nutrientDensity':
    '全体的に栄養密度を重視した組み合わせです',
  'explain.meal.theme.glycemic': '全体的に血糖値の安定を考慮した組み合わせです',
  'explain.meal.theme.protein': '全体的に高タンパク回復に偏った組み合わせです',
  'explain.meal.theme.fiber': '全体的に食物繊維の補充を重視した組み合わせです',
  'explain.meal.goalBalance':
    'この食事は{{goal}}目標に合わせてバランスよく組み合わせました',
  'explain.meal.healthConstraint': '健康上の制約も考慮しています',
  'explain.meal.coachingSuffix':
    'この方向で食事を続けると、{{goal}}目標に近づきやすくなります',

  // ── explain.delta ──
  'explain.delta.postExercise':
    '今日は運動予定があるため、タンパク質補給を最適化しました',
  'explain.delta.lateNight': '深夜帯のため、より軽い選択肢に調整しました',
  'explain.delta.weekday': '平日シーンのため、手軽な組み合わせをおすすめします',
  'explain.delta.nutritionGap':
    '最近の食事分析に基づき、{{gaps}}の摂取が少ないため、含有量の多い食品を優先しました',
  'explain.delta.diversityRotation':
    '食事の多様性を維持するため、異なるタイプの食品をおすすめしました',
  'explain.delta.strategyRefresh': '食習慣に基づいておすすめを更新しました',

  // ── explain.channel ──
  'explain.channel.delivery': 'デリバリー',
  'explain.channel.homeCook': '自炊',
  'explain.channel.canteen': '食堂',
  'explain.channel.convenience': 'コンビニ',
  'explain.channel.restaurant': 'レストラン',
  'explain.channel.default': '現在のシーン',
  'explain.channel.filterNote':
    '{{channel}}シーンに基づき、{{count}}件の不適切な選択肢を除外しました',

  // ── health.veto ──
  'health.veto.allergen': 'アレルゲン一致: {{matched}}',
  'health.veto.transFat': 'トランス脂肪が著しく超過: {{amount}}g/100g',
  'health.veto.goutExtremePurine':
    '痛風: 極めて高いプリン体 ({{amount}}mg/100g) — 禁止',
  'health.veto.celiacGluten': 'セリアック病: グルテン含有 — 禁止',

  // ── health.penalty ──
  'health.penalty.fried': '揚げ物',
  'health.penalty.highSodiumSevere':
    '高ナトリウム: {{amount}}mg/100g (深刻な超過)',
  'health.penalty.highSodium': '高ナトリウム: {{amount}}mg/100g',

  // ── health.goal ──
  'health.goal.fatLossHighSugar': '減量目標: 高糖 {{amount}}g/100g',
  'health.goal.muscleGainLowProtein': '増量目標: タンパク質含有量が極めて低い',

  // ── health.condition ──
  'health.condition.diabetesHighGI': '糖尿病: 高GI食品 ({{value}})',
  'health.condition.diabetesMidGI': '糖尿病: 中GI食品 ({{value}})',
  'health.condition.hypertensionSodium':
    '高血圧: ナトリウム含有量が高い ({{amount}}mg)',
  'health.condition.hyperlipidemiaHighSatFat':
    '脂質異常症: 高飽和脂肪 ({{amount}}g)',
  'health.condition.hyperlipidemiaHighChol':
    '脂質異常症: 高コレステロール ({{amount}}mg)',
  'health.condition.goutHighPurine': '痛風: 高プリン体 ({{amount}}mg/100g)',
  'health.condition.goutMidPurine': '痛風: 中プリン体 ({{amount}}mg/100g)',
  'health.condition.kidneyHighPhos': '腎臓病: 高リン ({{amount}}mg/100g)',
  'health.condition.kidneyMidPhos': '腎臓病: 中リン ({{amount}}mg/100g)',
  'health.condition.kidneyHighK': '腎臓病: 高カリウム ({{amount}}mg/100g)',
  'health.condition.fattyLiverHighSatFat':
    '脂肪肝: 高飽和脂肪 ({{amount}}g/100g)',
  'health.condition.fattyLiverHighSugar': '脂肪肝: 高糖 ({{amount}}g/100g)',
  'health.condition.ibsHighFODMAP': 'IBS: 高FODMAP食品',
  'health.condition.anemiaTeaCoffee': '貧血: 茶/コーヒーが鉄の吸収を阻害',

  // ── health.bonus ──
  'health.bonus.hyperlipidemiaOmega3':
    '脂質異常症: Omega-3豊富で血中脂質に有益',
  'health.bonus.diabetesLowGI':
    '糖尿病: 低GI食品 ({{value}})、血糖コントロールに有益',
  'health.bonus.hypertensionHighKLowNa':
    '高血圧: 高カリウム({{potassium}}mg)+低ナトリウム({{sodium}}mg)、血圧に有益',
  'health.bonus.anemiaHighIron':
    '貧血: 鉄分豊富な食品 ({{amount}}mg/100g)、鉄補給に有益',
  'health.bonus.osteoHighCalcium':
    '骨粗鬆症: カルシウム豊富な食品 ({{amount}}mg/100g)、骨に有益',

  // ── behavior.prompt ──
  'behavior.prompt.sectionHeader': '【ユーザー行動プロフィール】',
  'behavior.prompt.preferredFoods': '- 好みの食品：',
  'behavior.prompt.bingePeriods': '- 過食しやすい時間帯：',
  'behavior.prompt.suggestionRate': '- 提案実行率：',
  'behavior.prompt.streakDays': '- 連続達成日数：',
  'behavior.prompt.streakUnit': ' 日',
  'behavior.prompt.separator': '、',

  // ── behavior.notification ──
  'behavior.notification.snackReminder':
    'この時間帯は間食しやすいです。水を飲むか低カロリーの代替品を準備しましょう。',
  'behavior.notification.remainingCalories':
    '残り {{remaining}} kcal、今後の食事に注意してください',
  'behavior.notification.lunchReminder':
    'ランチの記録をお忘れなく。AIが午後と夜の食事プランをお手伝いします',
  'behavior.notification.streakWarning':
    '{{streakDays}}日連続達成中！今日はギリギリです、注意してください！',

  // ── nutrition.highlight ──
  'nutrition.highlight.caloriesOver': '⚠️ カロリー {{percent}}% 超過',
  'nutrition.highlight.caloriesUnder': '⚠️ カロリー {{percent}}% 不足',
  'nutrition.highlight.caloriesGood': '✅ カロリー達成',
  'nutrition.highlight.proteinLow': '⚠️ タンパク質 {{percent}}% 不足',
  'nutrition.highlight.proteinHigh': '⚠️ タンパク質 {{percent}}% 超過',
  'nutrition.highlight.proteinGood': '✅ タンパク質達成',
  'nutrition.highlight.fatHigh': '⚠️ 脂質 {{percent}}% 超過',
  'nutrition.highlight.fatLow': '⚠️ 脂質 {{percent}}% 不足',
  'nutrition.highlight.fatGood': '✅ 脂質達成',
  'nutrition.highlight.carbsHigh': '⚠️ 炭水化物 {{percent}}% 超過',
  'nutrition.highlight.carbsLow': '⚠️ 炭水化物 {{percent}}% 不足',
  'nutrition.highlight.carbsGood': '✅ 炭水化物達成',
  'nutrition.highlight.fiberLow': '⚠️ 食物繊維 {{percent}}% 不足',
  'nutrition.highlight.fiberGood': '✅ 食物繊維達成',
  'nutrition.highlight.sodiumHigh': '⚠️ ナトリウム {{percent}}% 超過',
  'nutrition.highlight.sodiumGood': '✅ ナトリウム達成',

  // ── nutrition.feedback ──
  'nutrition.feedback.allGood': '本日の食事は全項目達成、この調子で！',
  'nutrition.feedback.caloriesTip':
    'カロリーが{{direction}}、食事量の調整をお勧めします',
  'nutrition.feedback.proteinTip':
    'タンパク質が{{direction}}、タンパク質源の調整をお勧めします',
  'nutrition.feedback.fatTip':
    '脂質が{{direction}}、油脂摂取の調整をお勧めします',
  'nutrition.feedback.carbsTip':
    '炭水化物が{{direction}}、主食量の調整をお勧めします',
  'nutrition.feedback.separator': '；',

  // ── food.suggestion ──
  'food.suggestion.caloriesReached': '本日のカロリー目標達成',
  'food.suggestion.noMoreFood':
    'これ以上の食事は不要です。水かゼロカロリー飲料をどうぞ',

  // ── export.section ──
  'export.section.foodRecords': '# 食事記録\n',
  'export.section.dailySummaries': '# 日次サマリー\n',
  'export.section.separator': '\n',

  // ── export.record_header ──
  'export.record_header.date': '日付',
  'export.record_header.mealType': '食事',
  'export.record_header.food': '食品',
  'export.record_header.totalCalories': 'カロリー(kcal)',
  'export.record_header.protein': 'タンパク質(g)',
  'export.record_header.fat': '脂質(g)',
  'export.record_header.carbs': '炭水化物(g)',
  'export.record_header.fiber': '食物繊維(g)',
  'export.record_header.sodium': 'ナトリウム(mg)',
  'export.record_header.quantity': '分量',
  'export.record_header.unit': '単位',
  'export.record_header.source': 'ソース',

  // ── export.summary_header ──
  'export.summary_header.date': '日付',
  'export.summary_header.totalCalories': 'カロリー(kcal)',
  'export.summary_header.caloriesTarget': 'カロリー目標(kcal)',
  'export.summary_header.caloriesPercent': 'カロリー達成(%)',
  'export.summary_header.protein': 'タンパク質(g)',
  'export.summary_header.proteinTarget': 'タンパク質目標(g)',
  'export.summary_header.fat': '脂質(g)',
  'export.summary_header.fatTarget': '脂質目標(g)',
  'export.summary_header.carbs': '炭水化物(g)',
  'export.summary_header.carbsTarget': '炭水化物目標(g)',
  'export.summary_header.fiber': '食物繊維(g)',
  'export.summary_header.sodium': 'ナトリウム(mg)',
  'export.summary_header.score': 'スコア',

  // ── export.fallback ──
  'export.fallback.unknown': '不明',

  // ── ab.analysis ──
  'ab.analysis.insufficientGroups':
    'データ不足：分析には少なくとも2グループのフィードバックが必要です',
  'ab.analysis.noControl':
    '分析不可：controlグループが見つかりません（グループ名に"control"を含む必要があります）',
  'ab.analysis.insufficientSample':
    'サンプル不足：一部グループのユーザー数 < {{minSample}}、データ収集を継続してください',
  'ab.analysis.controlWins':
    'Controlグループ "{{controlGroup}}" の方が優れています。現行戦略の維持を推奨',
  'ab.analysis.noSignificantDiff':
    'グループ間に統計的有意差なし。control戦略の維持または実験パラメータの調整を推奨',
  'ab.analysis.singleWinner':
    '実験グループ "{{winner}}" がcontrolを有意に上回り、承認率 +{{lift}}%、採用を推奨',
  'ab.analysis.multipleWinners':
    '複数グループがcontrolを上回り、"{{winner}}" が最大改善 ({{lift}}%)、採用を推奨',

  // ── meal.recipe ──
  'meal.recipe.categoryFallback': 'レシピ',
  'meal.recipe.servings': '{{servings}}人前',
  'meal.recipe.vegetable': '野菜',

  // ── composition.pair ──
  'composition.pair.ironVitC': '鉄+ビタミンC→鉄吸収促進',
  'composition.pair.calciumVitD': 'カルシウム+ビタミンD→カルシウム吸収促進',
  'composition.pair.fatVitA': '脂質+ビタミンA→脂溶性ビタミン吸収',
  'composition.pair.proteinB12': 'タンパク質+B12→タンパク質合成',
  'composition.pair.calciumOxalate': 'カルシウム+シュウ酸→カルシウム吸収低下',
  'composition.pair.ironCalcium': '高鉄+高カルシウム→鉄吸収競合',
  'composition.pair.zincPhytate': '亜鉛+フィチン酸→亜鉛吸収低下',

  // ════════════════════════════════════════════════════════
  // V6.8 Phase 3-D: 不足していた日本語翻訳の補完
  // ════════════════════════════════════════════════════════

  // ── health_modifier ──
  'health_modifier.diabetes_type2.highGI':
    '高GI食品は2型糖尿病に適していません',
  'health_modifier.diabetes_type2.highSugar': '添加糖の含有量が高すぎます',
  'health_modifier.diabetes_type2.lowFiber':
    '食物繊維が少なく、血糖変動リスクがあります',
  'health_modifier.hypertension.highSodium':
    'ナトリウムが高く、血圧管理に不向きです',
  'health_modifier.hypertension.processed':
    '加工食品は一般的にナトリウムが高いです',
  'health_modifier.hypertension.pickled': '漬物は塩分が高すぎます',
  'health_modifier.hyperlipidemia.highCholesterol':
    'コレステロール含有量が高い',
  'health_modifier.hyperlipidemia.highSatFat': '飽和脂肪が多すぎます',
  'health_modifier.hyperlipidemia.transFat':
    'トランス脂肪を含み、血中脂質に不利です',
  'health_modifier.gout.highPurine': 'プリン体が高く、痛風リスクがあります',
  'health_modifier.gout.organ': '動物内臓はプリン体が極めて高い',
  'health_modifier.gout.seafood': '海産物はプリン体がやや高い、適量に',
  'health_modifier.kidney_disease.highProtein':
    'タンパク質過剰は腎臓に負担をかけます',
  'health_modifier.kidney_disease.highPotassium': 'カリウム含有量が高い',
  'health_modifier.kidney_disease.highPhosphorus': 'リン含有量が高い',
  'health_modifier.fatty_liver.highFat':
    '脂肪含有量が高く、脂肪肝を悪化させます',
  'health_modifier.fatty_liver.highFructose': '高果糖は脂肪肝に不利です',
  'health_modifier.fatty_liver.alcohol': 'アルコール成分を含みます',
  'health_modifier.celiac_disease.gluten': 'グルテンを含みます',
  'health_modifier.celiac_disease.wheat': '小麦を含みます',
  'health_modifier.ibs.highFODMAP':
    '高FODMAP食品は腸を刺激する可能性があります',
  'health_modifier.ibs.dairy': '乳製品はIBS症状を悪化させる可能性があります',
  'health_modifier.ibs.cruciferous':
    'アブラナ科の野菜はガスを発生させる可能性があります',
  'health_modifier.iron_deficiency.enhancer':
    '鉄分豊富または鉄の吸収を促進します',
  'health_modifier.iron_deficiency.inhibitor':
    '鉄の吸収を阻害する成分を含みます',
  'health_modifier.osteoporosis.highCalcium': 'カルシウム豊富で骨に良い',
  'health_modifier.osteoporosis.vitaminD':
    'ビタミンDを含み、カルシウム吸収を促進',
  'health_modifier.osteoporosis.highOxalate':
    'シュウ酸が高く、カルシウム吸収を阻害する可能性',

  // ── nutrition_highlight ──
  'nutrition_highlight.excellentProtein': '優良タンパク質が際立っています',
  'nutrition_highlight.richOmega3': 'オメガ3脂肪酸が豊富',
  'nutrition_highlight.highVitaminC': 'ビタミンC含有量が豊富',
  'nutrition_highlight.highVitaminA': 'ビタミンA含有量が豊富',
  'nutrition_highlight.highVitaminD': 'ビタミンD含有量が豊富',
  'nutrition_highlight.highVitaminE': 'ビタミンE含有量が豊富',
  'nutrition_highlight.richMinerals': 'ミネラル含有量が豊富',
  'nutrition_highlight.antioxidant': '抗酸化成分が豊富',
  'nutrition_highlight.probiotics': 'プロバイオティクスを含む',
  'nutrition_highlight.prebiotics': 'プレバイオティクス（食物繊維）を含む',
  'nutrition_highlight.completeAmino': '必須アミノ酸組成が完全',
  'nutrition_highlight.lowCalorieDense':
    '低エネルギー密度で体重管理に適しています',
  'nutrition_highlight.highSatiety': '満腹感指数が高い',
  'nutrition_highlight.slowDigest': '消化が遅く、血糖値が安定',
  'nutrition_highlight.electrolyte': '電解質を含み、運動後の補給に最適',
  'nutrition_highlight.hydrating': '水分含有量が高く、水分補給に役立つ',

  // ── behavior_notification ──
  'behavior_notification.complianceDropping':
    '最近の食事遵守率が低下しています。目標の調整をご検討ください',
  'behavior_notification.complianceImproving':
    '食事遵守率が向上しています。この調子で続けましょう！',
  'behavior_notification.calorieOvershoot':
    '最近カロリーが連日超過しています。分量にご注意ください',
  'behavior_notification.proteinDeficit':
    'タンパク質摂取が不足しています。良質なタンパク質食品を増やしましょう',
  'behavior_notification.fiberDeficit':
    '食物繊維が不足しています。野菜や果物を多く摂りましょう',
  'behavior_notification.skippedMeal':
    '欠食が検出されました。規則正しい食事は代謝に有益です',
  'behavior_notification.lateNightEating':
    '最近深夜の食事が多く見られます。生活リズムの調整をお勧めします',
  'behavior_notification.diversityLow':
    '食品の多様性が低いです。異なるカテゴリーを試してみてください',
  'behavior_notification.weeklyGoalMet':
    '今週の目標を達成しました。素晴らしいです！',

  // ── filter_reason ──
  'filter_reason.allergen': 'アレルゲン含有: {{allergen}}',
  'filter_reason.dietary': '食事制限に不適合: {{restriction}}',
  'filter_reason.healthCondition':
    '健康状態 {{condition}} により除外されました',
  'filter_reason.calorieTooHigh':
    'カロリーが高すぎ、この食事の予算を超えています',
  'filter_reason.recentlyEaten': '最近推奨済み、重複を避けるため除外',
  'filter_reason.userRejected': 'ユーザーが最近この食品を拒否しました',
  'filter_reason.unavailable': '現在のチャネルではこの食品を入手できません',

  // ── meal_narrative ──
  'meal_narrative.balanced':
    'この食事は栄養バランスが良く、タンパク質・炭水化物・脂質の比率が適切です',
  'meal_narrative.highProtein':
    '高タンパク質の組み合わせ、{{goal}}段階の栄養ニーズに最適',
  'meal_narrative.lowCalorie':
    '低カロリーの組み合わせ、一日の摂取カロリー管理に役立ちます',
  'meal_narrative.fiberRich':
    '食物繊維が豊富で、消化の健康と血糖安定に有益です',
  'meal_narrative.quickPrep': '手軽な組み合わせ、{{cookTime}}分で完成します',
  'meal_narrative.budgetFriendly':
    '経済的な選択、コストパフォーマンスに優れています',
  'meal_narrative.seasonal': '旬の食材を使用、新鮮で栄養豊富です',
  'meal_narrative.recovery':
    '運動後の回復食、タンパク質と炭水化物のバランスが良い',
  'meal_narrative.lateNight': '深夜の軽食、低GI・低脂肪で睡眠に影響しません',
  'meal_narrative.comfort': '心温まる組み合わせ、栄養と美味しさを両立',

  // ── V7.3 P2-G: narrative — 自然言語レコメンド理由テンプレート ──
  'narrative.preference_match':
    '{{food}}はあなたの味の好みに合っています（{{reason}}）',
  'narrative.scene_fit':
    '{{food}}は{{scene}}のシーンに適しています（{{reason}}）',
  'narrative.diversity':
    '食事の多様性のために、{{recentCategory}}を減らし、{{food}}を試してみましょう',
  'narrative.health_benefit':
    '{{food}}は健康目標に役立ちます（{{healthBenefit}}）',
  'narrative.seasonal': '{{food}}は旬の食材で、新鮮で栄養豊富です',
  'narrative.execution_boost':
    '{{food}}は入手しやすく、よく食べる食品で、実行率が高いです',
  'narrative.nutrition_gap':
    '最近{{nutrient}}の摂取が不足しています。{{food}}で補いましょう',

  // ── V7.3 P2-G: nutrient.*.benefit — 栄養素の健康効果テンプレート ──
  'nutrient.protein.benefit': 'タンパク質は筋肉の修復と免疫機能を助けます',
  'nutrient.fiber.benefit': '食物繊維は腸の健康と血糖の安定を促進します',
  'nutrient.vitaminA.benefit': 'ビタミンAは視力と肌の健康を守ります',
  'nutrient.vitaminC.benefit': 'ビタミンCは免疫力を高め、鉄の吸収を促進します',
  'nutrient.vitaminD.benefit':
    'ビタミンDはカルシウムの吸収と骨の健康を促進します',
  'nutrient.vitaminE.benefit': 'ビタミンEは抗酸化作用があり、細胞を保護します',
  'nutrient.calcium.benefit': 'カルシウムは骨と歯を強くします',
  'nutrient.iron.benefit': '鉄は貧血を予防し、全身に酸素を運びます',
  'nutrient.potassium.benefit': 'カリウムは血圧と心臓機能の調節を助けます',
  'nutrient.zinc.benefit': '亜鉛は免疫機能と傷の治癒を促進します',
  'nutrient.magnesium.benefit':
    'マグネシウムは筋肉の弛緩と神経伝達に関与します',

  // ── diversity_tip ──
  'diversity_tip.trySomethingNew':
    'まだ食べたことのない食材を試してみましょう！',
  'diversity_tip.colorVariety':
    '異なる色の野菜や果物を食べて、より多くのフィトケミカルを摂取しましょう',
  'diversity_tip.proteinRotation':
    '異なるタンパク質源をローテーションしましょう（魚、鶏肉、豆類、卵）',
  'diversity_tip.grainVariety':
    '全粒穀物と精白穀物を組み合わせると、より栄養価が高まります',
  'diversity_tip.cookingMethodSwitch':
    '調理法を変えて、同じ食材で異なる風味を楽しみましょう',

  // ── export_header ──
  'export_header.date': '日付',
  'export_header.mealType': '食事タイプ',
  'export_header.foodName': '食品名',
  'export_header.calories': 'カロリー(kcal)',
  'export_header.protein': 'タンパク質(g)',
  'export_header.fat': '脂質(g)',
  'export_header.carbs': '炭水化物(g)',
  'export_header.fiber': '食物繊維(g)',
  'export_header.sodium': 'ナトリウム(mg)',
  'export_header.sugar': '糖(g)',
  'export_header.cholesterol': 'コレステロール(mg)',
  'export_header.vitaminA': 'ビタミンA(μgRAE)',
  'export_header.vitaminC': 'ビタミンC(mg)',
  'export_header.vitaminD': 'ビタミンD(μg)',
  'export_header.calcium': 'カルシウム(mg)',
  'export_header.iron': '鉄(mg)',
  'export_header.potassium': 'カリウム(mg)',
  'export_header.serving': '分量',
  'export_header.score': '総合スコア',
  'export_header.category': '食品分類',
  'export_header.novaClass': 'NOVA分類',
  'export_header.gi': '血糖指数',
  'export_header.goal': '目標タイプ',
  'export_header.compliance': '達成状況',
  'export_header.feedback': 'ユーザーフィードバック',

  // ── ab_conclusion ──
  'ab_conclusion.controlWins':
    'コントロール群の方が優れています。現行戦略の維持を推奨',
  'ab_conclusion.treatmentWins': '実験群の方が優れています。新戦略の展開を推奨',
  'ab_conclusion.noSignificance': '有意差が認められません。引き続き観察を推奨',
  'ab_conclusion.sampleTooSmall':
    'サンプルサイズが小さすぎ、結論の信頼性が低い',
  'ab_conclusion.complianceImproved': '実験群の遵守率が有意に改善しました',
  'ab_conclusion.diversityImproved': '実験群の食品多様性が有意に改善しました',
  'ab_conclusion.satisfactionImproved': '実験群のユーザー満足度がより高い',

  // ── error (additional) ──
  'error.noFoodsAvailable': '現在の条件ではおすすめできる食品がありません',
  'error.targetCalcFailed':
    '栄養目標の計算に失敗しました。デフォルト値を使用します',
  'error.profileIncomplete':
    'プロフィール情報が不完全です。おすすめの精度が低下する可能性があります',
  'error.scoringTimeout':
    'スコアリングがタイムアウトしました。キャッシュ結果を使用します',
  'error.redisUnavailable': 'キャッシュサービスが一時的に利用できません',
  'error.strategyNotFound': '戦略 {{strategyId}} が見つかりません',

  // ════════════════════════════════════════════════════════
  // V6.9 Phase 1-F: シーン / レシピ / 説明性メッセージ
  // ════════════════════════════════════════════════════════

  // ── scene.label ──
  'scene.label.quick_breakfast': '時短朝食',
  'scene.label.leisurely_brunch': 'ゆったりブランチ',
  'scene.label.office_lunch': 'オフィスランチ',
  'scene.label.home_cooking': '家庭料理',
  'scene.label.eating_out': '外食',
  'scene.label.convenience_meal': 'コンビニ食',
  'scene.label.canteen_meal': '社食',
  'scene.label.post_workout': '運動後の食事',
  'scene.label.late_night_snack': '夜食',
  'scene.label.family_dinner': '家族ディナー',
  'scene.label.meal_prep': '作り置き',
  'scene.label.general': 'バランス食',

  // ── scene.tip ──
  'scene.tip.quick_breakfast': '朝は忙しい — 手軽な高タンパク朝食がおすすめ',
  'scene.tip.leisurely_brunch':
    '週末のゆったりタイム、豪華なブランチを楽しもう',
  'scene.tip.office_lunch': '仕事の日のランチ、栄養と手軽さを両立',
  'scene.tip.home_cooking': '自分で作る、ヘルシーで経済的',
  'scene.tip.eating_out': '外食時もヘルシーメニューを選ぼう',
  'scene.tip.convenience_meal': 'コンビニでも賢く選ぶ',
  'scene.tip.canteen_meal': '社食でバランスよく選ぼう',
  'scene.tip.post_workout': '運動後はタンパク質と炭水化物を速やかに補給',
  'scene.tip.late_night_snack': '夜食は控えめに、消化の良いものを',
  'scene.tip.family_dinner': '家族で楽しむ食事、みんなの好みに配慮',
  'scene.tip.meal_prep': '一度に作って複数回楽しむ作り置き',
  'scene.tip.general': 'バランスの取れた栄養で毎日を健康に',

  // ── scene.realism ──
  'scene.realism.strict':
    '厳格モード：このシーンで最も入手しやすい食品のみ推薦',
  'scene.realism.normal': '標準モード：多様性とアクセシビリティのバランス',
  'scene.realism.relaxed': 'リラックスモード：より幅広い選択肢を探索',

  // ── recipe.theme ──
  'recipe.theme.prefix': '{{sceneLabel}} · {{mealLabel}}プラン',
  'recipe.theme.fallback': '本日のおすすめプラン',

  // ── recipe.assembled ──
  'recipe.assembled.matched': '{{count}} 件のレシピがマッチしました',
  'recipe.assembled.smart': '{{count}} 品をスマートに組み合わせました',
  'recipe.assembled.difficulty.easy': '簡単',
  'recipe.assembled.difficulty.medium': '普通',
  'recipe.assembled.difficulty.hard': 'やや難',
  'recipe.assembled.cookTime': '調理時間の目安: {{minutes}} 分',
  'recipe.assembled.ingredients': '食材 {{count}} 種類が必要',

  // ── recipe.role ──
  'recipe.role.main': 'メイン',
  'recipe.role.side': '副菜',
  'recipe.role.staple': '主食',
  'recipe.role.soup': 'スープ',
  'recipe.role.dessert': 'デザート',

  // ── availability ──
  'availability.channel.HOME_COOK': '自炊',
  'availability.channel.RESTAURANT': 'レストラン',
  'availability.channel.DELIVERY': 'デリバリー',
  'availability.channel.CONVENIENCE': 'コンビニ',
  'availability.channel.CANTEEN': '社食',
  'availability.channel.UNKNOWN': '不明',
  'availability.score.high': '入手しやすい',
  'availability.score.medium': '入手可能',
  'availability.score.low': '入手しにくい',

  // ── insight ──
  'insight.protein_contribution.title': 'タンパク質貢献度',
  'insight.protein_contribution.content':
    '{{foodName}} はタンパク質 {{protein}}g を提供、食事目標の {{ratio}}%',
  'insight.calorie_match.title': 'カロリー適合度',
  'insight.calorie_match.excellent':
    '食事カロリーが目標に非常に近い（偏差 {{deviation}}%）',
  'insight.calorie_match.moderate':
    '食事カロリーがおおよそ目標に合致（偏差 {{deviation}}%）',
  'insight.scene_match.title': 'シーン適合性',
  'insight.scene_match.quick_breakfast': '時短朝食に最適、準備時間が短い',
  'insight.scene_match.leisurely_brunch': '週末ブランチにぴったり',
  'insight.scene_match.office_lunch': 'オフィス近くで手に入りやすい',
  'insight.scene_match.home_cooking': '家庭で簡単に作れる、一般的な食材',
  'insight.scene_match.eating_out': '外食時のおすすめ選択肢',
  'insight.scene_match.convenience_meal': 'コンビニで購入可能',
  'insight.scene_match.canteen_meal': '社食でよく見かけるメニュー',
  'insight.scene_match.post_workout': '運動後の素早いエネルギー補給',
  'insight.scene_match.late_night_snack': '胃に優しく軽め',
  'insight.scene_match.family_dinner': '家族全員が楽しめる',
  'insight.scene_match.meal_prep': '作り置きに最適、保存性が良い',
  'insight.scene_match.general': '様々なシーンに対応する健康的な選択',
  'insight.new_category.title': '新カテゴリ探索',
  'insight.new_category.content':
    '{{foodName}} は「{{category}}」カテゴリ、最近試していない品目です',
  'insight.diversity.title': '多様性ボーナス',
  'insight.diversity.content':
    'この食事は {{categoryCount}} カテゴリをカバー、栄養源がより全面的',
  'insight.execution.title': '実行難易度',
  'insight.execution.easy': '簡単に作れる、約 {{minutes}} 分',
  'insight.execution.medium': '中程度の難易度、料理スキルが必要',
  'insight.execution.hard': '複雑なレシピ、時間のある時にどうぞ',

  // ── explain.dim (V6.9 extension) ──
  'explain.dim.popularity': '人気度',
  'explain.dim.executability': '実行可能性',
  'explain.dim.diversity': '多様性',
};

// ==================== 消息注册表 ====================

const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP,
};

/** V6.8: 移除全局可变 locale（线程不安全），t() 改为纯参数驱动 */
/** @deprecated V6.8: 使用 RequestContextService.locale 获取当前 locale 并传给 t() */
let currentLocale: Locale = 'zh-CN';

/**
 * @deprecated V6.8: 全局 setLocale 是线程不安全的。
 * 请改用 RequestContextService.setLocale() 设置请求级 locale，
 * 然后通过 t(key, vars, locale) 的第三参数传入。
 */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

/**
 * @deprecated V6.8: 全局 getLocale 是线程不安全的。
 * 请改用 RequestContextService.locale 获取当前请求的 locale。
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
