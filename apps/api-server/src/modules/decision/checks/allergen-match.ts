/**
 * 过敏原匹配纯函数 + 别名展开映射
 *
 * V13.4: 从 config/checks/allergen-checks.ts 抽出，作为共享纯函数文件保留。
 * checks/allergen-checks.service.ts 与 food-decision.service.ts 都从这里 import。
 */

/**
 * 过敏原别名展开映射
 * 将用户画像标准键 → 食物库 allergens[] 中可能出现的等价键
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
  // 兼容旧键
  peanut: ['peanuts', 'peanut', 'nuts'],
  tree_nut: ['tree_nuts', 'tree_nut', 'nuts'],
  milk: ['dairy', 'milk', 'lactose'],
  eggs: ['egg', 'eggs'],
  soybeans: ['soy', 'soybeans'],
  wheat: ['gluten', 'wheat'],
};

/**
 * 检查食物列表是否匹配指定过敏原
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
