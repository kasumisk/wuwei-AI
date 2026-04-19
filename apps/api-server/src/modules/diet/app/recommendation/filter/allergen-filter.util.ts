import { FoodLibrary } from '../../../../food/food.types';

/**
 * V4 Phase 2.4 — 过敏原过滤统一工具 (A6)
 *
 * 将分散在 food-filter / recallCandidates / health-modifier-engine 三处的
 * 过敏原匹配逻辑统一到此处，确保一致性。
 *
 * 匹配规则：
 *   - 先通过别名表展开用户过敏原到食物标签键
 *   - 再进行精确匹配（大小写敏感）
 *
 * ══ 标准过敏原键（与前端 ALLERGEN_OPTIONS 及数据补全字段完全一致）══
 *   gluten / dairy / egg / fish / shellfish / tree_nuts / peanuts / soy / sesame
 *
 * 兼容旧键映射（历史数据向前兼容，不作为新提交标准）：
 *   peanut   → peanuts
 *   tree_nut → tree_nuts
 *   milk     → dairy
 *   eggs     → egg
 *   soybeans → soy
 *   wheat    → gluten
 */

/** 用户画像过敏原 key → 食物标签 allergen key(s) */
const ALLERGEN_ALIAS_MAP: Record<string, string[]> = {
  // ── 9个标准键（与前端 ALLERGEN_OPTIONS / 数据补全字段一致）──
  gluten: ['gluten', 'wheat'],
  dairy: ['dairy', 'milk', 'lactose'],
  egg: ['egg', 'eggs'],
  fish: ['fish'],
  shellfish: ['shellfish', 'shrimp'],
  tree_nuts: ['tree_nuts', 'tree_nut', 'nuts'],
  peanuts: ['peanuts', 'peanut', 'nuts'],
  soy: ['soy', 'soybeans'],
  sesame: ['sesame'],
  // ── 食物标签侧附加键（用于食物库标签反查）──
  nuts: ['nuts', 'peanut', 'peanuts', 'tree_nut', 'tree_nuts'],
  lactose: ['dairy', 'milk', 'lactose'],
  seafood: ['shellfish', 'shrimp', 'fish', 'seafood'],
  shrimp: ['shrimp', 'shellfish'],
  sulfites: ['sulfites'],
};

/**
 * 将用户过敏原列表展开为食物标签匹配键集合
 */
function expandAllergens(userAllergens: string[]): Set<string> {
  const expanded = new Set<string>();
  for (const a of userAllergens) {
    const aliases = ALLERGEN_ALIAS_MAP[a];
    if (aliases) {
      for (const alias of aliases) expanded.add(alias);
    } else {
      // 未知键保留原样，确保向前兼容
      expanded.add(a);
    }
  }
  return expanded;
}

/**
 * 检查单个食物是否含有任何用户过敏原
 * @returns 匹配到的过敏原列表（空数组 = 安全）
 */
export function matchAllergens(
  food: FoodLibrary,
  userAllergens: string[],
): string[] {
  if (!userAllergens.length) return [];
  const foodAllergens: string[] = food.allergens || [];
  if (!foodAllergens.length) return [];
  const expandedSet = expandAllergens(userAllergens);
  return foodAllergens.filter((a) => expandedSet.has(a));
}

/**
 * 检查单个食物是否含有任何用户过敏原（布尔快捷方式）
 */
export function hasAllergenConflict(
  food: FoodLibrary,
  userAllergens: string[],
): boolean {
  if (!userAllergens.length) return false;
  const foodAllergens: string[] = food.allergens || [];
  if (!foodAllergens.length) return false;
  const expandedSet = expandAllergens(userAllergens);
  return foodAllergens.some((a) => expandedSet.has(a));
}

/**
 * 批量过滤：返回不含过敏原的食物
 */
export function filterByAllergens(
  foods: FoodLibrary[],
  userAllergens?: string[],
): FoodLibrary[] {
  if (!userAllergens?.length) return foods;
  return foods.filter((f) => !hasAllergenConflict(f, userAllergens));
}
