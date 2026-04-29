/**
 * V2.1 Phase 1.3 — 份量建议服务
 *
 * 从 FoodDecisionService 提取：
 * - calculateOptimalPortion: 最优份量计算
 * - generateNextMealAdvice: 下一餐建议
 *
 * V2.2: 支持可选 UserThresholds 参数，bufferRatio/minPercent/gap 阈值动态化。
 */
import { Injectable } from '@nestjs/common';
import { I18nService, I18nLocale } from '../../../core/i18n';
import {
  NutritionTotals,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import { OptimalPortion, NextMealAdvice } from './food-decision.service';
import { UserThresholds } from '../config/dynamic-thresholds.service';
import {
  PORTION_BUFFER,
  PORTION_MIN_PERCENT,
} from '../config/decision-thresholds';

@Injectable()
export class PortionAdvisorService {
  constructor(private readonly i18n: I18nService) {}

  // ==================== 最优份量计算 ====================

  calculateOptimalPortion(
    mealCalories: number,
    remainingCalories: number,
    goalType: string,
    thresholds?: UserThresholds,
  ): OptimalPortion {
    if (mealCalories <= 0) {
      return { recommendedPercent: 100, recommendedCalories: 0 };
    }
    if (remainingCalories <= 0) {
      return { recommendedPercent: 0, recommendedCalories: 0 };
    }
    const bufferRatio =
      thresholds?.portionBufferRatio ??
      (PORTION_BUFFER[goalType] || PORTION_BUFFER.health);
    const minPercent = thresholds?.portionMinPercent ?? PORTION_MIN_PERCENT;
    const mealBudget = remainingCalories * bufferRatio;
    const percent = Math.round(
      Math.min(100, (mealBudget / mealCalories) * 100),
    );
    return {
      recommendedPercent: Math.max(minPercent, percent),
      recommendedCalories: Math.round(
        (mealCalories * Math.max(minPercent, percent)) / 100,
      ),
    };
  }

  // ==================== 下一餐建议 ====================

  generateNextMealAdvice(
    ctx: UnifiedUserContext,
    currentMealTotals: NutritionTotals,
    locale?: I18nLocale,
    foodPreferences?: {
      frequentFoods?: string[];
      loves?: string[];
      avoids?: string[];
    },
    thresholds?: UserThresholds,
  ): NextMealAdvice {
    const remainingProtein = Math.max(
      0,
      ctx.goalProtein - ctx.todayProtein - currentMealTotals.protein,
    );
    const remainingFat = Math.max(
      0,
      ctx.goalFat - ctx.todayFat - currentMealTotals.fat,
    );
    const remainingCarbs = Math.max(
      0,
      ctx.goalCarbs - ctx.todayCarbs - currentMealTotals.carbs,
    );
    const remainingCalories = Math.max(
      0,
      ctx.goalCalories - ctx.todayCalories - currentMealTotals.calories,
    );

    const emphasis = this.identifyEmphasis(
      remainingProtein,
      remainingFat,
      remainingCarbs,
      ctx.goalType,
      locale,
      thresholds,
    );
    const suggestion = this.buildNextMealSuggestion(
      remainingCalories,
      remainingProtein,
      remainingFat,
      remainingCarbs,
      emphasis,
      locale,
      foodPreferences,
      thresholds,
    );

    return {
      targetCalories: remainingCalories,
      targetProtein: remainingProtein,
      targetFat: remainingFat,
      targetCarbs: remainingCarbs,
      emphasis,
      suggestion,
    };
  }

  private identifyEmphasis(
    remainingProtein: number,
    remainingFat: number,
    remainingCarbs: number,
    goalType: string,
    locale?: I18nLocale,
    thresholds?: UserThresholds,
  ): string {
    // 动态 gap 阈值：低蛋白门槛 / dinnerHighCarb 的一半 / highFatMeal 的 1/6
    // 回退到原始硬编码值
    const proteinGap = thresholds?.lowProteinMeal ?? 10;
    const carbsGap = thresholds?.dinnerHighCarb
      ? Math.round(thresholds.dinnerHighCarb * 0.5)
      : 20;
    const fatGap = thresholds?.highFatMeal
      ? Math.round(thresholds.highFatMeal * 0.17)
      : 5;

    const priorities: Array<{ macro: string; gap: number }> = [];
    if (remainingProtein > proteinGap)
      priorities.push({ macro: 'protein', gap: remainingProtein });
    if (remainingCarbs > carbsGap)
      priorities.push({ macro: 'carbs', gap: remainingCarbs });
    if (remainingFat > fatGap)
      priorities.push({ macro: 'fat', gap: remainingFat });

    if (goalType === 'fat_loss' || goalType === 'muscle_gain') {
      const proteinEntry = priorities.find((p) => p.macro === 'protein');
      if (proteinEntry) return this.i18n.t('decision.nextMeal.emphasisProtein', locale);
    }

    if (priorities.length === 0) return this.i18n.t('decision.nextMeal.emphasisBalanced', locale);

    priorities.sort((a, b) => b.gap - a.gap);
    const top = priorities[0].macro;
    // i18n-allow-dynamic
    return this.i18n.t(`decision.nextMeal.emphasis.${top}`, locale);
  }

  private buildNextMealSuggestion(
    remainingCalories: number,
    remainingProtein: number,
    _remainingFat: number,
    _remainingCarbs: number,
    emphasis: string,
    locale?: I18nLocale,
    foodPreferences?: {
      frequentFoods?: string[];
      loves?: string[];
      avoids?: string[];
    },
    thresholds?: UserThresholds,
  ): string {
    const lowBudget = thresholds?.nextMealLowBudget ?? 100;
    if (remainingCalories <= lowBudget) {
      return this.i18n.t('decision.nextMeal.budgetLow', locale, { calories: remainingCalories });
    }

    let suggestion = this.i18n.t('decision.nextMeal.suggestion', locale, {
      calories: remainingCalories,
      protein: Math.round(remainingProtein),
      emphasis,
    });

    if (foodPreferences) {
      const candidates = [
        ...(foodPreferences.loves || []),
        ...(foodPreferences.frequentFoods || []).slice(0, 5),
      ];
      const avoidSet = new Set(
        (foodPreferences.avoids || []).map((a) => a.toLowerCase()),
      );
      const filtered = candidates.filter(
        (name) => !avoidSet.has(name.toLowerCase()),
      );
      const unique = [...new Set(filtered)].slice(0, 3);
      if (unique.length > 0) {
        suggestion += this.i18n.t('decision.nextMeal.foodRecommendation', locale, {
          foods: unique.join(this.i18n.t('decision.separator.enumeration', locale)),
        });
      }
    }

    return suggestion;
  }
}
