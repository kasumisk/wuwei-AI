// ── 性别选项 ──
export const GENDER_OPTIONS = [
  { key: 'male', label: '男', icon: '👨' },
  { key: 'female', label: '女', icon: '👩' },
] as const;

// ── 目标选项 ──
export const GOAL_OPTIONS = [
  { key: 'fat_loss', label: '减脂', emoji: '🔥', desc: '减少体脂，塑造体型' },
  { key: 'muscle_gain', label: '增肌', emoji: '💪', desc: '增加肌肉量，提升力量' },
  { key: 'health', label: '保持健康', emoji: '❤️', desc: '维持健康体重和状态' },
  { key: 'habit', label: '改善习惯', emoji: '🎯', desc: '养成规律饮食好习惯' },
] as const;

// ── 活动等级选项 ──
export const ACTIVITY_LEVEL_OPTIONS = [
  { key: 'sedentary', label: '久坐', icon: '🪑', desc: '办公室工作，很少运动' },
  { key: 'light', label: '轻度', icon: '🚶', desc: '偶尔散步、轻度运动' },
  { key: 'moderate', label: '中度', icon: '🏃', desc: '每周运动 3-5 次' },
  { key: 'active', label: '高强度', icon: '🏋️', desc: '每天运动或体力劳动' },
] as const;

// ── 餐数选项 ──
export const MEALS_PER_DAY_OPTIONS = [2, 3, 4, 5] as const;

// ── 外卖频率选项 ──
export const TAKEOUT_OPTIONS = [
  { key: 'never', label: '很少' },
  { key: 'sometimes', label: '偶尔' },
  { key: 'often', label: '经常' },
] as const;

// ── 饮食限制选项 ──
export const DIETARY_RESTRICTION_OPTIONS = [
  { key: 'no_beef', label: '不吃牛肉' },
  { key: 'vegetarian', label: '素食' },
  { key: 'vegan', label: '纯素' },
  { key: 'lactose_free', label: '乳糖不耐' },
  { key: 'gluten_free', label: '无麸质' },
  { key: 'halal', label: '清真' },
  { key: 'kosher', label: '犹太洁食' },
] as const;

// ── 过敏原选项（安全性优先，独立区域）──
export const ALLERGEN_OPTIONS = [
  { key: 'peanut', label: '花生', icon: '🥜' },
  { key: 'tree_nut', label: '坚果', icon: '🌰' },
  { key: 'milk', label: '牛奶', icon: '🥛' },
  { key: 'egg', label: '鸡蛋', icon: '🥚' },
  { key: 'wheat', label: '小麦', icon: '🌾' },
  { key: 'soy', label: '大豆', icon: '🫘' },
  { key: 'fish', label: '鱼类', icon: '🐟' },
  { key: 'shellfish', label: '贝壳类', icon: '🦐' },
  { key: 'sesame', label: '芝麻', icon: '🫘' },
] as const;

// ── 饮食偏好选项 ──
export const FOOD_PREFERENCE_OPTIONS = [
  { key: 'sweet', label: '甜食' },
  { key: 'fried', label: '油炸' },
  { key: 'carbs', label: '碳水' },
  { key: 'meat', label: '肉类' },
  { key: 'spicy', label: '辛辣' },
  { key: 'light', label: '清淡' },
  { key: 'seafood', label: '海鲜' },
] as const;

// ── 自律程度选项 ──
export const DISCIPLINE_OPTIONS = [
  { key: 'high', label: '饮食计划我都能严格执行 💪' },
  { key: 'medium', label: '大部分时候能坚持 👍' },
  { key: 'low', label: '我需要更灵活的方案 🤷' },
] as const;

// ── 容易乱吃时段 ──
export const WEAK_SLOT_OPTIONS = [
  { key: 'morning', label: '上午' },
  { key: 'afternoon', label: '下午' },
  { key: 'evening', label: '傍晚' },
  { key: 'midnight', label: '深夜' },
] as const;

// ── 暴食触发因素 ──
export const BINGE_TRIGGER_OPTIONS = [
  { key: 'stress', label: '压力大' },
  { key: 'bored', label: '无聊' },
  { key: 'social', label: '社交聚餐' },
  { key: 'emotion', label: '情绪波动' },
  { key: 'fatigue', label: '疲劳' },
] as const;

// ── 健康状况选项 ──
export const HEALTH_CONDITION_OPTIONS = [
  { key: 'diabetes', label: '糖尿病', icon: '🩸' },
  { key: 'hypertension', label: '高血压', icon: '❤️' },
  { key: 'hyperlipidemia', label: '高血脂', icon: '🫀' },
  { key: 'gout', label: '痛风', icon: '🦴' },
  { key: 'kidney_disease', label: '肾脏疾病', icon: '🫘' },
  { key: 'celiac', label: '乳糜泻', icon: '🌾' },
  { key: 'ibs', label: '肠易激综合征', icon: '🫃' },
  { key: 'fatty_liver', label: '脂肪肝', icon: '🫁' },
  { key: 'thyroid', label: '甲状腺问题', icon: '🦋' },
  { key: 'anemia', label: '贫血', icon: '💉' },
  { key: 'osteoporosis', label: '骨质疏松', icon: '🦷' },
  { key: 'cardiovascular', label: '心血管疾病', icon: '💓' },
] as const;

// ── 菜系偏好选项 ──
export const CUISINE_OPTIONS = [
  { key: 'chinese', label: '中餐', icon: '🥢' },
  { key: 'sichuan', label: '川菜', icon: '🌶️' },
  { key: 'cantonese', label: '粤菜', icon: '🍜' },
  { key: 'japanese', label: '日料', icon: '🍱' },
  { key: 'korean', label: '韩餐', icon: '🥘' },
  { key: 'western', label: '西餐', icon: '🥩' },
  { key: 'thai', label: '泰国菜', icon: '🍛' },
  { key: 'indian', label: '印度菜', icon: '🫔' },
  { key: 'mediterranean', label: '地中海', icon: '🫒' },
  { key: 'fast_food', label: '快餐', icon: '🍔' },
] as const;

// ── 烹饪技能选项 ──
export const COOKING_SKILL_OPTIONS = [
  { key: 'beginner', label: '新手', desc: '只会煮方便面和炒蛋' },
  { key: 'basic', label: '基础', desc: '能做简单家常菜' },
  { key: 'intermediate', label: '中级', desc: '掌握多种烹饪技法' },
  { key: 'advanced', label: '高级', desc: '能制作复杂料理' },
] as const;

// ── 步骤配置 ──
export const STEP_CONFIG = [
  { step: 1 as const, title: '快速启动', subtitle: '让我们用 3 秒认识你', skippable: false },
  { step: 2 as const, title: '目标与身体', subtitle: '帮你精准计算营养需求', skippable: false },
  { step: 3 as const, title: '饮食习惯', subtitle: '了解你的饮食偏好', skippable: true },
  { step: 4 as const, title: '行为与心理', subtitle: '制定更适合你的方案', skippable: true },
] as const;

// ── Step 3/4 安全默认值（跳过时使用）──
export const STEP3_DEFAULTS = {
  mealsPerDay: 3,
  dietaryRestrictions: [] as string[],
  allergens: [] as string[],
  foodPreferences: [] as string[],
  takeoutFrequency: 'sometimes' as const,
  cuisinePreferences: [] as string[],
  cookingSkillLevel: undefined as string | undefined,
};

export const STEP4_DEFAULTS = {
  discipline: 'medium' as const,
  weakTimeSlots: [] as string[],
  bingeTriggers: [] as string[],
  canCook: true,
  healthConditions: [] as string[],
};
