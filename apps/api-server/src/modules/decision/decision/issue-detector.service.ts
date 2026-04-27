/**
 * V2.1 Phase 1.4 — 问题检测服务
 *
 * 从 FoodDecisionService 提取：
 * - identifyIssues: 结构化问题识别（8类检查 + actionable 建议）
 * - computeMacroProgress: 宏量营养素进度汇总
 *
 * V2.2: 注入 DynamicThresholdsService，传动态阈值给各 check 函数。
 */
import { Injectable } from '@nestjs/common';
import {
  NutritionTotals,
  DietIssue,
  MacroProgress,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { cl } from '../i18n/decision-labels';
import { getDimensionLabel } from '../config/scoring-dimensions';
import {
  checkCalorieOverrun,
  checkProteinDeficit,
  checkFatExcess,
  checkCarbExcess,
  checkLateNight,
  checkAllergenConflict,
  checkRestrictionConflict,
  checkHealthConditionRisk,
} from '../config/decision-checks';
import { DecisionFoodItem } from './food-decision.service';
import { DynamicThresholdsService } from '../config/dynamic-thresholds.service';

@Injectable()
export class IssueDetectorService {
  constructor(private readonly dynamicThresholds: DynamicThresholdsService) {}

  // ==================== 结构化问题识别 ====================

  identifyIssues(
    foods: DecisionFoodItem[],
    totals: NutritionTotals,
    ctx: UnifiedUserContext,
    breakdown: NutritionScoreBreakdown | undefined,
    locale?: Locale,
  ): DietIssue[] {
    const issues: DietIssue[] = [];
    const thresholds = this.dynamicThresholds.compute(ctx);

    // 共享检查函数（传入动态阈值）
    const checks = [
      checkCalorieOverrun(totals, ctx, locale, thresholds),
      checkProteinDeficit(totals, ctx, locale, thresholds),
      checkFatExcess(totals, ctx, locale, thresholds),
      checkCarbExcess(totals, ctx, locale, thresholds),
      checkLateNight(totals, ctx, locale, thresholds),
      checkAllergenConflict(foods, ctx, locale),
      checkRestrictionConflict(foods, ctx, locale),
    ];
    for (const check of checks) {
      if (check?.triggered && check.issue) {
        issues.push(check.issue);
      }
    }

    // 健康状况检查（返回数组）
    const healthChecks = checkHealthConditionRisk(
      foods,
      ctx,
      locale,
      thresholds,
    );
    for (const check of healthChecks) {
      if (check.triggered && check.issue) {
        issues.push(check.issue);
      }
    }

    // 食物质量低（from breakdown）
    if (breakdown && breakdown.foodQuality < 30) {
      issues.push({
        category: 'low_quality',
        severity: 'warning',
        message: cl('factor.critical', locale, {
          dimension: getDimensionLabel('foodQuality', locale),
          score: Math.round(breakdown.foodQuality),
        }),
        data: { qualityScore: Math.round(breakdown.foodQuality) },
      });
    }

    // actionable 建议
    this.populateActionable(issues, locale);

    // 按严重程度排序：critical > warning > info
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    issues.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
    );

    return issues;
  }

  // ==================== 宏量进度汇总 ====================

  computeMacroProgress(
    currentMealTotals: NutritionTotals,
    ctx: UnifiedUserContext,
  ): MacroProgress {
    const calc = (consumed: number, meal: number, target: number) => ({
      consumed: Math.round(consumed + meal),
      target: Math.round(target),
      percent: target > 0 ? Math.round(((consumed + meal) / target) * 100) : 0,
    });

    return {
      calories: calc(
        ctx.todayCalories,
        currentMealTotals.calories,
        ctx.goalCalories,
      ),
      protein: calc(
        ctx.todayProtein,
        currentMealTotals.protein,
        ctx.goalProtein,
      ),
      fat: calc(ctx.todayFat, currentMealTotals.fat, ctx.goalFat),
      carbs: calc(ctx.todayCarbs, currentMealTotals.carbs, ctx.goalCarbs),
    };
  }

  // ==================== 私有方法 ====================

  private populateActionable(issues: DietIssue[], locale?: Locale): void {
    const actionableCategories = [
      'calorie_excess',
      'protein_deficit',
      'fat_excess',
      'carb_excess',
      'low_quality',
      'cumulative_excess',
      'multi_day_excess',
    ];
    for (const issue of issues) {
      if (actionableCategories.includes(issue.category)) {
        issue.actionable = cl(`actionable.${issue.category}`, locale);
      }
    }
  }
}
