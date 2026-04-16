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
import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { DIMENSION_LABELS } from '../config/scoring-dimensions';
import {
  checkCalorieOverrun,
  checkProteinDeficit,
  checkFatExcess,
  checkCarbExcess,
  checkLateNight,
  checkAllergenConflict,
  checkRestrictionConflict,
  checkHealthConditionRisk,
} from './decision-checks';
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
        message: t(
          'decision.factor.critical',
          {
            dimension:
              (DIMENSION_LABELS[locale || 'zh-CN'] || DIMENSION_LABELS['zh-CN'])
                .foodQuality || '食物质量',
            score: String(Math.round(breakdown.foodQuality)),
          },
          locale,
        ),
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
    const actionableMap: Record<
      string,
      { 'zh-CN': string; 'en-US': string; 'ja-JP': string }
    > = {
      calorie_excess: {
        'zh-CN': '减少份量或选择低热量替代',
        'en-US': 'Reduce portion or choose lower-calorie alternative',
        'ja-JP': '量を減らすか低カロリーの代替品を選ぶ',
      },
      protein_deficit: {
        'zh-CN': '添加高蛋白食材（如鸡蛋、鸡胸肉、豆腐）',
        'en-US': 'Add high-protein foods (e.g., eggs, chicken breast, tofu)',
        'ja-JP': '高タンパク食材を追加（卵、鶏胸肉、豆腐など）',
      },
      fat_excess: {
        'zh-CN': '选择少油烹饪方式或减少油脂摄入',
        'en-US': 'Choose low-fat cooking methods or reduce oil intake',
        'ja-JP': '低脂肪の調理法を選ぶか油脂摂取を減らす',
      },
      carb_excess: {
        'zh-CN': '减少主食份量或选择全谷物',
        'en-US': 'Reduce staple portion or choose whole grains',
        'ja-JP': '主食の量を減らすか全粒穀物を選ぶ',
      },
      low_quality: {
        'zh-CN': '增加蔬菜和优质蛋白的比例',
        'en-US': 'Increase proportion of vegetables and quality protein',
        'ja-JP': '野菜と良質なタンパク質の割合を増やす',
      },
      cumulative_excess: {
        'zh-CN': '下一餐适当减量以平衡全天摄入',
        'en-US': 'Reduce next meal to balance daily intake',
        'ja-JP': '次の食事を減らして1日の摂取バランスを取る',
      },
      multi_day_excess: {
        'zh-CN': '连续超标，建议重新规划本周饮食',
        'en-US': 'Multiple days over budget, consider replanning this week',
        'ja-JP': '連日超過、今週の食事を再計画することを推奨',
      },
    };
    const loc = locale || 'zh-CN';
    for (const issue of issues) {
      const entry = actionableMap[issue.category];
      if (entry) {
        issue.actionable = entry[loc] || entry['zh-CN'];
      }
    }
  }
}
