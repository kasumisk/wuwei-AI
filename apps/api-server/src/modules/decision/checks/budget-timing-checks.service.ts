/**
 * Phase 12 — 营养宏量 & 时段检查 Service
 *
 * 从 config/checks/budget-timing-checks.ts 迁移：保持 5 个方法行为不变，
 * 改造为 @Injectable() 通过注入 I18nService 替代 cl()。
 */
import { Injectable } from '@nestjs/common';
import { I18nService, I18nLocale } from '../../../core/i18n';
import {
  NutritionTotals,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import type { CheckResult } from './types';
import { UserThresholds } from '../config/dynamic-thresholds.service';

@Injectable()
export class BudgetTimingChecksService {
  constructor(private readonly i18n: I18nService) {}

  /**
   * 热量超标检查
   * V2.2: overBudgetMargin 改为动态阈值（原 -100kcal）
   */
  checkCalorieOverrun(
    totals: NutritionTotals,
    ctx: Pick<UnifiedUserContext, 'remainingCalories'>,
    locale?: I18nLocale,
    thresholds?: UserThresholds,
  ): CheckResult | null {
    const loc = locale ?? this.i18n.currentLocale();
    const remainingAfter = ctx.remainingCalories - totals.calories;
    const margin = thresholds?.overBudgetMargin ?? 100;

    if (remainingAfter < -margin) {
      const excess = Math.abs(Math.round(remainingAfter));
      const message = this.i18n.t('decision.check.overBudget', loc, {
        amount: excess,
      });
      return {
        triggered: true,
        severity: 'critical',
        reason: message,
        issue: {
          category: 'calorie_excess',
          severity: 'critical',
          message,
          data: {
            excess,
            mealCalories: Math.round(totals.calories),
            remaining: Math.round(ctx.remainingCalories),
          },
        },
      };
    }

    if (remainingAfter < 0) {
      const message = this.i18n.t('decision.check.nearLimit', loc);
      return {
        triggered: true,
        severity: 'warning',
        reason: message,
        issue: {
          category: 'calorie_excess',
          severity: 'warning',
          message,
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
  checkProteinDeficit(
    totals: NutritionTotals,
    ctx: Pick<UnifiedUserContext, 'goalType'>,
    locale?: I18nLocale,
    thresholds?: UserThresholds,
  ): CheckResult | null {
    const loc = locale ?? this.i18n.currentLocale();
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
        this.i18n.t('decision.check.quantSuffix', loc, {
          actual,
          recommended,
        }) || ` (${actual}g / ${recommended}g)`;
      const msgBase = this.i18n.t('decision.check.lowProtein', loc);
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
  checkFatExcess(
    totals: NutritionTotals,
    ctx: Pick<UnifiedUserContext, 'goalType' | 'todayFat' | 'goalFat'>,
    locale?: I18nLocale,
    thresholds?: UserThresholds,
  ): CheckResult | null {
    const loc = locale ?? this.i18n.currentLocale();
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
      const message = this.i18n.t('decision.check.highFat', loc, {
        fat: Math.round(totals.fat),
        percent: Math.round(projectedFatPct),
      });
      return {
        triggered: true,
        severity: projectedFatPct > criticalRatio ? 'critical' : 'warning',
        reason: message,
        issue: {
          category: 'fat_excess',
          severity: projectedFatPct > criticalRatio ? 'critical' : 'warning',
          message,
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
  checkCarbExcess(
    totals: NutritionTotals,
    ctx: Pick<UnifiedUserContext, 'goalType' | 'todayCarbs' | 'goalCarbs'>,
    locale?: I18nLocale,
    thresholds?: UserThresholds,
  ): CheckResult | null {
    const loc = locale ?? this.i18n.currentLocale();
    const excessRatio = (thresholds?.carbExcessRatio ?? 1.1) * 100;
    const criticalRatio = (thresholds?.carbCriticalRatio ?? 1.3) * 100;

    const projectedCarbsPct =
      ctx.goalCarbs > 0
        ? ((ctx.todayCarbs + totals.carbs) / ctx.goalCarbs) * 100
        : 0;

    if (projectedCarbsPct > excessRatio && ctx.goalType === 'fat_loss') {
      const message = this.i18n.t('decision.check.highCarbs', loc, {
        percent: Math.round(projectedCarbsPct),
      });
      return {
        triggered: true,
        severity: projectedCarbsPct > criticalRatio ? 'critical' : 'warning',
        reason: message,
        issue: {
          category: 'carb_excess',
          severity: projectedCarbsPct > criticalRatio ? 'critical' : 'warning',
          message,
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
  checkLateNight(
    totals: NutritionTotals,
    ctx: Pick<UnifiedUserContext, 'localHour'>,
    locale?: I18nLocale,
    thresholds?: UserThresholds,
  ): CheckResult | null {
    const loc = locale ?? this.i18n.currentLocale();
    const lateStart = thresholds?.lateNightStart ?? 21;
    const lateEnd = thresholds?.lateNightEnd ?? 5;
    const significantCal = thresholds?.significantMealCal ?? 300;

    if (
      ((ctx.localHour ?? 12) >= lateStart || (ctx.localHour ?? 12) < lateEnd) &&
      totals.calories > significantCal
    ) {
      const calories = Math.round(totals.calories);
      const quantSuffix = ` (${calories}kcal)`;
      const msgBase = this.i18n.t('decision.check.lateNightHighCal', loc);
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
}
