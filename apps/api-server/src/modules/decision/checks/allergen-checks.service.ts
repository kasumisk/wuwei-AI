/**
 * Phase 12 — 过敏原检查 Service
 *
 * 从 config/checks/allergen-checks.ts 迁移：保持函数行为不变，
 * 改造为 @Injectable() 通过注入 I18nService 替代 cl()。
 *
 * 同时保留共享常量 ALLERGEN_EXPAND 和工具函数 matchAllergenInFoods（纯函数 export）。
 */
import { Injectable } from '@nestjs/common';
import { I18nService, I18nLocale } from '../../../core/i18n';
import { translateEnum } from '../../../common/i18n/enum-i18n';
import type { CheckResult, CheckableFoodItem } from './types';
import type { UnifiedUserContext } from '../types/analysis-result.types';
import {
  ALLERGEN_EXPAND,
  collectAllergenMatches,
  matchAllergenInFoods,
} from './allergen-match';

@Injectable()
export class AllergenChecksService {
  constructor(private readonly i18n: I18nService) {}

  getMatches(
    foods: CheckableFoodItem[],
    ctx: Pick<UnifiedUserContext, 'allergens'>,
  ) {
    return collectAllergenMatches(ctx.allergens, foods);
  }

  check(
    foods: CheckableFoodItem[],
    ctx: Pick<UnifiedUserContext, 'allergens'>,
    locale?: I18nLocale,
  ): CheckResult | null {
    const matches = this.getMatches(foods, ctx);
    const match = matches[0];

    if (match) {
      const loc = locale ?? this.i18n.currentLocale();
      const allergenLabel = translateEnum('allergen', match.foodAllergen, loc);
      const detailSeparator = this.i18n.t('decision.separator.list', loc);
      const details = matches.map((item) =>
        this.i18n.t('decision.allergen.matchDetail', loc, {
          food: item.foodName,
          allergen: translateEnum('allergen', item.foodAllergen, loc),
        }),
      );
      const message = this.i18n.t('decision.check.allergen', loc, {
        allergen: allergenLabel,
        food: match.foodName,
        details: details.join(detailSeparator),
      });
      return {
        triggered: true,
        severity: 'critical',
        decisionOverride: 'avoid',
        reason: message,
        issue: {
          category: 'allergen',
          severity: 'critical',
          message,
          data: {
            allergen: allergenLabel,
            allergenCode: match.foodAllergen,
            userAllergenCode: match.userAllergen,
            foodName: match.foodName,
            matchedSummary: details.join(detailSeparator),
          },
        },
      };
    }
    return null;
  }
}

export { ALLERGEN_EXPAND, collectAllergenMatches, matchAllergenInFoods };
