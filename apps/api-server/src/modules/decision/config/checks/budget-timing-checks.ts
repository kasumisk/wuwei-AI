/**
 * V4.7 P2.1 — 营养宏量 & 时段检查
 *
 * 从 decision-checks.ts 拆分：热量/蛋白质/脂肪/碳水/深夜进食
 */
import {
  DietIssue,
  NutritionTotals,
  UnifiedUserContext,
} from '../../types/analysis-result.types';
import { cl } from '../../i18n/decision-labels';
import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { UserThresholds } from '../dynamic-thresholds.service';
import type { CheckResult } from '../decision-checks';

/**
 * 热量超标检查
 * V2.2: overBudgetMargin 改为动态阈值（原 -100kcal）
 */
export function checkCalorieOverrun(
  totals: NutritionTotals,
  ctx: Pick<UnifiedUserContext, 'remainingCalories'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult | null {
  const remainingAfter = ctx.remainingCalories - totals.calories;
  const margin = thresholds?.overBudgetMargin ?? 100;

  if (remainingAfter < -margin) {
    const excess = Math.abs(Math.round(remainingAfter));
    return {
      triggered: true,
      severity: 'critical',
      reason: cl('check.overBudget', locale, { amount: excess }),
      issue: {
        category: 'calorie_excess',
        severity: 'critical',
        message: cl('check.overBudget', locale, { amount: excess }),
        data: {
          excess,
          mealCalories: Math.round(totals.calories),
          remaining: Math.round(ctx.remainingCalories),
        },
      },
    };
  }

  if (remainingAfter < 0) {
    return {
      triggered: true,
      severity: 'warning',
      reason: cl('check.nearLimit', locale),
      issue: {
        category: 'calorie_excess',
        severity: 'warning',
        message: cl('check.nearLimit', locale),
        data: {
          excess: Math.abs(Math.round(remainingAfter)),
          mealCalories: Math.round(totals.calories),
        },
      },
    };
  }

  return null;
}

/**
 * 蛋白质不足检查
 * V2.2: 15g → thresholds.lowProteinMeal, 300kcal → thresholds.significantMealCal
 */
export function checkProteinDeficit(
  totals: NutritionTotals,
  ctx: Pick<UnifiedUserContext, 'goalType'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult | null {
  const lowProtein = thresholds?.lowProteinMeal ?? 15;
  const significantCal = thresholds?.significantMealCal ?? 300;

  if (
    totals.protein < lowProtein &&
    totals.calories > significantCal &&
    (ctx.goalType === 'fat_loss' || ctx.goalType === 'muscle_gain')
  ) {
    const actual = Math.round(totals.protein);
    const recommended = Math.round(lowProtein);
    const quantSuffix =
      cl('check.quantSuffix', locale, { actual, recommended }) ||
      ` (${actual}g / ${recommended}g)`;
    const msgBase = cl('check.lowProtein', locale);
    return {
      triggered: true,
      severity: ctx.goalType === 'muscle_gain' ? 'critical' : 'warning',
      reason: msgBase + quantSuffix,
      issue: {
        category: 'protein_deficit',
        severity: ctx.goalType === 'muscle_gain' ? 'critical' : 'warning',
        message: msgBase + quantSuffix,
        data: {
          actual,
          recommended,
        },
      },
    };
  }
  return null;
}

/**
 * 脂肪超标检查
 * V2.2: 30g → thresholds.highFatMeal, 130% → thresholds.fatCriticalRatio
 */
export function checkFatExcess(
  totals: NutritionTotals,
  ctx: Pick<UnifiedUserContext, 'goalType' | 'todayFat' | 'goalFat'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult | null {
  const highFat = thresholds?.highFatMeal ?? 30;
  const excessRatio = (thresholds?.fatExcessRatio ?? 1.0) * 100;
  const criticalRatio = (thresholds?.fatCriticalRatio ?? 1.3) * 100;

  const projectedFatPct =
    ctx.goalFat > 0 ? ((ctx.todayFat + totals.fat) / ctx.goalFat) * 100 : 0;

  if (
    totals.fat > highFat &&
    projectedFatPct > excessRatio &&
    (ctx.goalType === 'fat_loss' || ctx.goalType === 'health')
  ) {
    return {
      triggered: true,
      severity: projectedFatPct > criticalRatio ? 'critical' : 'warning',
      reason: cl('check.highFat', locale, {
        fat: Math.round(totals.fat),
        percent: Math.round(projectedFatPct),
      }),
      issue: {
        category: 'fat_excess',
        severity: projectedFatPct > criticalRatio ? 'critical' : 'warning',
        message: cl('check.highFat', locale, {
          fat: Math.round(totals.fat),
          percent: Math.round(projectedFatPct),
        }),
        data: {
          mealFat: Math.round(totals.fat),
          projectedPercent: Math.round(projectedFatPct),
        },
      },
    };
  }
  return null;
}

/**
 * 碳水超标检查
 * V2.2: 110% → thresholds.carbExcessRatio, 130% → thresholds.carbCriticalRatio
 */
export function checkCarbExcess(
  totals: NutritionTotals,
  ctx: Pick<UnifiedUserContext, 'goalType' | 'todayCarbs' | 'goalCarbs'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult | null {
  const excessRatio = (thresholds?.carbExcessRatio ?? 1.1) * 100;
  const criticalRatio = (thresholds?.carbCriticalRatio ?? 1.3) * 100;

  const projectedCarbsPct =
    ctx.goalCarbs > 0
      ? ((ctx.todayCarbs + totals.carbs) / ctx.goalCarbs) * 100
      : 0;

  if (projectedCarbsPct > excessRatio && ctx.goalType === 'fat_loss') {
    return {
      triggered: true,
      severity: projectedCarbsPct > criticalRatio ? 'critical' : 'warning',
      reason: cl('check.highCarbs', locale, { percent: Math.round(projectedCarbsPct) }),
      issue: {
        category: 'carb_excess',
        severity: projectedCarbsPct > criticalRatio ? 'critical' : 'warning',
        message: cl('check.highCarbs', locale, { percent: Math.round(projectedCarbsPct) }),
        data: {
          mealCarbs: Math.round(totals.carbs),
          projectedPercent: Math.round(projectedCarbsPct),
        },
      },
    };
  }
  return null;
}

/**
 * 深夜进食检查
 * V2.2: 时间边界 + 热量门槛均使用动态阈值
 */
export function checkLateNight(
  totals: NutritionTotals,
  ctx: Pick<UnifiedUserContext, 'localHour'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult | null {
  const lateStart = thresholds?.lateNightStart ?? 21;
  const lateEnd = thresholds?.lateNightEnd ?? 5;
  const significantCal = thresholds?.significantMealCal ?? 300;

  if (
    ((ctx.localHour ?? 12) >= lateStart || (ctx.localHour ?? 12) < lateEnd) &&
    totals.calories > significantCal
  ) {
    const calories = Math.round(totals.calories);
    const quantSuffix = ` (${calories}kcal)`;
    const msgBase = cl('check.lateNightHighCal', locale);
    return {
      triggered: true,
      severity: 'warning',
      reason: msgBase + quantSuffix,
      issue: {
        category: 'late_night',
        severity: 'warning',
        message: msgBase + quantSuffix,
        data: { hour: ctx.localHour ?? 12, calories },
      },
    };
  }
  return null;
}
