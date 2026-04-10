import { FoodLibrary } from '../../../food/entities/food-library.entity';

/**
 * 食物嵌入服务 (V4 Phase 4.1 → V5 Phase 2.11: 64→96 维扩展)
 *
 * 将 FoodLibrary 实体转换为 96 维手工特征向量。
 * 用途：
 * - 食物相似度计算（余弦相似度）
 * - 跨品类替代增强
 * - 协同过滤的 item 特征输入
 *
 * 特征分布（96 维）：
 *   [0-5]   宏量营养素（归一化）: calories, protein, fat, carbs, fiber, sugar
 *   [6-17]  微量营养素（归一化）: sodium, potassium, calcium, iron, vitA, vitC, vitD, vitE, vitB12, folate, zinc, magnesium
 *   [18-23] 健康指标（归一化）: GI, GL, processingLevel, qualityScore, satietyScore, nutrientDensity
 *   [24-27] 衍生比值: proteinToCal, fiberToCarb, satFatToFat, sugarToCarb
 *   [28-37] 品类 one-hot (10): protein, grain, veggie, fruit, dairy, fat, beverage, snack, condiment, composite
 *   [38-41] 餐次适配 (4): breakfast, lunch, dinner, snack
 *   [42-49] 布尔特征 (8): isProcessed, isFried, hasGluten, hasDairy, hasNuts, hasSoy, hasEgg, hasShellfish
 *   [50-63] 标签特征 (14): high_protein, low_fat, low_calorie, high_fiber, keto, vegan, vegetarian, ...
 *   ── V5 新增 (32 维) ──
 *   [64-71] 菜系 one-hot (8): 中式/西式/日韩/东南亚/地中海/印度/中东/拉美
 *   [72-77] 口味特征 (6): 辣度/甜度/咸度/酸度/鲜味/苦味 (0-1 连续值)
 *   [78-83] 烹饪方式 one-hot (6): 蒸/煮/炒/烤/炸/生食
 *   [84-87] 准备复杂度 (4): 准备时间/烹饪时间/总时间(归一化)/技能需求
 *   [88-91] 成本与可得性 (4): 估计成本/季节性/保存期/常见度
 *   [92-95] 医学特征 (4): 嘌呤等级/磷含量等级/FODMAP等级/草酸等级
 */

/** 嵌入向量维度（V5: 64→96） */
export const EMBEDDING_DIM = 96;

/** 品类索引映射 */
const CATEGORY_INDEX: Record<string, number> = {
  protein: 0,
  grain: 1,
  veggie: 2,
  fruit: 3,
  dairy: 4,
  fat: 5,
  beverage: 6,
  snack: 7,
  condiment: 8,
  composite: 9,
};

/** 餐次索引映射 */
const MEAL_TYPE_INDEX: Record<string, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  snack: 3,
};

/** 过敏原索引映射 */
const ALLERGEN_INDEX: Record<string, number> = {
  gluten: 0,
  dairy: 1,
  nuts: 2,
  soy: 3,
  egg: 4,
  shellfish: 5,
};

/** 标签索引映射（top 14） */
const TAG_INDEX: Record<string, number> = {
  high_protein: 0,
  low_fat: 1,
  low_calorie: 2,
  high_fiber: 3,
  keto: 4,
  vegan: 5,
  vegetarian: 6,
  natural: 7,
  easy_digest: 8,
  heavy_flavor: 9,
  light: 10,
  fried: 11,
  high_carb: 12,
  balanced: 13,
};

/** V5 2.11: 菜系索引映射 */
const CUISINE_INDEX: Record<string, number> = {
  chinese: 0,
  western: 1,
  japanese_korean: 2,
  southeast_asian: 3,
  mediterranean: 4,
  indian: 5,
  middle_eastern: 6,
  latin_american: 7,
};

/** V5 2.11: 烹饪方式索引映射 */
const COOKING_METHOD_INDEX: Record<string, number> = {
  steam: 0,
  boil: 1,
  stir_fry: 2,
  roast: 3,
  fry: 4,
  raw: 5,
};

/** V5 2.11: 技能需求映射 → 归一化值 */
const SKILL_VALUE: Record<string, number> = {
  easy: 0.2,
  medium: 0.5,
  hard: 0.9,
};

/** V5 2.11: 等级映射 → 归一化值（用于 FODMAP/草酸等） */
const LEVEL_VALUE: Record<string, number> = {
  low: 0.15,
  moderate: 0.5,
  high: 0.9,
};

/**
 * 归一化参考值（per 100g）
 * 用于将绝对值缩放到 [0, 1] 区间
 * 基于中国食物成分表的常见范围
 */
const NORMALIZATION = {
  calories: 900, // 最高：油脂类 ~900 kcal/100g
  protein: 90, // 最高：蛋白粉 ~90g
  fat: 100, // 最高：油脂 ~100g
  carbs: 100, // 最高：糖类 ~100g
  fiber: 40, // 最高：麦麸 ~40g
  sugar: 100, // 最高：糖 ~100g
  sodium: 5000, // 最高：酱油 ~5000mg
  potassium: 2000, // 最高：干果/豆类 ~2000mg
  calcium: 1200, // 最高：芝麻/干虾 ~1200mg
  iron: 50, // 最高：动物血/肝 ~50mg
  vitaminA: 3000, // 最高：肝脏 ~3000μg RAE
  vitaminC: 300, // 最高：鲜枣/辣椒 ~300mg
  vitaminD: 30, // 最高：鱼肝油
  vitaminE: 100, // 最高：植物油
  vitaminB12: 100, // 最高：肝脏
  folate: 600, // 最高：肝脏/豆类
  zinc: 70, // 最高：牡蛎
  magnesium: 500, // 最高：南瓜子/坚果
  gi: 100, // GI 范围 0-100
  gl: 50, // GL 常见最高
  processingLevel: 4, // NOVA 1-4
  qualityScore: 10, // 1-10
  satietyScore: 10, // 1-10
  nutrientDensity: 100, // NRF9.3 范围
  // V5 2.11: 准备复杂度归一化
  prepTime: 120, // 最高约 120 分钟
  cookTime: 180, // 最高约 180 分钟
  totalTime: 300, // 最高约 300 分钟
  // V5 2.11: 成本与可得性
  costLevel: 5, // 1-5 等级
  shelfLife: 365, // 最长约 1 年
  popularity: 1000, // 使用次数上限
  // V5 2.11: 医学特征
  purine: 500, // 最高：动物内脏 ~500mg/100g
  phosphorus: 1200, // 最高：坚果/种子 ~1200mg/100g
};

/**
 * 将 FoodLibrary 实体转换为 96 维嵌入向量
 *
 * 对于 V5 新增的 [64-95] 维度，如果字段为空（null/undefined），
 * 对应维度默认为 0，不影响余弦相似度计算中已有维度的权重。
 */
export function computeFoodEmbedding(food: FoodLibrary): number[] {
  const vec = new Array(EMBEDDING_DIM).fill(0);

  // ── [0-5] 宏量营养素（归一化到 0-1） ──
  vec[0] = clamp01(food.calories / NORMALIZATION.calories);
  vec[1] = clamp01((food.protein ?? 0) / NORMALIZATION.protein);
  vec[2] = clamp01((food.fat ?? 0) / NORMALIZATION.fat);
  vec[3] = clamp01((food.carbs ?? 0) / NORMALIZATION.carbs);
  vec[4] = clamp01((food.fiber ?? 0) / NORMALIZATION.fiber);
  // V4 Phase 4.7: 优先使用 addedSugar 表征糖分特征
  // 天然糖（水果/乳糖）不应使两个食物在嵌入空间中"看起来不健康"
  const sugarForEmbed =
    food.addedSugar != null ? Number(food.addedSugar) : (food.sugar ?? 0);
  vec[5] = clamp01(sugarForEmbed / NORMALIZATION.sugar);

  // ── [6-17] 微量营养素 ──
  vec[6] = clamp01((food.sodium ?? 0) / NORMALIZATION.sodium);
  vec[7] = clamp01((food.potassium ?? 0) / NORMALIZATION.potassium);
  vec[8] = clamp01((food.calcium ?? 0) / NORMALIZATION.calcium);
  vec[9] = clamp01((food.iron ?? 0) / NORMALIZATION.iron);
  vec[10] = clamp01((food.vitaminA ?? 0) / NORMALIZATION.vitaminA);
  vec[11] = clamp01((food.vitaminC ?? 0) / NORMALIZATION.vitaminC);
  vec[12] = clamp01((food.vitaminD ?? 0) / NORMALIZATION.vitaminD);
  vec[13] = clamp01((food.vitaminE ?? 0) / NORMALIZATION.vitaminE);
  vec[14] = clamp01((food.vitaminB12 ?? 0) / NORMALIZATION.vitaminB12);
  vec[15] = clamp01((food.folate ?? 0) / NORMALIZATION.folate);
  vec[16] = clamp01((food.zinc ?? 0) / NORMALIZATION.zinc);
  vec[17] = clamp01((food.magnesium ?? 0) / NORMALIZATION.magnesium);

  // ── [18-23] 健康指标 ──
  vec[18] = clamp01((food.glycemicIndex ?? 50) / NORMALIZATION.gi);
  vec[19] = clamp01((food.glycemicLoad ?? 10) / NORMALIZATION.gl);
  vec[20] = clamp01(
    (food.processingLevel ?? 1) / NORMALIZATION.processingLevel,
  );
  vec[21] = clamp01((food.qualityScore ?? 5) / NORMALIZATION.qualityScore);
  vec[22] = clamp01((food.satietyScore ?? 4) / NORMALIZATION.satietyScore);
  vec[23] = clamp01(
    (food.nutrientDensity ?? 0) / NORMALIZATION.nutrientDensity,
  );

  // ── [24-27] 衍生比值 ──
  const cal = food.calories || 1;
  const carbsVal = food.carbs ?? 0;
  const fatVal = food.fat ?? 0;
  vec[24] = clamp01(((food.protein ?? 0) * 4) / cal); // 蛋白质供能比
  vec[25] = carbsVal > 0 ? clamp01((food.fiber ?? 0) / carbsVal) : 0; // 纤维碳水比
  vec[26] = fatVal > 0 ? clamp01((food.saturatedFat ?? 0) / fatVal) : 0; // 饱和脂肪比
  // V4 Phase 4.7: sugar-to-carb 使用 addedSugar
  vec[27] = carbsVal > 0 ? clamp01(sugarForEmbed / carbsVal) : 0; // 添加糖碳水比

  // ── [28-37] 品类 one-hot ──
  const catIdx = CATEGORY_INDEX[food.category];
  if (catIdx !== undefined) {
    vec[28 + catIdx] = 1;
  }

  // ── [38-41] 餐次适配 ──
  if (food.mealTypes) {
    for (const mt of food.mealTypes) {
      const mtIdx = MEAL_TYPE_INDEX[mt];
      if (mtIdx !== undefined) {
        vec[38 + mtIdx] = 1;
      }
    }
  }

  // ── [42-49] 布尔特征 ──
  vec[42] = food.isProcessed ? 1 : 0;
  vec[43] = food.isFried ? 1 : 0;
  if (food.allergens) {
    for (const allergen of food.allergens) {
      const aIdx = ALLERGEN_INDEX[allergen];
      if (aIdx !== undefined) {
        vec[44 + aIdx] = 1;
      }
    }
  }

  // ── [50-63] 标签特征 ──
  if (food.tags) {
    for (const tag of food.tags) {
      const tIdx = TAG_INDEX[tag];
      if (tIdx !== undefined) {
        vec[50 + tIdx] = 1;
      }
    }
  }

  // ══════════════════════════════════════════════════════
  //  V5 Phase 2.11 新增维度 [64-95]
  // ══════════════════════════════════════════════════════

  // ── [64-71] 菜系 one-hot (8 维) ──
  if (food.cuisine) {
    const cuisineIdx = CUISINE_INDEX[food.cuisine];
    if (cuisineIdx !== undefined) {
      vec[64 + cuisineIdx] = 1;
    }
  }

  // ── [72-77] 口味特征 (6 维，连续值 0-1) ──
  if (food.flavorProfile) {
    const fp = food.flavorProfile;
    vec[72] = clamp01(fp.spicy ?? 0);
    vec[73] = clamp01(fp.sweet ?? 0);
    vec[74] = clamp01(fp.salty ?? 0);
    vec[75] = clamp01(fp.sour ?? 0);
    vec[76] = clamp01(fp.umami ?? 0);
    vec[77] = clamp01(fp.bitter ?? 0);
  }

  // ── [78-83] 烹饪方式 one-hot (6 维) ──
  if (food.cookingMethod) {
    const cmIdx = COOKING_METHOD_INDEX[food.cookingMethod];
    if (cmIdx !== undefined) {
      vec[78 + cmIdx] = 1;
    }
  }

  // ── [84-87] 准备复杂度 (4 维) ──
  vec[84] = clamp01((food.prepTimeMinutes ?? 0) / NORMALIZATION.prepTime);
  vec[85] = clamp01((food.cookTimeMinutes ?? 0) / NORMALIZATION.cookTime);
  // 总时间 = 准备 + 烹饪
  const totalTime = (food.prepTimeMinutes ?? 0) + (food.cookTimeMinutes ?? 0);
  vec[86] = clamp01(totalTime / NORMALIZATION.totalTime);
  vec[87] = SKILL_VALUE[food.skillRequired ?? ''] ?? 0;

  // ── [88-91] 成本与可得性 (4 维) ──
  vec[88] = clamp01((food.estimatedCostLevel ?? 0) / NORMALIZATION.costLevel);
  // 季节性：通过 tags 中的 seasonal 标签推断，有则为 1
  vec[89] = food.tags?.includes('seasonal') ? 1 : 0;
  vec[90] = clamp01((food.shelfLifeDays ?? 0) / NORMALIZATION.shelfLife);
  // 常见度：使用 popularity 字段归一化
  vec[91] = clamp01((food.popularity ?? 0) / NORMALIZATION.popularity);

  // ── [92-95] 医学特征 (4 维) ──
  // 嘌呤等级：使用 purine 数值归一化
  vec[92] = clamp01((food.purine ?? 0) / NORMALIZATION.purine);
  // 磷含量等级：使用 phosphorus 数值归一化
  vec[93] = clamp01((food.phosphorus ?? 0) / NORMALIZATION.phosphorus);
  // FODMAP 等级
  vec[94] = LEVEL_VALUE[food.fodmapLevel ?? ''] ?? 0;
  // 草酸等级
  vec[95] = LEVEL_VALUE[food.oxalateLevel ?? ''] ?? 0;

  return vec;
}

/**
 * 计算两个嵌入向量的余弦相似度
 * @returns [-1, 1]，1 表示完全相同
 *
 * 注意：支持不同长度的向量比较（取较短者的长度），
 * 用于 V4(64维) → V5(96维) 过渡期的兼容。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  // 如果向量长度不同，补充较长向量剩余部分的范数
  for (let i = len; i < a.length; i++) {
    normA += a[i] * a[i];
  }
  for (let i = len; i < b.length; i++) {
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

/**
 * 计算欧氏距离
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * 在食物集合中找到最相似的 K 个食物
 */
export function findMostSimilar(
  target: number[],
  candidates: Array<{ food: FoodLibrary; embedding: number[] }>,
  topK: number,
  excludeIds?: Set<string>,
): Array<{ food: FoodLibrary; similarity: number }> {
  const scored = candidates
    .filter((c) => !excludeIds?.has(c.food.id))
    .map((c) => ({
      food: c.food,
      similarity: cosineSimilarity(target, c.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, topK);
}

/** 将值约束到 [0, 1] 区间 */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
