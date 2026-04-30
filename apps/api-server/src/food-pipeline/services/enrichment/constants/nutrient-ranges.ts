/**
 * 营养素合理范围与补全相关阈值常量
 *
 * 拆分自 food-enrichment.service.ts（步骤 1）。
 */

// ─── 营养素合理范围（per 100g）────────────────────────────────────────────

export const NUTRIENT_RANGES: Record<string, { min: number; max: number }> = {
  protein: { min: 0, max: 100 },
  fat: { min: 0, max: 100 },
  carbs: { min: 0, max: 100 },
  fiber: { min: 0, max: 80 },
  sugar: { min: 0, max: 100 },
  addedSugar: { min: 0, max: 100 },
  naturalSugar: { min: 0, max: 100 },
  sodium: { min: 0, max: 50000 },
  calcium: { min: 0, max: 2000 },
  iron: { min: 0, max: 100 },
  potassium: { min: 0, max: 10000 },
  cholesterol: { min: 0, max: 2000 },
  vitaminA: { min: 0, max: 50000 },
  vitaminC: { min: 0, max: 2000 },
  vitaminD: { min: 0, max: 1000 },
  vitaminE: { min: 0, max: 500 },
  vitaminB12: { min: 0, max: 100 },
  folate: { min: 0, max: 5000 },
  zinc: { min: 0, max: 100 },
  magnesium: { min: 0, max: 1000 },
  saturatedFat: { min: 0, max: 100 },
  transFat: { min: 0, max: 10 },
  purine: { min: 0, max: 2000 },
  phosphorus: { min: 0, max: 2000 },
  // V8.0: V7.9 新增营养素范围
  vitaminB6: { min: 0, max: 50 },
  omega3: { min: 0, max: 30000 },
  omega6: { min: 0, max: 50000 },
  solubleFiber: { min: 0, max: 40 },
  insolubleFiber: { min: 0, max: 60 },
  waterContentPercent: { min: 0, max: 100 },
  // 属性评分
  glycemicIndex: { min: 0, max: 100 },
  glycemicLoad: { min: 0, max: 50 },
  qualityScore: { min: 0, max: 10 },
  satietyScore: { min: 0, max: 10 },
  nutrientDensity: { min: 0, max: 100 },
  commonalityScore: { min: 0, max: 100 },
  popularity: { min: 0, max: 100 },
  processingLevel: { min: 1, max: 4 },
  // V8.0: 扩展属性数值范围
  prepTimeMinutes: { min: 0, max: 480 },
  cookTimeMinutes: { min: 0, max: 720 },
  estimatedCostLevel: { min: 1, max: 5 },
  shelfLifeDays: { min: 0, max: 3650 },
  dishPriority: { min: 0, max: 100 },
  acquisitionDifficulty: { min: 1, max: 5 },
};

// ─── 完整度门槛 ──────────────────────────────────────────────────────────

/** V2.1: 完整度门槛常量 — 统一所有写入逻辑与进度展示 SQL */
export const COMPLETENESS_PARTIAL_THRESHOLD = 30;
export const COMPLETENESS_COMPLETE_THRESHOLD = 80;

// ─── Staging 阈值 ────────────────────────────────────────────────────────

/** 低置信度阈值：低于此值强制进入 staging */
export const CONFIDENCE_STAGING_THRESHOLD = 0.7;
