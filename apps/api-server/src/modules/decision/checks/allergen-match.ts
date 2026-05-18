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

export interface AllergenFoodMatch {
  userAllergen: string;
  foodAllergen: string;
  foodName: string;
}

export function collectAllergenMatches(
  userAllergens: string[] | undefined,
  foods: Array<{ name: string; allergens?: string[] }>,
): AllergenFoodMatch[] {
  if (!userAllergens?.length) return [];

  const matches: AllergenFoodMatch[] = [];
  const seen = new Set<string>();

  for (const userAllergen of userAllergens) {
    const keys = ALLERGEN_EXPAND[userAllergen.toLowerCase()] ?? [
      userAllergen.toLowerCase(),
    ];
    for (const food of foods) {
      if (!Array.isArray(food.allergens)) continue;
      for (const foodAllergen of food.allergens) {
        if (!keys.includes(foodAllergen.toLowerCase())) continue;
        const dedupeKey = `${userAllergen.toLowerCase()}|${foodAllergen.toLowerCase()}|${food.name}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        matches.push({
          userAllergen,
          foodAllergen,
          foodName: food.name,
        });
      }
    }
  }

  return matches;
}
