import { Injectable, Logger } from '@nestjs/common';
import { FoodLibrary } from '../../food/entities/food-library.entity';
import {
  BASE_WEIGHTS,
  MEAL_WEIGHT_MODIFIERS,
  PENALTY_RULES,
  DAILY_VALUES,
  NRF_POSITIVE,
  NRF_NEGATIVE,
} from '../../../shared/constants/nutrition.constants';
import { WeightVector } from '../../../shared/interfaces/weight-vector.interface';
import { ScoredFood, PenaltyResult } from '../../../shared/interfaces/scored-food.interface';
import { linearScore, normalizeWeights } from '../../../shared/utils/math.utils';

@Injectable()
export class NutritionScoringService {
  private readonly logger = new Logger(NutritionScoringService.name);

  /**
   * 10维营养评分 — 核心算法
   * score = Σ(w_i × d_i) × (1 - penalty)
   */
  scoreFoodForUser(
    food: FoodLibrary,
    goal: string,
    mealType: string,
    dailyCalorieGoal: number,
    consumedToday: { calories: number; protein: number; fat: number; carbs: number },
  ): ScoredFood {
    // 1. Get base weights for this goal
    const baseWeights = BASE_WEIGHTS[goal] || BASE_WEIGHTS['health'];
    const mealMod = MEAL_WEIGHT_MODIFIERS[mealType] || {};

    // 2. Apply meal-type modifier
    const weights = { ...baseWeights } as Record<string, number>;
    for (const [key, mod] of Object.entries(mealMod)) {
      if (key in weights) {
        weights[key] *= mod as number;
      }
    }

    // 3. Normalize weights to sum = 1
    const normalized = normalizeWeights(weights) as any;

    // 4. Calculate 10 dimension scores (each 0-100)
    const dims = this.calculate10Dimensions(food, dailyCalorieGoal, consumedToday);

    // 5. Weighted sum
    let rawScore = 0;
    rawScore += normalized.calorieEfficiency * dims.calorieEfficiency;
    rawScore += normalized.macroBalance * dims.macroBalance;
    rawScore += normalized.nutrientDensity * dims.nutrientDensity;
    rawScore += normalized.satiety * dims.satiety;
    rawScore += normalized.quality * dims.quality;
    rawScore += normalized.processingPenalty * dims.processingPenalty;
    rawScore += normalized.glycemicControl * dims.glycemicControl;
    rawScore += normalized.inflammationIndex * dims.inflammationIndex;
    rawScore += normalized.diversity * dims.diversity;
    rawScore += normalized.budgetFit * dims.budgetFit;

    // 6. Apply penalties
    const penalties = this.applyPenalties(food, mealType);
    const totalPenalty = penalties.reduce((sum, p) => sum + p.penalty, 0);
    const finalScore = Math.max(0, Math.round(rawScore * (1 - Math.min(totalPenalty, 0.8))));

    return {
      food,
      score: finalScore,
      dimensions: dims,
      penalties,
    };
  }

  private calculate10Dimensions(
    food: FoodLibrary,
    dailyCalorieGoal: number,
    consumed: { calories: number; protein: number; fat: number; carbs: number },
  ) {
    const remaining = Math.max(0, dailyCalorieGoal - consumed.calories);
    const cal = Number(food.calories) || 0;

    // D1: Calorie Efficiency
    const calorieEfficiency = remaining > 0
      ? linearScore(cal, 0, remaining * 0.4, 100, 20)
      : linearScore(cal, 0, 200, 100, 0);

    // D2: Macro Balance (protein ratio)
    const p = Number(food.protein) || 0;
    const f = Number(food.fat) || 0;
    const c = Number(food.carbs) || 0;
    const total = p + f + c || 1;
    const proteinRatio = p / total;
    const macroBalance = linearScore(proteinRatio, 0.15, 0.4, 50, 100);

    // D3: Nutrient Density (NRF 9.3 simplified)
    const nutrientDensity = food.nutrientDensity ? linearScore(Number(food.nutrientDensity), 0, 100, 0, 100) : 50;

    // D4: Satiety
    const satiety = food.satietyScore ? linearScore(Number(food.satietyScore), 1, 10, 0, 100) : 50;

    // D5: Quality
    const quality = food.qualityScore ? linearScore(Number(food.qualityScore), 1, 10, 0, 100) : 50;

    // D6: Processing Penalty
    const processingPenalty = 100 - (food.processingLevel - 1) * 25;

    // D7: Glycemic Control
    const gi = food.glycemicIndex ?? 50;
    const glycemicControl = linearScore(gi, 0, 100, 100, 0);

    // D8: Inflammation Index
    const antiTags = ['omega3', 'antioxidant', 'fiber_rich'];
    const proTags = ['processed', 'fried', 'high_sugar', 'refined'];
    const foodTags = food.tags || [];
    const antiCount = foodTags.filter((t) => antiTags.includes(t)).length;
    const proCount = foodTags.filter((t) => proTags.includes(t)).length;
    const inflammationIndex = linearScore(antiCount - proCount, -3, 3, 0, 100);

    // D9: Diversity (based on category uniqueness — simplified to fixed score)
    const diversity = 60;

    // D10: Budget Fit
    const mealBudget = remaining > 0 ? remaining * 0.35 : dailyCalorieGoal * 0.3;
    const budgetFit = cal <= mealBudget
      ? linearScore(cal, 0, mealBudget, 80, 100)
      : linearScore(cal, mealBudget, mealBudget * 1.5, 100, 20);

    return {
      calorieEfficiency,
      macroBalance,
      nutrientDensity,
      satiety,
      quality,
      processingPenalty,
      glycemicControl,
      inflammationIndex,
      diversity,
      budgetFit,
    };
  }

  private applyPenalties(food: FoodLibrary, mealType: string): PenaltyResult[] {
    const results: PenaltyResult[] = [];

    for (const rule of PENALTY_RULES) {
      let triggered = false;

      switch (rule.id) {
        case 'fried_food':
          triggered = food.isFried;
          break;
        case 'ultra_processed':
          triggered = food.processingLevel >= 4;
          break;
        case 'high_sodium':
          triggered = Number(food.sodium || 0) > 800;
          break;
        case 'high_sugar':
          triggered = Number(food.sugar || 0) > 15;
          break;
        case 'trans_fat':
          triggered = Number(food.transFat || 0) > 0.5;
          break;
        case 'late_night_heavy':
          triggered = mealType === 'snack' && Number(food.calories) > 300;
          break;
      }

      if (triggered) {
        results.push({
          rule: rule.id,
          penalty: rule.weight,
          description: rule.description,
        });
      }
    }

    return results;
  }
}
