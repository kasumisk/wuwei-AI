/**
 * V4.7 P2.1 — 过敏原检查
 *
 * 从 decision-checks.ts 拆分：过敏原冲突检测 + 过敏原展开工具
 */
import { cl } from '../../i18n/decision-labels';
import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import type { CheckResult, CheckableFoodItem } from '../decision-checks';
import type { UnifiedUserContext } from '../../types/analysis-result.types';

/**
 * 过敏原别名展开表（与 allergen-filter.util.ts 保持同步）
 * 将用户画像标准键 → 食物库 allergens[] 中可能出现的等价键
 */
const ALLERGEN_EXPAND_MAP: Record<string, string[]> = {
  gluten: ['gluten', 'wheat'],
  dairy: ['dairy', 'milk', 'lactose'],
  egg: ['egg', 'eggs'],
  fish: ['fish'],
  shellfish: ['shellfish', 'shrimp'],
  tree_nuts: ['tree_nuts', 'tree_nut', 'nuts'],
  peanuts: ['peanuts', 'peanut', 'nuts'],
  soy: ['soy', 'soybeans'],
  sesame: ['sesame'],
  // 兼容旧键
  peanut: ['peanuts', 'peanut', 'nuts'],
  tree_nut: ['tree_nuts', 'tree_nut', 'nuts'],
  milk: ['dairy', 'milk', 'lactose'],
  eggs: ['egg', 'eggs'],
  soybeans: ['soy', 'soybeans'],
  wheat: ['gluten', 'wheat'],
};

export function checkAllergenConflict(
  foods: CheckableFoodItem[],
  ctx: Pick<UnifiedUserContext, 'allergens'>,
  locale?: Locale,
): CheckResult | null {
  if (!ctx.allergens || ctx.allergens.length === 0) return null;

  const matchedAllergen = ctx.allergens.find((userAllergen) => {
    const expandedKeys = ALLERGEN_EXPAND_MAP[userAllergen.toLowerCase()] ?? [
      userAllergen.toLowerCase(),
    ];
    return foods.some(
      (f) =>
        Array.isArray(f.allergens) &&
        f.allergens.some((fa) => expandedKeys.includes(fa.toLowerCase())),
    );
  });

  if (matchedAllergen) {
    return {
      triggered: true,
      severity: 'critical',
      decisionOverride: 'avoid',
      reason: cl('check.allergen', locale).replace(
        '{allergen}',
        matchedAllergen,
      ),
      issue: {
        category: 'allergen',
        severity: 'critical',
        message: cl('check.allergen', locale).replace(
          '{allergen}',
          matchedAllergen,
        ),
        data: { allergen: matchedAllergen },
      },
    };
  }
  return null;
}

// ==================== V4.0: 共享过敏原展开工具 ====================

/**
 * V4.0: 过敏原别名展开映射
 * 从 food-decision.service.ts 提取的共享常量
 */
export const ALLERGEN_EXPAND: Record<string, string[]> = {
  gluten: ['gluten', 'wheat'],
  dairy: ['dairy', 'milk', 'lactose'],
  egg: ['egg', 'eggs'],
  fish: ['fish'],
  shellfish: ['shellfish', 'shrimp'],
  tree_nuts: ['tree_nuts', 'tree_nut', 'nuts'],
  peanuts: ['peanuts', 'peanut', 'nuts'],
  soy: ['soy', 'soybeans'],
  sesame: ['sesame'],
  peanut: ['peanuts', 'peanut', 'nuts'],
  tree_nut: ['tree_nuts', 'tree_nut', 'nuts'],
  milk: ['dairy', 'milk', 'lactose'],
  eggs: ['egg', 'eggs'],
  soybeans: ['soy', 'soybeans'],
  wheat: ['gluten', 'wheat'],
};

/**
 * V4.0: 检查食物列表是否匹配指定过敏原
 */
export function matchAllergenInFoods(
  allergen: string,
  foods: Array<{ allergens?: string[] }>,
): boolean {
  const keys = ALLERGEN_EXPAND[allergen.toLowerCase()] ?? [
    allergen.toLowerCase(),
  ];
  return foods.some(
    (f) =>
      Array.isArray(f.allergens) &&
      f.allergens.some((fa) => keys.includes(fa.toLowerCase())),
  );
}
