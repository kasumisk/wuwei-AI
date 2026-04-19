/**
 * V7.5 P3-B: 健康状况枚举 / 标准化函数
 *
 * 从 recommendation.types.ts 拆分，涵盖：
 * - HealthCondition 枚举
 * - HEALTH_CONDITION_ALIASES 别名映射
 * - normalizeHealthCondition / normalizeHealthConditions 标准化函数
 */

/**
 * 标准健康状况枚举 (V4)
 * 统一 constraint-generator 和 health-modifier-engine 使用的健康状况命名
 */
export enum HealthCondition {
  DIABETES_TYPE2 = 'diabetes_type2',
  HYPERTENSION = 'hypertension',
  HYPERLIPIDEMIA = 'hyperlipidemia',
  GOUT = 'gout',
  KIDNEY_DISEASE = 'kidney_disease',
  FATTY_LIVER = 'fatty_liver',
  /** V5 2.8: 乳糜泻（麸质不耐受） */
  CELIAC_DISEASE = 'celiac_disease',
  /** V5 2.8: 肠易激综合征 */
  IBS = 'ibs',
  /** V5 2.8: 缺铁性贫血 */
  IRON_DEFICIENCY_ANEMIA = 'iron_deficiency_anemia',
  /** V5 2.8: 骨质疏松症 */
  OSTEOPOROSIS = 'osteoporosis',
  /** V7.9: 心血管疾病（低钠/低饱和脂肪/高Omega-3策略） */
  CARDIOVASCULAR = 'cardiovascular',
  /**
   * V7.9: 甲状腺疾病
   * 注：完整支持需细分 thyroid_hyper（甲亢，限碘）/ thyroid_hypo（甲减，补碘）。
   * 当前通用 `thyroid` 采用保守策略：回避高碘极端食物。
   * 食物库暂无 iodineLevel 字段，通过 high_iodine tag 实现粗粒度匹配。
   */
  THYROID = 'thyroid',
}

/**
 * 旧命名 → 标准命名映射（向后兼容）
 * 用于读取 DB 中已存储的旧格式值
 */
export const HEALTH_CONDITION_ALIASES: Record<string, HealthCondition> = {
  diabetes: HealthCondition.DIABETES_TYPE2,
  diabetes_type2: HealthCondition.DIABETES_TYPE2,
  hypertension: HealthCondition.HYPERTENSION,
  high_cholesterol: HealthCondition.HYPERLIPIDEMIA,
  hyperlipidemia: HealthCondition.HYPERLIPIDEMIA,
  gout: HealthCondition.GOUT,
  kidney_disease: HealthCondition.KIDNEY_DISEASE,
  fatty_liver: HealthCondition.FATTY_LIVER,
  // V5 2.8: 新增健康条件别名
  celiac_disease: HealthCondition.CELIAC_DISEASE,
  celiac: HealthCondition.CELIAC_DISEASE,
  gluten_intolerance: HealthCondition.CELIAC_DISEASE,
  ibs: HealthCondition.IBS,
  irritable_bowel: HealthCondition.IBS,
  iron_deficiency_anemia: HealthCondition.IRON_DEFICIENCY_ANEMIA,
  anemia: HealthCondition.IRON_DEFICIENCY_ANEMIA,
  iron_deficiency: HealthCondition.IRON_DEFICIENCY_ANEMIA,
  osteoporosis: HealthCondition.OSTEOPOROSIS,
  // V7.9: 心血管疾病别名
  cardiovascular: HealthCondition.CARDIOVASCULAR,
  cardiovascular_disease: HealthCondition.CARDIOVASCULAR,
  heart_disease: HealthCondition.CARDIOVASCULAR,
  // V7.9: 甲状腺疾病别名
  thyroid: HealthCondition.THYROID,
  thyroid_disease: HealthCondition.THYROID,
  thyroid_hyper: HealthCondition.THYROID,
  thyroid_hypo: HealthCondition.THYROID,
  hyperthyroidism: HealthCondition.THYROID,
  hypothyroidism: HealthCondition.THYROID,
};

/**
 * 将可能的旧命名标准化为 HealthCondition 枚举值
 */
export function normalizeHealthCondition(raw: string): HealthCondition | null {
  return HEALTH_CONDITION_ALIASES[raw] ?? null;
}

/**
 * 将健康状况列表标准化（去重 + 过滤无效值）
 */
export function normalizeHealthConditions(raw: string[]): HealthCondition[] {
  const result = new Set<HealthCondition>();
  for (const r of raw) {
    const normalized = normalizeHealthCondition(r);
    if (normalized) result.add(normalized);
  }
  return [...result];
}
