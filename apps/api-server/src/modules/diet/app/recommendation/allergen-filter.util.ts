import { FoodLibrary } from '../../../food/food.types';

/**
 * V4 Phase 2.4 — 过敏原过滤统一工具 (A6)
 *
 * 将分散在 food-filter / recallCandidates / health-modifier-engine 三处的
 * 过敏原匹配逻辑统一到此处，确保一致性。
 *
 * 匹配规则：精确匹配（大小写敏感）
 * 后续可在此扩展：
 *   - 大小写不敏感
 *   - 别名展开（如 "牛奶" → ["milk", "dairy", "lactose"]）
 *   - 交叉过敏原（如 "虾" → 甲壳类）
 */

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
  return userAllergens.filter((a) => foodAllergens.includes(a));
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
  return userAllergens.some((a) => foodAllergens.includes(a));
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
