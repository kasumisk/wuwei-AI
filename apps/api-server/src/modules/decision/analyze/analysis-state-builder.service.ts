import { Injectable } from '@nestjs/common';
import {
  AnalysisScore,
  AnalysisState,
  AnalyzedFoodItem,
  NutritionTotals,
  UnifiedUserContext,
} from '../types/analysis-result.types';

@Injectable()
export class AnalysisStateBuilderService {
  build(input: {
    foods: AnalyzedFoodItem[];
    totals: NutritionTotals;
    score: AnalysisScore;
    userContext: UnifiedUserContext;
    mealType?: string;
  }): AnalysisState {
    const { foods, totals, score, userContext, mealType } = input;

    const resolvedMealType = mealType || userContext.mealType || 'unknown';
    const currentMealIndex = this.resolveMealIndex(
      resolvedMealType,
      userContext.mealCount,
    );

    const beforeTotals: NutritionTotals = {
      calories: Math.round(userContext.todayCalories || 0),
      protein: Math.round(userContext.todayProtein || 0),
      fat: Math.round(userContext.todayFat || 0),
      carbs: Math.round(userContext.todayCarbs || 0),
    };

    const afterTotals: NutritionTotals = {
      calories: Math.round((userContext.todayCalories || 0) + totals.calories),
      protein: Math.round((userContext.todayProtein || 0) + totals.protein),
      fat: Math.round((userContext.todayFat || 0) + totals.fat),
      carbs: Math.round((userContext.todayCarbs || 0) + totals.carbs),
    };

    return {
      meal: {
        foods,
        totals,
        score,
      },
      preMealContext: {
        todayTotalsBeforeMeal: beforeTotals,
        remainingBeforeMeal: {
          calories: Math.round(userContext.remainingCalories || 0),
          protein: Math.round(userContext.remainingProtein || 0),
          fat: Math.round(userContext.remainingFat || 0),
          carbs: Math.round(userContext.remainingCarbs || 0),
        },
        currentMealIndex,
        mealType: resolvedMealType,
      },
      projectedAfterMeal: {
        todayTotalsAfterMeal: afterTotals,
        completionRatio: {
          calories: this.toPercent(
            afterTotals.calories,
            userContext.goalCalories,
          ),
          protein: this.toPercent(afterTotals.protein, userContext.goalProtein),
          fat: this.toPercent(afterTotals.fat, userContext.goalFat),
          carbs: this.toPercent(afterTotals.carbs, userContext.goalCarbs),
        },
      },
    };
  }

  private toPercent(value: number, target: number): number {
    if (!target || target <= 0) return 0;
    return Math.round((value / target) * 100);
  }

  private resolveMealIndex(mealType: string, mealCount: number): number {
    const mapping: Record<string, number> = {
      breakfast: 1,
      lunch: 2,
      dinner: 3,
      snack: 4,
    };
    return mapping[mealType] || Math.min(Math.max((mealCount || 0) + 1, 1), 4);
  }
}
