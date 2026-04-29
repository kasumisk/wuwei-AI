/**
 * Phase 12 — 统一冲突报告构建器 Service
 *
 * 从 config/conflict-report-builder.ts 迁移：聚合 allergen / restriction /
 * health-condition 三类检查，统一返回 ConflictReport。
 */
import { Injectable } from '@nestjs/common';
import { I18nLocale } from '../../../core/i18n';
import { ConflictItem, ConflictReport } from '../types/decision.types';
import type { UnifiedUserContext } from '../types/analysis-result.types';
import { UserThresholds } from '../config/dynamic-thresholds.service';
import type { CheckResult, CheckableFoodItem } from './types';
import { AllergenChecksService } from './allergen-checks.service';
import { RestrictionChecksService } from './restriction-checks.service';
import { HealthConditionChecksService } from './health-condition-checks.service';

const SEVERITY_RANK: Record<ConflictItem['severity'], number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

function checkResultToConflictItem(
  check: CheckResult,
  type: ConflictItem['type'],
): ConflictItem {
  return {
    type,
    severity: check.severity,
    decisionOverride: check.decisionOverride,
    message: check.reason ?? '',
    data: check.issue?.data as Record<string, unknown> | undefined,
  };
}

@Injectable()
export class ConflictReportBuilderService {
  constructor(
    private readonly allergenChecks: AllergenChecksService,
    private readonly restrictionChecks: RestrictionChecksService,
    private readonly healthConditionChecks: HealthConditionChecksService,
  ) {}

  /**
   * V4.5: 聚合三类冲突检查，统一返回 ConflictReport。
   *
   * 调用方（decision-engine）可直接消费：
   *   - `report.forceOverride` → 是否强制 avoid/caution
   *   - `report.items`         → 所有冲突条目（已按 severity 降序排列）
   *   - `report.maxSeverity`   → 最高严重等级
   *   - `report.hasConflict`   → 是否存在任何冲突
   */
  build(
    foods: CheckableFoodItem[],
    ctx: Pick<
      UnifiedUserContext,
      'allergens' | 'dietaryRestrictions' | 'healthConditions'
    >,
    locale?: I18nLocale,
    thresholds?: UserThresholds,
  ): ConflictReport {
    const items: ConflictItem[] = [];

    // 1. 过敏原检查
    const allergenCheck = this.allergenChecks.check(foods, ctx, locale);
    if (allergenCheck?.triggered) {
      items.push(checkResultToConflictItem(allergenCheck, 'allergen'));
    }

    // 2. 饮食限制检查
    const restrictionCheck = this.restrictionChecks.check(foods, ctx, locale);
    if (restrictionCheck?.triggered) {
      items.push(checkResultToConflictItem(restrictionCheck, 'restriction'));
    }

    // 3. 健康状况检查（可多条）
    const healthChecks = this.healthConditionChecks.check(
      foods,
      ctx,
      locale,
      thresholds,
    );
    for (const check of healthChecks) {
      if (check.triggered) {
        items.push(checkResultToConflictItem(check, 'health_condition'));
      }
    }

    // 按 severity 降序排列
    items.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

    const maxSeverityItem = items[0];
    const maxSeverity: ConflictReport['maxSeverity'] = maxSeverityItem
      ? maxSeverityItem.severity
      : 'none';

    const forceOverrideItem = items.find((i) => i.decisionOverride);
    const forceOverride = forceOverrideItem?.decisionOverride;

    return {
      hasConflict: items.length > 0,
      maxSeverity,
      forceOverride,
      items,
    };
  }
}
