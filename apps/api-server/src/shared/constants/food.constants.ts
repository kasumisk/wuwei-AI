/** 食物分类 (国际化英文编码) */
export const FOOD_CATEGORIES = [
  'protein', 'grain', 'veggie', 'fruit', 'dairy',
  'fat', 'beverage', 'snack', 'condiment', 'composite',
] as const;

/** 二级分类映射 */
export const SUB_CATEGORIES: Record<string, string[]> = {
  protein: ['lean_meat', 'fatty_meat', 'poultry', 'seafood', 'egg', 'legume', 'tofu', 'plant_based'],
  grain: ['whole_grain', 'refined_grain', 'noodle', 'bread', 'rice'],
  veggie: ['leafy_green', 'root', 'cruciferous', 'nightshade', 'mushroom', 'seaweed'],
  fruit: ['berry', 'citrus', 'tropical', 'stone_fruit', 'melon'],
  dairy: ['milk', 'yogurt', 'cheese', 'butter'],
  fat: ['oil', 'nut', 'seed', 'avocado'],
  beverage: ['water', 'tea', 'coffee', 'juice', 'soda', 'alcohol'],
  snack: ['bar', 'chip', 'candy', 'baked', 'dried_fruit'],
  condiment: ['sauce', 'spice', 'dressing', 'sweetener'],
  composite: ['salad', 'soup', 'stew', 'sandwich', 'bowl', 'wrap'],
};

/** 餐次推荐标签策略 */
export const MEAL_PREFERENCES: Record<string, { includeTags: string[]; excludeTags: string[] }> = {
  breakfast: {
    includeTags: ['breakfast', 'light', 'quick', 'whole_grain', 'dairy', 'egg'],
    excludeTags: ['heavy', 'fried', 'spicy', 'alcohol'],
  },
  lunch: {
    includeTags: ['balanced', 'high_protein', 'whole_grain'],
    excludeTags: ['dessert', 'alcohol'],
  },
  dinner: {
    includeTags: ['balanced', 'veggie', 'light_dinner'],
    excludeTags: ['high_sugar', 'caffeine'],
  },
  snack: {
    includeTags: ['snack', 'low_calorie', 'fruit', 'nut', 'yogurt'],
    excludeTags: ['heavy', 'fried', 'alcohol'],
  },
};

/** 地区配置 */
export const REGIONAL_CONFIGS: Record<string, {
  mealRatios: Record<string, number>;
  culturalTags: string[];
}> = {
  CN: {
    mealRatios: { breakfast: 0.25, lunch: 0.40, dinner: 0.30, snack: 0.05 },
    culturalTags: ['chinese', 'rice', 'noodle', 'dim_sum', 'stir_fry'],
  },
  JP: {
    mealRatios: { breakfast: 0.25, lunch: 0.35, dinner: 0.35, snack: 0.05 },
    culturalTags: ['japanese', 'sushi', 'miso', 'ramen', 'bento'],
  },
  US: {
    mealRatios: { breakfast: 0.25, lunch: 0.30, dinner: 0.35, snack: 0.10 },
    culturalTags: ['american', 'sandwich', 'salad', 'burger', 'steak'],
  },
  IN: {
    mealRatios: { breakfast: 0.20, lunch: 0.40, dinner: 0.35, snack: 0.05 },
    culturalTags: ['indian', 'curry', 'dal', 'roti', 'rice'],
  },
};
