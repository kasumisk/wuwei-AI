/**
 * 图片分析结果解析器
 *
 * 将 LLM 返回的 JSON 文本解析为 AnalyzedFoodItem[]：
 *  1. 剥离 ```json ... ``` 代码块包裹
 *  2. 缺失宏量营养素时按 category 粗估补齐
 *  3. 调用 nutrition-sanity-validator 做热力学一致性纠偏
 *  4. 营养字段从 per-100g 按 estimatedWeightGrams 换算为 per-serving
 *
 * 不在本类内做：
 *  - HTTP 调用（VisionApiClient）
 *  - 食物库匹配（FoodLibraryMatcher）
 *  - 决策/评分（AnalysisPipeline）
 */
import { Injectable, Logger } from '@nestjs/common';
import { AnalyzedFoodItem } from '../../../../decision/types/analysis-result.types';
import { validateAndCorrectFoods } from '../../../../decision/analyze/nutrition-sanity-validator';

interface CategoryDefault {
  qualityScore: number;
  satietyScore: number;
}

const CATEGORY_DEFAULTS: Record<string, CategoryDefault> = {
  protein: { qualityScore: 7, satietyScore: 8 },
  veggie: { qualityScore: 8, satietyScore: 6 },
  grain: { qualityScore: 5, satietyScore: 6 },
  snack: { qualityScore: 3, satietyScore: 3 },
  beverage: { qualityScore: 4, satietyScore: 2 },
  fruit: { qualityScore: 7, satietyScore: 5 },
  soup: { qualityScore: 6, satietyScore: 5 },
  composite: { qualityScore: 5, satietyScore: 6 },
  condiment: { qualityScore: 4, satietyScore: 2 },
  dairy: { qualityScore: 6, satietyScore: 6 },
  fat: { qualityScore: 4, satietyScore: 3 },
};

/**
 * AI 容错：未返回营养数据时按总热量 + category 粗估宏量营养素 + 质量/饱腹度。
 *
 * 公开导出供其它链路（text 分析）共享。
 */
export function estimateNutrition(
  totalCalories: number,
  category?: string,
): {
  protein: number;
  fat: number;
  carbs: number;
  qualityScore: number;
  satietyScore: number;
} {
  const defaults = CATEGORY_DEFAULTS[category || ''] || {
    qualityScore: 5,
    satietyScore: 5,
  };
  return {
    protein: Math.round((totalCalories * 0.15) / 4),
    fat: Math.round((totalCalories * 0.3) / 9),
    carbs: Math.round((totalCalories * 0.55) / 4),
    ...defaults,
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const scaledRound1 = (v: number | null | undefined, ratio: number) =>
  v != null ? round1(Number(v) * ratio) : undefined;
const scaledRoundInt = (v: number | null | undefined, ratio: number) =>
  v != null ? Math.round(Number(v) * ratio) : undefined;

@Injectable()
export class ImageResultParser {
  private readonly logger = new Logger(ImageResultParser.name);

  /**
   * 直接将 AI JSON 响应解析为 AnalyzedFoodItem[]。
   * 解析失败返回空数组（不抛异常，由上游决定如何兜底）。
   */
  parse(content: string): AnalyzedFoodItem[] {
    let parsed: { foods?: unknown };
    try {
      const cleaned = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn(
        `AI response parse to AnalyzedFoodItem[] failed: ${content.substring(0, 200)}`,
      );
      return [];
    }

    const rawFoods = Array.isArray(parsed.foods) ? parsed.foods : [];
    if (rawFoods.length === 0) return [];

    // 1. 缺失字段补齐
    for (const f of rawFoods) {
      if (!f.protein && !f.fat && !f.carbs && f.calories > 0) {
        const est = estimateNutrition(f.calories, f.category);
        f.protein = est.protein;
        f.fat = est.fat;
        f.carbs = est.carbs;
      }
      if (!f.qualityScore) f.qualityScore = 5;
      if (!f.satietyScore) f.satietyScore = 5;
      if (typeof f.confidence !== 'number') f.confidence = 0.6;
    }

    // 2. 热力学一致性校验（输入 per-100g）
    const validated = validateAndCorrectFoods(
      rawFoods.map((f) => ({
        calories: f.calories || 0,
        protein: f.protein || 0,
        fat: f.fat || 0,
        carbs: f.carbs || 0,
        category: f.category,
        confidence: f.confidence,
        _ref: f,
      })),
    );
    validated.forEach((v, i) => {
      rawFoods[i].protein = v.protein;
      rawFoods[i].fat = v.fat;
      rawFoods[i].carbs = v.carbs;
      rawFoods[i].confidence = v.confidence;
    });

    // 3. per-100g → per-serving 换算
    return rawFoods.map((f): AnalyzedFoodItem => {
      const grams = f.estimatedWeightGrams || 100;
      const ratio = grams / 100;
      return {
        name: f.name,
        nameEn: f.nameEn,
        quantity: f.quantity,
        estimatedWeightGrams: grams,
        standardServingG: f.standardServingG,
        standardServingDesc: f.standardServingDesc,
        category: f.category,
        confidence: f.confidence,
        estimated: f.estimated,
        calories: Math.round((f.calories || 0) * ratio),
        protein: round1((f.protein || 0) * ratio),
        fat: round1((f.fat || 0) * ratio),
        carbs: round1((f.carbs || 0) * ratio),
        fiber: scaledRound1(f.fiber, ratio),
        sodium: scaledRoundInt(f.sodium, ratio),
        sugar: scaledRound1(f.sugar, ratio),
        saturatedFat: scaledRound1(f.saturatedFat, ratio),
        addedSugar: scaledRound1(f.addedSugar, ratio),
        transFat: scaledRound1(f.transFat, ratio),
        cholesterol: scaledRoundInt(f.cholesterol, ratio),
        omega3: scaledRoundInt(f.omega3, ratio),
        omega6: scaledRoundInt(f.omega6, ratio),
        solubleFiber: scaledRound1(f.solubleFiber, ratio),
        vitaminA: scaledRoundInt(f.vitaminA, ratio),
        vitaminC: scaledRound1(f.vitaminC, ratio),
        vitaminD: scaledRound1(f.vitaminD, ratio),
        calcium: scaledRoundInt(f.calcium, ratio),
        iron: scaledRound1(f.iron, ratio),
        potassium: scaledRoundInt(f.potassium, ratio),
        zinc: scaledRound1(f.zinc, ratio),
        // GI/GL 是食物固有属性，不按份量缩放
        glycemicIndex: f.glycemicIndex,
        glycemicLoad: f.glycemicLoad,
        qualityScore: f.qualityScore,
        satietyScore: f.satietyScore,
        processingLevel: f.processingLevel,
        nutrientDensity: f.nutrientDensity,
        fodmapLevel: f.fodmapLevel,
        oxalateLevel: f.oxalateLevel,
        purine: f.purine,
        allergens:
          Array.isArray(f.allergens) && f.allergens.length
            ? f.allergens
            : undefined,
        tags: Array.isArray(f.tags) && f.tags.length ? f.tags : undefined,
        cookingMethods: Array.isArray(f.cookingMethods)
          ? f.cookingMethods
          : undefined,
        ingredientList: Array.isArray(f.ingredientList)
          ? f.ingredientList
          : undefined,
        foodForm: f.foodForm,
        commonPortions: Array.isArray(f.commonPortions)
          ? f.commonPortions
          : undefined,
        dishPriority: f.dishPriority,
      };
    });
  }
}
