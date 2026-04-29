/**
 * Phase 12 — 决策检查聚合 Service
 *
 * 从 config/decision-checks.ts 中的 runAllChecks 函数迁移：
 * 聚合 budget-timing + allergen + restriction + health-condition 全部检查，
 * 返回 issues + reasons。
 *
 * 注意：CheckResult / CheckableFoodItem 类型仍在 config/decision-checks.ts
 * 中定义并 export，本 service 仅处理运行时聚合。
 */
import { Injectable } from '@nestjs/common';
import { I18nLocale } from '../../../core/i18n';
import {
  DietIssue,
  NutritionTotals,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import type { CheckResult, CheckableFoodItem } from './types';
import { UserThresholds } from '../config/dynamic-thresholds.service';
import { AllergenChecksService } from './allergen-checks.service';
import { RestrictionChecksService } from './restriction-checks.service';
import { HealthConditionChecksService } from './health-condition-checks.service';
import { BudgetTimingChecksService } from './budget-timing-checks.service';

@Injectable()
export class DecisionChecksAggregatorService {
  constructor(
    private readonly budgetTiming: BudgetTimingChecksService,
    private readonly allergen: AllergenChecksService,
    private readonly restriction: RestrictionChecksService,
    private readonly healthCondition: HealthConditionChecksService,
  ) {}

  /**
   * 运行所有检查并收集结果
   * V2.2: 传递 UserThresholds
   */
  runAll(
    foods: CheckableFoodItem[],
    totals: NutritionTotals,
    ctx: UnifiedUserContext,
    locale?: I18nLocale,
    thresholds?: UserThresholds,
  ): { issues: DietIssue[]; reasons: string[] } {
    const issues: DietIssue[] = [];
    const reasons: string[] = [];

    const checks: Array<CheckResult | null> = [
      this.budgetTiming.checkCalorieOverrun(totals, ctx, locale, thresholds),
      this.budgetTiming.checkProteinDeficit(totals, ctx, locale, thresholds),
      this.budgetTiming.checkFatExcess(totals, ctx, locale, thresholds),
      this.budgetTiming.checkCarbExcess(totals, ctx, locale, thresholds),
      this.budgetTiming.checkLateNight(totals, ctx, locale, thresholds),
      this.allergen.check(foods, ctx, locale),
      this.restriction.check(foods, ctx, locale),
    ];

    // Health condition checks return array
    const healthChecks = this.healthCondition.check(
      foods,
      ctx,
      locale,
      thresholds,
    );

    for (const check of [...checks, ...healthChecks]) {
      if (check?.triggered) {
        if (check.issue) issues.push(check.issue);
        if (check.reason) reasons.push(check.reason);
      }
    }

    return { issues, reasons };
  }
}
