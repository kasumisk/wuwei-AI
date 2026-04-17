/**
 * V2.2 Phase 1.6 — 决策引擎服务（动态阈值版）
 *
 * V2.1 提取的核心决策逻辑，V2.2 改为消费 DynamicThresholdsService
 * 产出的 UserThresholds，所有绝对阈值替换为用户画像驱动的动态值。
 */
import { Injectable } from '@nestjs/common';
import {
  FoodDecision,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';
import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { DIMENSION_LABELS } from '../config/scoring-dimensions';
import {
  GOAL_DECISION_THRESHOLDS,
  DEFAULT_THRESHOLDS,
} from '../config/decision-thresholds';
import {
  checkAllergenConflict,
  checkRestrictionConflict,
  checkHealthConditionRisk,
} from './decision-checks';
import { DecisionFoodItem, DecisionFactor } from './food-decision.service';
import {
  DynamicThresholdsService,
  UserThresholds,
} from '../config/dynamic-thresholds.service';

@Injectable()
export class DecisionEngineService {
  constructor(private readonly dynamicThresholds: DynamicThresholdsService) {}

  // ==================== 核心决策 ====================

  /**
   * 基于评分 + 上下文计算三档决策
   * V2.2: 所有绝对阈值由 UserThresholds 动态计算
   */
  computeDecision(
    foods: DecisionFoodItem[],
    ctx: UnifiedUserContext,
    nutritionScore: number,
    locale?: Locale,
  ): FoodDecision {
    const th = this.dynamicThresholds.compute(ctx);

    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
    const totalProtein = foods.reduce((s, f) => s + f.protein, 0);
    const totalFat = foods.reduce((s, f) => s + f.fat, 0);
    const totalCarbs = foods.reduce((s, f) => s + f.carbs, 0);
    const remainingAfter = ctx.remainingCalories - totalCalories;

    let scoreDecision = this.scoreToFoodDecision(
      nutritionScore,
      locale,
      ctx.goalType,
    );
    const contextReasons: string[] = [];

    // 时间感知决策调整（V2.2: 动态时间边界 + 动态热量阈值）
    const hour = ctx.localHour ?? 12;
    if (hour >= th.lateNightStart || hour < th.lateNightEnd) {
      if (totalCalories > th.significantMealCal) {
        contextReasons.push(t('decision.context.lateNightHighCal', {}, locale));
        if (scoreDecision.recommendation === 'recommend') {
          scoreDecision = this.scoreToFoodDecision(
            Math.min(nutritionScore, 50),
            locale,
            ctx.goalType,
          );
        }
      }
    } else if (hour >= th.eveningStart && hour < th.lateNightStart) {
      if (totalCarbs > th.highCarbMeal && ctx.goalType === 'fat_loss') {
        contextReasons.push(t('decision.context.eveningHighCarb', {}, locale));
      }
    }

    // 餐次感知决策调整（V2.2: 动态阈值）
    const mealType = ctx.mealType;
    if (mealType === 'breakfast') {
      if (
        (ctx.goalType === 'fat_loss' || ctx.goalType === 'muscle_gain') &&
        totalProtein < th.lowProteinMeal &&
        totalCalories > th.snackHighCal
      ) {
        contextReasons.push(
          t('decision.context.breakfastLowProtein', {}, locale),
        );
      }
    } else if (mealType === 'dinner') {
      if (ctx.goalType === 'fat_loss' && totalCarbs > th.dinnerHighCarb) {
        contextReasons.push(t('decision.context.dinnerHighCarb', {}, locale));
      }
    } else if (mealType === 'snack') {
      if (totalCalories > th.snackHighCal) {
        contextReasons.push(t('decision.context.snackHighCal', {}, locale));
      }
    }

    // 热量预算检查（V2.2: 动态 overBudgetMargin）
    if (remainingAfter < -th.overBudgetMargin) {
      contextReasons.push(
        t(
          'decision.context.overBudget',
          { amount: String(Math.abs(Math.round(remainingAfter))) },
          locale,
        ),
      );
    } else if (remainingAfter < 0) {
      contextReasons.push(t('decision.context.nearLimit', {}, locale));
    }

    // 蛋白质检查（V2.2: 动态阈值）
    if (
      ctx.goalType === 'fat_loss' &&
      totalProtein < th.lowProteinMeal &&
      totalCalories > th.significantMealCal
    ) {
      contextReasons.push(t('decision.context.lowProtein', {}, locale));
    }

    if (ctx.goalType === 'muscle_gain') {
      if (totalProtein >= th.highProteinMeal) {
        contextReasons.push(t('decision.context.goodProtein', {}, locale));
      } else if (
        totalProtein < th.veryLowProteinMeal &&
        totalCalories > th.significantMealCal
      ) {
        contextReasons.push(t('decision.context.lowProteinMuscle', {}, locale));
      }
    }

    // 单餐热量占比检查
    const calorieRatio =
      ctx.goalCalories > 0 ? totalCalories / ctx.goalCalories : 0;
    if (totalCalories > 0 && calorieRatio > th.singleMealMaxRatio) {
      contextReasons.push(t('decision.context.highCalMeal', {}, locale));
    }

    // 脂肪超标检测（V2.2: 动态阈值）
    const projectedFatPct =
      ctx.goalFat > 0 ? ((ctx.todayFat + totalFat) / ctx.goalFat) * 100 : 0;
    if (
      totalFat > th.highFatMeal &&
      projectedFatPct > th.fatExcessRatio * 100 &&
      (ctx.goalType === 'fat_loss' || ctx.goalType === 'health')
    ) {
      contextReasons.push(
        t(
          'decision.context.highFat',
          {
            fat: String(Math.round(totalFat)),
            percent: String(Math.round(projectedFatPct)),
          },
          locale,
        ),
      );
    }

    // 碳水超标检测（V2.2: 动态阈值）
    const projectedCarbsPct =
      ctx.goalCarbs > 0
        ? ((ctx.todayCarbs + totalCarbs) / ctx.goalCarbs) * 100
        : 0;
    if (
      projectedCarbsPct > th.carbExcessRatio * 100 &&
      ctx.goalType === 'fat_loss'
    ) {
      contextReasons.push(
        t(
          'decision.context.highCarbs',
          { percent: String(Math.round(projectedCarbsPct)) },
          locale,
        ),
      );
    }

    // 全目标蛋白检测（午餐后）（V2.2: 动态阈值）
    if (
      hour >= 12 &&
      totalProtein < th.veryLowProteinMeal &&
      totalCalories > th.significantMealCal &&
      ctx.goalProtein > 0
    ) {
      const proteinProgress =
        ((ctx.todayProtein + totalProtein) / ctx.goalProtein) * 100;
      if (proteinProgress < 50 && ctx.goalType !== 'fat_loss') {
        contextReasons.push(
          t('decision.context.lowProteinGeneral', {}, locale),
        );
      }
    }

    // 过敏原检查 → 强制 avoid
    const allergenCheck = checkAllergenConflict(foods, ctx, locale);
    if (allergenCheck?.triggered) {
      contextReasons.unshift(allergenCheck.reason!);
      scoreDecision = {
        recommendation: 'avoid',
        shouldEat: false,
        reason: allergenCheck.reason!,
        riskLevel: 'high',
      };
    }

    // 饮食限制检查
    const restrictionCheck = checkRestrictionConflict(foods, ctx, locale);
    if (restrictionCheck?.triggered) {
      contextReasons.unshift(restrictionCheck.reason!);
      scoreDecision = {
        recommendation: 'avoid',
        shouldEat: false,
        reason: restrictionCheck.reason!,
        riskLevel: 'high',
      };
    }

    // 健康状况警告（V2.2: 动态阈值）
    const healthChecks = checkHealthConditionRisk(foods, ctx, locale, th);
    for (const check of healthChecks) {
      if (check.triggered && check.reason) {
        contextReasons.push(check.reason);
      }
    }

    const reason =
      contextReasons.length > 0
        ? contextReasons.join('；')
        : scoreDecision.reason;

    const advice = this.generateDecisionAdvice(
      scoreDecision,
      ctx,
      totalCalories,
      totalProtein,
      locale,
      totalFat,
      totalCarbs,
      th,
    );

    return { ...scoreDecision, reason, advice };
  }

  // ==================== 评分→决策映射 ====================

  scoreToFoodDecision(
    score: number,
    locale?: Locale,
    goalType?: string,
  ): FoodDecision {
    const thresholds = goalType
      ? GOAL_DECISION_THRESHOLDS[goalType] || DEFAULT_THRESHOLDS
      : DEFAULT_THRESHOLDS;

    if (score >= thresholds.excellent) {
      return {
        recommendation: 'recommend',
        shouldEat: true,
        reason: t('decision.score.excellent', {}, locale),
        riskLevel: 'low',
      };
    }
    if (score >= thresholds.good) {
      return {
        recommendation: 'recommend',
        shouldEat: true,
        reason: t('decision.score.good', {}, locale),
        riskLevel: 'low',
      };
    }
    if (score >= thresholds.caution) {
      return {
        recommendation: 'caution',
        shouldEat: true,
        reason: t('decision.score.low', {}, locale),
        riskLevel: 'medium',
      };
    }
    return {
      recommendation: 'avoid',
      shouldEat: false,
      reason: t('decision.score.veryLow', {}, locale),
      riskLevel: 'high',
    };
  }

  // ==================== 决策因子提取 ====================

  extractDecisionFactors(
    breakdown: NutritionScoreBreakdown,
    locale?: Locale,
  ): DecisionFactor[] {
    const loc = locale || 'zh-CN';
    const labels = DIMENSION_LABELS[loc] || DIMENSION_LABELS['zh-CN'];
    const factors: DecisionFactor[] = [];

    const entries: Array<[string, number]> = [
      ['energy', breakdown.energy],
      ['proteinRatio', breakdown.proteinRatio],
      ['macroBalance', breakdown.macroBalance],
      ['foodQuality', breakdown.foodQuality],
      ['satiety', breakdown.satiety],
      ['stability', breakdown.stability],
      ['glycemicImpact', breakdown.glycemicImpact],
    ];

    for (const [dim, score] of entries) {
      const roundedScore = Math.round(score);
      if (roundedScore < 30) {
        factors.push({
          dimension: dim,
          score: roundedScore,
          impact: 'critical',
          message: t(
            'decision.factor.critical',
            { dimension: labels[dim] || dim, score: String(roundedScore) },
            locale,
          ),
        });
      } else if (roundedScore < 50) {
        factors.push({
          dimension: dim,
          score: roundedScore,
          impact: 'warning',
          message: t(
            'decision.factor.warning',
            { dimension: labels[dim] || dim, score: String(roundedScore) },
            locale,
          ),
        });
      } else if (roundedScore >= 85) {
        factors.push({
          dimension: dim,
          score: roundedScore,
          impact: 'positive',
          message: t(
            'decision.factor.positive',
            { dimension: labels[dim] || dim, score: String(roundedScore) },
            locale,
          ),
        });
      }
    }

    factors.sort((a, b) => a.score - b.score);
    return factors;
  }

  // ==================== 行动建议 ====================

  generateDecisionAdvice(
    decision: FoodDecision,
    ctx: UnifiedUserContext,
    totalCalories: number,
    totalProtein: number,
    locale?: Locale,
    totalFat?: number,
    totalCarbs?: number,
    th?: UserThresholds,
  ): string {
    const lowProtein = th?.lowProteinMeal ?? 15;
    const significantCal = th?.significantMealCal ?? 300;
    const highFat = th?.highFatMeal ?? 30;
    const highProtein = th?.highProteinMeal ?? 25;

    if (decision.recommendation === 'recommend') {
      if (ctx.goalType === 'muscle_gain' && totalProtein >= highProtein) {
        return t('decision.advice.goodProtein', {}, locale);
      }
      return t('decision.advice.balanced', {}, locale);
    }

    if (decision.recommendation === 'avoid') {
      if (decision.reason?.includes('⚠️')) {
        return t('decision.advice.switch', {}, locale);
      }
      const remaining = ctx.remainingCalories - totalCalories;
      if (remaining < -(th?.overBudgetMargin ?? 100)) {
        const excessCal = Math.abs(Math.round(remaining));
        // 量化：附带超出热量，如 "建议减少份量至70%（超出230kcal）"
        const excessSuffix =
          locale === 'en-US'
            ? ` (over by ${excessCal}kcal)`
            : locale === 'ja-JP'
              ? `（${excessCal}kcal超過）`
              : `（超出 ${excessCal}kcal）`;
        return (
          t(
            'decision.advice.reducePortion',
            {
              percent: String(
                Math.max(
                  30,
                  Math.round((ctx.remainingCalories / totalCalories) * 100),
                ),
              ),
            },
            locale,
          ) + excessSuffix
        );
      }
      return t('decision.advice.switch', {}, locale);
    }

    // caution
    const tips: string[] = [];
    if (
      ctx.goalType === 'fat_loss' &&
      totalProtein < lowProtein &&
      totalCalories > significantCal
    ) {
      // 量化：附带当前蛋白质克数，如 "建议补充蛋白质（当前 8g）"
      const proteinQuantSuffix =
        locale === 'en-US'
          ? ` (current: ${Math.round(totalProtein)}g)`
          : locale === 'ja-JP'
            ? `（現在 ${Math.round(totalProtein)}g）`
            : `（当前 ${Math.round(totalProtein)}g）`;
      tips.push(
        t('decision.advice.addProtein', {}, locale) + proteinQuantSuffix,
      );
    }
    if (ctx.remainingCalories - totalCalories < 0) {
      tips.push(t('decision.advice.halfPortion', {}, locale));
    }
    if (
      totalFat != null &&
      totalFat > highFat &&
      ctx.goalFat > 0 &&
      (ctx.todayFat + totalFat) / ctx.goalFat > (th?.fatExcessRatio ?? 1)
    ) {
      tips.push(t('decision.advice.reduceFat', {}, locale));
    }
    if (
      totalCarbs != null &&
      ctx.goalCarbs > 0 &&
      (ctx.todayCarbs + totalCarbs) / ctx.goalCarbs >
        (th?.carbExcessRatio ?? 1.1) &&
      ctx.goalType === 'fat_loss'
    ) {
      tips.push(t('decision.advice.reduceCarbs', {}, locale));
    }
    if (tips.length === 0) {
      tips.push(t('decision.advice.controlOther', {}, locale));
    }
    return tips.join('，');
  }
}
