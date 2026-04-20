/**
 * V4.7 P2.4 — 统一冲突报告构建器
 *
 * 从 decision-checks.ts 提取：buildConflictReport 纯函数
 */
import { ConflictItem, ConflictReport } from '../types/decision.types';
import type { UnifiedUserContext } from '../types/analysis-result.types';
import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { UserThresholds } from './dynamic-thresholds.service';
import type { CheckResult, CheckableFoodItem } from './decision-checks';
import { checkAllergenConflict } from './checks/allergen-checks';
import { checkRestrictionConflict } from './checks/restriction-checks';
import { checkHealthConditionRisk } from './checks/health-condition-checks';

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

/**
 * V4.5: 聚合三类冲突检查，统一返回 ConflictReport。
 *
 * 调用方（decision-engine）可直接消费：
 *   - `report.forceOverride` → 是否强制 avoid/caution
 *   - `report.items`         → 所有冲突条目（已按 severity 降序排列）
 *   - `report.maxSeverity`   → 最高严重等级
 *   - `report.hasConflict`   → 是否存在任何冲突
 */
export function buildConflictReport(
  foods: CheckableFoodItem[],
  ctx: Pick<
    UnifiedUserContext,
    'allergens' | 'dietaryRestrictions' | 'healthConditions'
  >,
  locale?: Locale,
  thresholds?: UserThresholds,
): ConflictReport {
  const items: ConflictItem[] = [];

  // 1. 过敏原检查
  const allergenCheck = checkAllergenConflict(foods, ctx, locale);
  if (allergenCheck?.triggered) {
    items.push(checkResultToConflictItem(allergenCheck, 'allergen'));
  }

  // 2. 饮食限制检查
  const restrictionCheck = checkRestrictionConflict(foods, ctx, locale);
  if (restrictionCheck?.triggered) {
    items.push(checkResultToConflictItem(restrictionCheck, 'restriction'));
  }

  // 3. 健康状况检查（可多条）
  const healthChecks = checkHealthConditionRisk(foods, ctx, locale, thresholds);
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
