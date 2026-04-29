/**
 * Phase 12 — 饮食限制冲突检查 Service
 *
 * 从 config/checks/restriction-checks.ts 迁移：保持函数行为不变，
 * 改造为 @Injectable() 通过注入 I18nService 替代 cl()。
 */
import { Injectable } from '@nestjs/common';
import { I18nService, I18nLocale } from '../../../core/i18n';
import type { CheckResult, CheckableFoodItem } from './types';
import type { UnifiedUserContext } from '../types/analysis-result.types';
import {
  MEAT_KEYWORDS,
  BEEF_KEYWORDS,
  PORK_KEYWORDS,
  LOW_SODIUM_ALIASES,
} from '../config/condition-aliases';

@Injectable()
export class RestrictionChecksService {
  constructor(private readonly i18n: I18nService) {}

  /**
   * 饮食限制冲突检查（可能强制 avoid）
   *
   * 覆盖全部 7 个枚举：
   *   vegetarian / vegan / no_beef / lactose_free / gluten_free / halal / kosher
   * 外加 low_sodium（钠数值判断）
   */
  check(
    foods: CheckableFoodItem[],
    ctx: Pick<UnifiedUserContext, 'dietaryRestrictions'>,
    locale?: I18nLocale,
  ): CheckResult | null {
    if (!ctx.dietaryRestrictions || ctx.dietaryRestrictions.length === 0)
      return null;

    const loc = locale ?? this.i18n.currentLocale();
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
          const message = this.i18n.t(
            'decision.check.restrictionConflict',
            loc,
          );
          return {
            triggered: true,
            severity: 'critical',
            decisionOverride: 'avoid',
            reason: message,
            issue: {
              category: 'restriction',
              severity: 'critical',
              message,
              data: { restriction: r, food: food.name },
            },
          };
        }
      }
    }

    // low_sodium 单独保留（钠数值判断）
    const isLowSodium = restrictions.some((r) =>
      LOW_SODIUM_ALIASES.includes(r),
    );
    if (isLowSodium) {
      const totalSodium = foods.reduce((s, f) => s + (f.sodium ?? 0), 0);
      if (totalSodium > 800) {
        const message = this.i18n.t('decision.check.restrictionConflict', loc);
        return {
          triggered: true,
          severity: 'warning',
          decisionOverride: 'caution',
          reason: message,
          issue: {
            category: 'restriction',
            severity: 'warning',
            message,
            data: { restriction: 'low_sodium', sodium: totalSodium },
          },
        };
      }
    }

    return null;
  }
}
