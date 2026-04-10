import { FoodLibrary } from '../../../food/food.types';

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
 * 用户画像键 (frontend) → 食物标签键 (AI labeling) 映射：
 *   peanut   → nuts       (花生属坚果类)
 *   peanuts  → nuts
 *   tree_nut → nuts       (树坚果属坚果类)
 *   tree_nuts→ nuts
 *   milk     → dairy      (牛奶属乳制品)
 *   eggs     → egg        (复数→单数)
 *   soybeans → soy        (大豆→soy)
 */

/** 用户画像过敏原 key → 食物标签 allergen key(s) */
const ALLERGEN_ALIAS_MAP: Record<string, string[]> = {
  peanut: ['nuts', 'peanut', 'peanuts'],
  peanuts: ['nuts', 'peanut', 'peanuts'],
  tree_nut: ['nuts', 'tree_nut', 'tree_nuts'],
  tree_nuts: ['nuts', 'tree_nut', 'tree_nuts'],
  milk: ['dairy', 'milk', 'lactose'],
  eggs: ['egg', 'eggs'],
  soybeans: ['soy', 'soybeans'],
  // 直通键（无需映射但确保安全）
  gluten: ['gluten'],
  dairy: ['dairy', 'milk', 'lactose'],
  nuts: ['nuts', 'peanut', 'peanuts', 'tree_nut', 'tree_nuts'],
  soy: ['soy', 'soybeans'],
  egg: ['egg', 'eggs'],
  shellfish: ['shellfish'],
  fish: ['fish'],
  wheat: ['wheat', 'gluten'],
  sesame: ['sesame'],
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
