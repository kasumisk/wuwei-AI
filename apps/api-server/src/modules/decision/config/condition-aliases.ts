/**
 * 多语言条件匹配别名映射
 *
 * 用于 decision-checks.ts 和 food-scoring.service.ts 中的条件判断。
 * 所有健康状况、饮食限制的匹配统一通过此文件的别名进行，
 * 避免在业务逻辑中硬编码任何语言的字符串。
 */

// ==================== 食物关键字别名 ====================

/** 肉类关键字（素食/纯素检查用） */
export const MEAT_KEYWORDS = [
  'meat',
  'chicken',
  'pork',
  'beef',
  'fish',
  'shrimp',
  '肉',
  '鸡',
  '猪',
  '牛',
  '羊',
  '鱼',
  '虾',
  '蟹',
  '肉類',
  '鶏',
  '豚',
  '牛肉',
  '羊肉',
  '魚',
  'エビ',
  'カニ',
];

/** 牛肉关键字（no_beef 检查用） */
export const BEEF_KEYWORDS = ['beef', '牛', '牛肉'];

/** 猪肉关键字（halal / kosher 检查用） */
export const PORK_KEYWORDS = ['pork', '猪', '豚', '豚肉'];

/** 低钠饮食限制别名 */
export const LOW_SODIUM_ALIASES = [
  'low_sodium',
  'low_salt',
  '低盐',
  '低钠',
  '減塩',
];

// ==================== 健康状况别名 ====================

/** 健康状况标准键 → 多语言别名 */
export const HEALTH_CONDITION_ALIASES: Record<string, string[]> = {
  hypertension: ['hypertension', '高血压', '高血圧'],
  diabetes: ['diabetes', 'diabetes_type1', 'diabetes_type2', '糖尿病'],
  cardiovascular: [
    'cardiovascular',
    'cardiovascular_disease',
    'heart_disease',
    '心脏病',
    '心臓病',
  ],
  gout: ['gout', '痛风', '痛風'],
  kidney_disease: [
    'kidney_disease',
    'chronic_kidney_disease',
    '肾病',
    '腎臓病',
  ],
  hyperlipidemia: ['hyperlipidemia', '高血脂', '高脂血症'],
  fatty_liver: ['fatty_liver', '脂肪肝', '脂肪肝疾患'],
  celiac: ['celiac', 'celiac_disease', '乳糜泻', 'セリアック病'],
  anemia: ['anemia', 'iron_deficiency_anemia', '缺铁性贫血', '鉄欠乏性貧血'],
  osteoporosis: ['osteoporosis', '骨质疏松', '骨粗鬆症'],
  ibs: ['ibs', 'irritable_bowel_syndrome', '肠易激综合征', '過敏性腸症候群'],
};

// ==================== 工具函数 ====================

/**
 * 检查用户健康状况列表是否包含指定状况（多语言匹配）
 *
 * @param conditions - 用户的 healthConditions 数组（已 toLowerCase）
 * @param conditionKey - HEALTH_CONDITION_ALIASES 的标准键
 * @returns 是否匹配
 */
export function hasCondition(
  conditions: string[],
  conditionKey: string,
): boolean {
  const aliases = HEALTH_CONDITION_ALIASES[conditionKey];
  if (!aliases) return conditions.includes(conditionKey);
  // diabetes 特殊处理：支持子串匹配（diabetes_type2 等变体）
  if (conditionKey === 'diabetes') {
    return conditions.some(
      (c) => aliases.includes(c) || c.includes('diabetes'),
    );
  }
  return conditions.some((c) => aliases.includes(c));
}
