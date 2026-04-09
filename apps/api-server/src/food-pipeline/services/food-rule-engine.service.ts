import { Injectable, Logger } from '@nestjs/common';
import { FoodLibrary } from '../../modules/food/entities/food-library.entity';

/**
 * 食物规则引擎服务
 * 基于营养数据自动计算 tags, qualityScore, satietyScore, nutrientDensity
 */
@Injectable()
export class FoodRuleEngineService {
  private readonly logger = new Logger(FoodRuleEngineService.name);

  // ==================== 标签自动生成 ====================

  generateTags(food: Partial<FoodLibrary>): string[] {
    const tags: string[] = [];
    const p = (v: number | null | undefined) => v ?? 0;

    // 营养特征标签
    if (p(food.protein) >= 20) tags.push('high_protein');
    if (food.fat != null && food.fat <= 3) tags.push('low_fat');
    if (food.carbs != null && food.carbs <= 5) tags.push('low_carb');
    if (p(food.fiber) >= 6) tags.push('high_fiber');
    if (food.calories != null && food.calories <= 100) tags.push('low_calorie');
    if (food.sodium != null && food.sodium <= 120) tags.push('low_sodium');
    if (food.sugar != null && food.sugar <= 5) tags.push('low_sugar');
    if (food.glycemicIndex != null && food.glycemicIndex <= 55)
      tags.push('low_gi');

    // 目标适配标签
    if (p(food.protein) >= 20 && food.fat != null && food.fat <= 10)
      tags.push('muscle_gain');
    if (food.calories != null && food.calories <= 150 && p(food.fiber) >= 3)
      tags.push('weight_loss');
    if (food.carbs != null && food.carbs <= 10 && p(food.fat) >= 10)
      tags.push('keto');

    if (
      food.category &&
      ['veggie', 'fruit', 'grain'].includes(food.category) &&
      !food.allergens?.includes('dairy') &&
      !food.allergens?.includes('egg')
    ) {
      tags.push('vegan');
    }

    if (
      food.glycemicIndex != null &&
      food.glycemicIndex <= 55 &&
      food.sugar != null &&
      food.sugar <= 5
    ) {
      tags.push('diabetes_friendly');
    }

    if (
      food.saturatedFat != null &&
      food.saturatedFat <= 2 &&
      (food.transFat == null || food.transFat <= 0) &&
      food.sodium != null &&
      food.sodium <= 300
    ) {
      tags.push('heart_healthy');
    }

    // 属性标签
    if (food.processingLevel === 1) tags.push('natural');
    if (food.processingLevel != null && food.processingLevel <= 2)
      tags.push('whole_food');
    if (!food.isProcessed && !food.isFried) tags.push('natural');

    // 去重
    return [...new Set(tags)];
  }

  // ==================== 品质评分计算 (1-10) ====================

  calculateQualityScore(food: Partial<FoodLibrary>): number {
    if (!food.calories || food.calories <= 0) return 5;
    const p = (v: number | null | undefined) => v ?? 0;

    let score = 5; // 基线

    // 蛋白质密度奖励 (protein / calories × 100, 加权 2.0)
    if (p(food.protein) > 0) {
      const proteinDensity = (p(food.protein) / food.calories) * 100;
      score += Math.min(proteinDensity * 0.1, 2.0);
    }

    // 纤维奖励 (fiber > 3 ? min(fiber/3, 2) : 0, 加权 1.5)
    if (p(food.fiber) > 3) {
      score += Math.min(p(food.fiber) / 3, 2) * 0.75;
    }

    // 加工惩罚 (NOVA 3=-1, NOVA 4=-2)
    if (p(food.processingLevel) >= 3) {
      score -= (p(food.processingLevel) - 2) * 1.0;
    }

    // 油炸惩罚
    if (food.isFried) score -= 1.5;

    // 高糖惩罚 (sugar > 10)
    if (p(food.sugar) > 10) {
      score -= Math.min(p(food.sugar) / 10, 2) * 0.5;
    }

    // 反式脂肪惩罚
    if (p(food.transFat) > 0) score -= 1.5;

    // 微量营养素奖励 0-2
    let microBonus = 0;
    if (p(food.vitaminC) > 10) microBonus += 0.3;
    if (p(food.vitaminA) > 100) microBonus += 0.3;
    if (p(food.calcium) > 100) microBonus += 0.2;
    if (p(food.iron) > 2) microBonus += 0.3;
    if (p(food.potassium) > 200) microBonus += 0.2;
    if (p(food.zinc) > 2) microBonus += 0.2;
    if (p(food.folate) > 50) microBonus += 0.2;
    if (p(food.magnesium) > 30) microBonus += 0.2;
    score += Math.min(microBonus, 2);

    // 归一化到 1-10
    return Math.round(Math.max(1, Math.min(10, score)) * 10) / 10;
  }

  // ==================== 饱腹感评分计算 (1-10) ====================

  calculateSatietyScore(food: Partial<FoodLibrary>): number {
    if (!food.calories || food.calories <= 0) return 5;
    const p = (v: number | null | undefined) => v ?? 0;

    let score = 3; // 基线

    // 蛋白质因子 (protein / 10, 上限 3)
    if (p(food.protein) > 0) {
      score += Math.min(p(food.protein) / 10, 3);
    }

    // 纤维因子 (fiber / 5, 上限 2.5)
    if (p(food.fiber) > 0) {
      score += Math.min(p(food.fiber) / 5, 2.5);
    }

    // 含水量因子 (从热量密度估算, 低热量密度=高含水量)
    // 热量 < 50 → 高含水量, 每100g热量越低水分越多
    const waterFactor = Math.max(0, (200 - food.calories) / 200) * 1.5;
    score += Math.min(waterFactor, 1.5);

    // 高脂肪降低饱腹感
    if (p(food.fat) > 20) {
      score -= Math.min((p(food.fat) - 20) / 20, 1.0);
    }

    // 高GI降低持久饱腹感
    if (p(food.glycemicIndex) > 70) {
      score -= Math.min((p(food.glycemicIndex) - 70) / 30, 1.0);
    }

    return Math.round(Math.max(1, Math.min(10, score)) * 10) / 10;
  }

  // ==================== NRF 9.3 营养密度评分 ====================

  calculateNutrientDensity(food: Partial<FoodLibrary>): number {
    if (!food.calories || food.calories <= 0) return 0;

    const per100kcal = 100 / food.calories;

    // NRF 9.3: 9 nutrients to encourage - 3 nutrients to limit
    // Encourage: protein, fiber, vitA, vitC, vitD, calcium, iron, potassium, magnesium
    // Limit: saturatedFat, sugar, sodium

    // Daily Reference Values (DRV)
    const DRV = {
      protein: 50,
      fiber: 28,
      vitaminA: 900,
      vitaminC: 90,
      vitaminD: 20,
      calcium: 1300,
      iron: 18,
      potassium: 4700,
      magnesium: 420,
      saturatedFat: 20,
      sugar: 50,
      sodium: 2300,
    };

    let nrf = 0;

    // 9 nutrients to encourage (% DRV per 100kcal, capped at 100%)
    nrf += Math.min(
      (((food.protein || 0) * per100kcal) / DRV.protein) * 100,
      100,
    );
    nrf += Math.min((((food.fiber || 0) * per100kcal) / DRV.fiber) * 100, 100);
    nrf += Math.min(
      (((food.vitaminA || 0) * per100kcal) / DRV.vitaminA) * 100,
      100,
    );
    nrf += Math.min(
      (((food.vitaminC || 0) * per100kcal) / DRV.vitaminC) * 100,
      100,
    );
    nrf += Math.min(
      (((food.vitaminD || 0) * per100kcal) / DRV.vitaminD) * 100,
      100,
    );
    nrf += Math.min(
      (((food.calcium || 0) * per100kcal) / DRV.calcium) * 100,
      100,
    );
    nrf += Math.min((((food.iron || 0) * per100kcal) / DRV.iron) * 100, 100);
    nrf += Math.min(
      (((food.potassium || 0) * per100kcal) / DRV.potassium) * 100,
      100,
    );
    nrf += Math.min(
      (((food.magnesium || 0) * per100kcal) / DRV.magnesium) * 100,
      100,
    );

    // 3 nutrients to limit (penalty if exceeding DRV)
    nrf -= Math.max(
      (((food.saturatedFat || 0) * per100kcal) / DRV.saturatedFat) * 100 - 100,
      0,
    );
    nrf -= Math.max(
      (((food.sugar || 0) * per100kcal) / DRV.sugar) * 100 - 100,
      0,
    );
    nrf -= Math.max(
      (((food.sodium || 0) * per100kcal) / DRV.sodium) * 100 - 100,
      0,
    );

    // 归一化 (NRF 9.3 range ~0-900, scale to 0-100)
    return Math.round(Math.max(0, nrf / 9) * 10) / 10;
  }

  // ==================== 批量应用规则 ====================

  applyAllRules(food: Partial<FoodLibrary>): {
    tags: string[];
    qualityScore: number;
    satietyScore: number;
    nutrientDensity: number;
  } {
    return {
      tags: this.generateTags(food),
      qualityScore: this.calculateQualityScore(food),
      satietyScore: this.calculateSatietyScore(food),
      nutrientDensity: this.calculateNutrientDensity(food),
    };
  }

  // ==================== 宏量营养素交叉验证 ====================

  validateMacroConsistency(food: Partial<FoodLibrary>): {
    isValid: boolean;
    expectedCalories: number;
    actualCalories: number;
    error: number;
  } | null {
    if (!food.calories || !food.protein || !food.fat || !food.carbs)
      return null;

    const expected =
      food.protein * 4 + food.carbs * 4 + food.fat * 9 + (food.fiber || 0) * 2;
    const error = Math.abs(food.calories - expected) / food.calories;

    return {
      isValid: error <= 0.15,
      expectedCalories: Math.round(expected * 10) / 10,
      actualCalories: food.calories,
      error: Math.round(error * 1000) / 10, // 百分比
    };
  }
}
