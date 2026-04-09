import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../entities/food-library.entity';
import { GoalType } from '../nutrition-score.service';
import {
  MealTarget,
  ScoredFood,
  SCORE_WEIGHTS,
  CATEGORY_QUALITY,
  CATEGORY_SATIETY,
} from './recommendation.types';

@Injectable()
export class FoodScorerService {
  scoreFood(food: FoodLibrary, goalType: string, target?: MealTarget): number {
    const servingCal = (food.calories * food.standardServingG) / 100;
    const servingProtein = ((food.protein || 0) * food.standardServingG) / 100;
    const servingCarbs = ((food.carbs || 0) * food.standardServingG) / 100;
    const servingFat = ((food.fat || 0) * food.standardServingG) / 100;

    const quality = food.qualityScore || CATEGORY_QUALITY[food.category] || 5;
    const satiety = food.satietyScore || CATEGORY_SATIETY[food.category] || 4;

    // 热量评分：钟形函数
    const targetCal = target?.calories || 400;
    const caloriesScore = this.calcEnergyScore(servingCal, targetCal, goalType);

    // 蛋白质评分：分段函数
    const proteinScore = this.calcProteinScore(
      servingProtein,
      servingCal,
      goalType,
    );

    // 碳水/脂肪：区间评分
    const carbsScore =
      servingCal > 0
        ? this.rangeScore((servingCarbs * 4) / servingCal, 0.4, 0.55)
        : 0.5;
    const fatScore =
      servingCal > 0
        ? this.rangeScore((servingFat * 9) / servingCal, 0.2, 0.35)
        : 0.5;

    const qualityScore = quality / 10;
    const satietyScore = satiety / 10;

    const weights = SCORE_WEIGHTS[goalType as GoalType] || SCORE_WEIGHTS.health;
    const scores = [
      caloriesScore,
      proteinScore,
      carbsScore,
      fatScore,
      qualityScore,
      satietyScore,
    ];

    const confidence = Number(food.confidence) || 0.5;
    let rawScore = scores.reduce((sum, s, i) => sum + s * weights[i], 0);

    // 惩罚/加分项
    if (food.isProcessed) rawScore -= 0.06;
    if (food.isFried) rawScore -= 0.08;
    if (food.processingLevel === 4) rawScore -= 0.05;

    const fiber = food.fiber || 0;
    if (fiber >= 3) rawScore += 0.03;

    const sodium = food.sodium || 0;
    if (sodium > 600) rawScore -= 0.03;

    const transFat = food.transFat || 0;
    if (transFat > 0.5) rawScore -= 0.05;

    const gi = food.glycemicIndex || 0;
    if (
      gi > 0 &&
      gi < 55 &&
      (goalType === 'fat_loss' || goalType === 'health')
    ) {
      rawScore += 0.02;
    }

    return Math.max(0, rawScore * (0.7 + 0.3 * confidence));
  }

  scoreFoodsWithServing(
    candidates: FoodLibrary[],
    goalType: string,
    target?: MealTarget,
  ): ScoredFood[] {
    return candidates
      .map((food) => ({
        food,
        score: this.scoreFood(food, goalType, target),
        ...this.calcServingNutrition(food),
      }))
      .sort((a, b) => b.score - a.score);
  }

  calcServingNutrition(
    food: FoodLibrary,
  ): Pick<
    ScoredFood,
    'servingCalories' | 'servingProtein' | 'servingFat' | 'servingCarbs'
  > {
    return {
      servingCalories: Math.round(
        (food.calories * food.standardServingG) / 100,
      ),
      servingProtein: Math.round(
        ((food.protein || 0) * food.standardServingG) / 100,
      ),
      servingFat: Math.round(((food.fat || 0) * food.standardServingG) / 100),
      servingCarbs: Math.round(
        ((food.carbs || 0) * food.standardServingG) / 100,
      ),
    };
  }

  /** 热量评分 — 高斯钟形函数 */
  private calcEnergyScore(
    actual: number,
    target: number,
    goalType: string,
  ): number {
    if (target <= 0) return 0.8;
    const sigmaRatio: Record<string, number> = {
      fat_loss: 0.12,
      muscle_gain: 0.2,
      health: 0.15,
      habit: 0.25,
    };
    const sigma = target * (sigmaRatio[goalType] || 0.15);
    const diff = actual - target;
    let score = Math.exp(-(diff * diff) / (2 * sigma * sigma));

    if (goalType === 'fat_loss' && diff > 0) score *= 0.85;
    if (goalType === 'muscle_gain' && diff < 0) score *= 0.9;
    return score;
  }

  /** 蛋白质评分 — 分段函数 */
  private calcProteinScore(
    protein: number,
    calories: number,
    goalType: string,
  ): number {
    if (calories <= 0) return 0.8;
    const ratio = (protein * 4) / calories;
    const ranges: Record<string, [number, number]> = {
      fat_loss: [0.25, 0.35],
      muscle_gain: [0.25, 0.4],
      health: [0.15, 0.25],
      habit: [0.12, 0.3],
    };
    const [min, max] = ranges[goalType] || [0.15, 0.25];

    if (ratio >= min && ratio <= max) return 1.0;
    if (ratio < min) return Math.max(0, 0.3 + 0.7 * (ratio / min));
    return Math.max(0, 1.0 - 0.5 * ((ratio - max) / 0.15));
  }

  /** 区间评分 */
  private rangeScore(value: number, min: number, max: number): number {
    if (value >= min && value <= max) return 1.0;
    const diff = value < min ? min - value : value - max;
    return Math.max(0, 1.0 - diff * 2);
  }
}
