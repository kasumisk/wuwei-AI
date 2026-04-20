/**
 * V4.7 P2.1 — 饮食限制冲突检查
 *
 * 从 decision-checks.ts 拆分：7种饮食限制枚举 + low_sodium
 */
import { cl } from '../../i18n/decision-labels';
import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import type { CheckResult, CheckableFoodItem } from '../decision-checks';
import type { UnifiedUserContext } from '../../types/analysis-result.types';
import {
  MEAT_KEYWORDS,
  BEEF_KEYWORDS,
  PORK_KEYWORDS,
  LOW_SODIUM_ALIASES,
} from '../condition-aliases';

/**
 * 饮食限制冲突检查（可能强制 avoid）
 *
 * 覆盖全部 7 个枚举：
 *   vegetarian / vegan / no_beef / lactose_free / gluten_free / halal / kosher
 */
export function checkRestrictionConflict(
  foods: CheckableFoodItem[],
  ctx: Pick<UnifiedUserContext, 'dietaryRestrictions'>,
  locale?: Locale,
): CheckResult | null {
  if (!ctx.dietaryRestrictions || ctx.dietaryRestrictions.length === 0)
    return null;

  const restrictions = ctx.dietaryRestrictions.map((r) => r.toLowerCase());

  for (const food of foods) {
    const name = (food.name || '').toLowerCase();
    const cat = (food.category || '').toLowerCase();
    const allergens: string[] = (food as any).allergens || [];

    for (const r of restrictions) {
      let violated = false;

      if (r === 'vegetarian' || r === 'vegan') {
        if (MEAT_KEYWORDS.some((k) => name.includes(k))) violated = true;
        if (r === 'vegan') {
          if (allergens.some((a) => a === 'dairy' || a === 'egg'))
            violated = true;
          if (cat === 'dairy' || cat === 'egg') violated = true;
        }
      } else if (r === 'no_beef') {
        if (BEEF_KEYWORDS.some((k) => name.includes(k))) violated = true;
        if ((food as any).foodGroup === 'beef') violated = true;
      } else if (r === 'lactose_free') {
        if (
          allergens.some(
            (a) => a === 'dairy' || a === 'milk' || a === 'lactose',
          )
        )
          violated = true;
        if (cat === 'dairy') violated = true;
      } else if (r === 'gluten_free') {
        if (allergens.some((a) => a === 'gluten' || a === 'wheat'))
          violated = true;
      } else if (r === 'halal') {
        if (
          PORK_KEYWORDS.some((k) => name.includes(k)) ||
          name.includes('bacon') ||
          name.includes('ham')
        )
          violated = true;
        if ((food as any).foodGroup === 'pork') violated = true;
      } else if (r === 'kosher') {
        if (PORK_KEYWORDS.some((k) => name.includes(k))) violated = true;
        if ((food as any).foodGroup === 'pork') violated = true;
      }

      if (violated) {
        return {
          triggered: true,
          severity: 'critical',
          decisionOverride: 'avoid',
          reason: cl('check.restrictionConflict', locale),
          issue: {
            category: 'restriction',
            severity: 'critical',
            message: cl('check.restrictionConflict', locale),
            data: { restriction: r, food: food.name },
          },
        };
      }
    }
  }

  // low_sodium 单独保留（钠数值判断）
  const isLowSodium = restrictions.some((r) => LOW_SODIUM_ALIASES.includes(r));
  if (isLowSodium) {
    const totalSodium = foods.reduce((s, f) => s + (f.sodium ?? 0), 0);
    if (totalSodium > 800) {
      return {
        triggered: true,
        severity: 'warning',
        decisionOverride: 'caution',
        reason: cl('check.restrictionConflict', locale),
        issue: {
          category: 'restriction',
          severity: 'warning',
          message: cl('check.restrictionConflict', locale),
          data: { restriction: 'low_sodium', sodium: totalSodium },
        },
      };
    }
  }

  return null;
}
