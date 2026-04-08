/**
 * 食物库种子数据
 * 数据参考中国食物成分表（China Food Composition Tables）
 * 运行方式: ts-node -r tsconfig-paths/register src/scripts/seed-foods.ts
 *
 * 也可以通过 NestJS CLI 运行:
 * npx nestjs-command seed:foods
 */

export interface SeedFood {
  name: string;
  aliases?: string;
  category: string;
  subCategory?: string;
  foodGroup?: string;

  // ═══ 宏量营养素 per 100g ═══
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  fiber?: number;
  sugar?: number;
  saturatedFat?: number;
  transFat?: number;
  cholesterol?: number;

  // ═══ 矿物质 per 100g ═══
  sodium?: number;
  potassium?: number;
  calcium?: number;
  iron?: number;
  zinc?: number;
  magnesium?: number;

  // ═══ 维生素 per 100g ═══
  vitaminA?: number;   // μg RAE
  vitaminC?: number;   // mg
  vitaminD?: number;   // μg
  vitaminE?: number;   // mg
  vitaminB12?: number; // μg
  folate?: number;     // μg

  // ═══ 健康指标 ═══
  glycemicIndex?: number;
  glycemicLoad?: number;
  isProcessed?: boolean;
  isFried?: boolean;
  processingLevel?: number; // NOVA 1-4
  allergens?: string[];

  // ═══ 评分 ═══
  qualityScore?: number;
  satietyScore?: number;
  nutrientDensity?: number;

  // ═══ 行为 ═══
  mealTypes?: string[];
  mainIngredient?: string;
  compatibility?: Record<string, string[]>;

  // ═══ 份量 ═══
  standardServingG: number;
  standardServingDesc: string;
  commonPortions?: Array<{ name: string; grams: number }>;

  // ═══ 元数据 ═══
  searchWeight: number;
  tags?: string[];
  primarySource?: string;
  confidence?: number;
}

/**
 * 中文分类 → 英文标准分类码映射
 * 基于 GLOBAL_FOOD_DATABASE_DESIGN.md §2.2
 */
const CATEGORY_ZH_TO_EN: Record<string, string> = {
  '主食': 'grain',
  '肉类': 'protein',
  '蔬菜': 'veggie',
  '豆制品': 'protein',
  '水果': 'fruit',
  '汤类': 'composite',
  '饮品': 'beverage',
  '零食': 'snack',
  '快餐': 'composite',
  '调味料': 'condiment',
};

/**
 * 根据营养数据自动推导 tags（英文标准标签）
 * 标签体系参考 GLOBAL_FOOD_DATABASE_DESIGN.md §2.4 / 附录B
 */
function deriveTags(food: Omit<SeedFood, 'tags'>): string[] {
  const tags: string[] = [];
  const p = food.protein ?? 0;
  const f = food.fat ?? 0;
  const c = food.carbs ?? 0;
  const cal = food.calories;
  const fib = food.fiber ?? 0;
  const sug = food.sugar ?? 0;
  const sod = food.sodium ?? 0;
  const sf = food.saturatedFat ?? 0;
  const tf = food.transFat ?? 0;

  // ═══ 营养特征标签 ═══
  if (p >= 20) tags.push('high_protein');
  if (f <= 3) tags.push('low_fat');
  if (c <= 5) tags.push('low_carb');
  if (fib >= 6) tags.push('high_fiber');
  if (cal <= 100) tags.push('low_calorie');
  if (sod <= 120) tags.push('low_sodium');
  if (sug <= 5 && cal > 0) tags.push('low_sugar');
  if (food.glycemicIndex !== undefined && food.glycemicIndex <= 55) tags.push('low_gi');

  // ═══ 目标适配标签 ═══
  if (p >= 20 && f <= 10) tags.push('muscle_gain');
  if (cal <= 150 && fib >= 3) tags.push('weight_loss');
  if (c <= 10 && f >= 10) tags.push('keto');
  if (['veggie', 'fruit', 'grain'].includes(food.category) &&
    !food.allergens?.includes('dairy') && !food.allergens?.includes('egg')) {
    tags.push('vegan');
  }
  if (food.glycemicIndex !== undefined && food.glycemicIndex <= 55 && sug <= 5) {
    tags.push('diabetes_friendly');
  }
  if (sf <= 2 && tf <= 0 && sod <= 300) {
    tags.push('heart_healthy');
  }

  // ═══ 属性标签 ═══
  if ((food.processingLevel ?? 1) === 1) tags.push('natural');
  if ((food.processingLevel ?? 1) <= 2) tags.push('whole_food');

  return [...new Set(tags)];
}

/**
 * 自动推导 isProcessed / isFried / mainIngredient / processingLevel / foodGroup / allergens / commonPortions
 * 注意: 此函数在 category 已从中文转为英文之后调用
 */
function deriveFields(food: SeedFood): SeedFood {
  // 推导 isProcessed
  if (food.isProcessed === undefined) {
    food.isProcessed = food.category === 'composite' || food.category === 'snack'
      || /炸|薯片|辣条|火腿|香肠|方便面|速冻/.test(food.name);
  }

  // 推导 isFried
  if (food.isFried === undefined) {
    food.isFried = /炸|煎饺|锅贴|油条|煎饼|手抓饼|薯条|薯片/.test(food.name);
  }

  // 推导 mainIngredient
  if (!food.mainIngredient) {
    const ingredientMap: [RegExp, string][] = [
      [/鸡|鸡胸|鸡腿|鸡丁|鸡翅|鸡排/, 'chicken'],
      [/猪|猪肉|排骨|猪蹄|红烧肉|回锅肉|肉丝|肉片|叉烧|肉夹馍/, 'pork'],
      [/牛|牛肉|牛排|牛柳|牛腩/, 'beef'],
      [/羊|羊肉/, 'lamb'],
      [/虾|小龙虾|基围虾/, 'shrimp'],
      [/鱼|鲈鱼|水煮鱼|酸菜鱼|烤鱼/, 'fish'],
      [/鸭|烤鸭/, 'duck'],
      [/蛋|鸡蛋|茶叶蛋/, 'egg'],
      [/豆腐|豆浆|豆制品/, 'tofu'],
      [/米饭|糙米|白粥|米粉|米线|粽|炒饭|煲仔/, 'rice'],
      [/面|面条|拉面|拌面|饺|馒头|花卷|包子|烧饼|面包|饼|烧卖/, 'wheat'],
      [/红薯|地瓜/, 'sweet_potato'],
      [/玉米/, 'corn'],
      [/土豆/, 'potato'],
      [/茄子/, 'eggplant'],
      [/西兰花/, 'broccoli'],
      [/黄瓜/, 'cucumber'],
      [/西红柿|番茄/, 'tomato'],
      [/苹果/, 'apple'], [/香蕉/, 'banana'], [/西瓜/, 'watermelon'],
      [/草莓/, 'strawberry'], [/橙/, 'orange'], [/葡萄/, 'grape'],
      [/芒果/, 'mango'], [/火龙果/, 'dragonfruit'],
      [/牛奶|拿铁/, 'milk'], [/咖啡|美式/, 'coffee'],
      [/奶茶/, 'milk_tea'], [/可乐|雪碧/, 'soda'],
      [/酸奶/, 'yogurt'],
    ];
    for (const [re, ingredient] of ingredientMap) {
      if (re.test(food.name)) {
        food.mainIngredient = ingredient;
        break;
      }
    }
  }

  // 推导默认 mealTypes
  if (!food.mealTypes) {
    if (food.category === 'fruit' || food.category === 'snack') {
      food.mealTypes = ['snack'];
    } else if (food.category === 'beverage') {
      food.mealTypes = ['breakfast', 'snack'];
    } else {
      food.mealTypes = ['breakfast', 'lunch', 'dinner'];
    }
  }

  // ═══ 新增推导字段 ═══

  // 推导 processingLevel (NOVA 1-4)
  if (food.processingLevel === undefined) {
    if (food.isFried || food.category === 'composite' || /薯片|辣条|饼干|蛋糕|冰淇淋|巧克力|可乐|雪碧|奶茶|运动饮料/.test(food.name)) {
      food.processingLevel = 4; // 超加工
    } else if (food.isProcessed || /罐头|速冻|腌|卤|酱/.test(food.name)) {
      food.processingLevel = 3; // 加工食品
    } else if (/油|酱油|醋|盐|糖|黄油|面粉/.test(food.name)) {
      food.processingLevel = 2; // 加工烹饪原料
    } else {
      food.processingLevel = 1; // 天然/最低加工
    }
  }

  // 推导 foodGroup (多样性分组)
  if (!food.foodGroup) {
    const groupMap: [RegExp, string][] = [
      [/鸡|鸡胸|鸡腿|鸡丁|鸡翅|鸡排|小鸡|鸡块/, 'poultry'],
      [/猪|排骨|猪蹄|红烧肉|回锅肉|肉丝|肉片|叉烧|肉夹馍|水煮肉/, 'pork'],
      [/牛|牛肉|牛排|牛柳|牛腩/, 'beef'],
      [/羊|羊肉/, 'lamb'],
      [/鸭|烤鸭/, 'poultry'],
      [/虾|小龙虾|基围虾|蟹/, 'seafood'],
      [/鱼|鲈鱼|水煮鱼|酸菜鱼|烤鱼/, 'seafood'],
      [/蛋|鸡蛋|茶叶蛋/, 'egg'],
      [/豆腐|豆浆|豆制品/, 'legume'],
      [/米饭|糙米|白粥|米粉|米线|粽|炒饭|煲仔/, 'grain'],
      [/面|面条|拉面|拌面|饺|馒头|花卷|包子|烧饼|面包|饼|烧卖/, 'grain'],
      [/红薯|地瓜|玉米|土豆/, 'tuber'],
      [/茄|兰花|黄瓜|菜|瓜|芽|椒|藕|木耳|山药|萝卜/, 'vegetable'],
      [/苹果|香蕉|西瓜|草莓|橙|葡萄|芒果|火龙果|桃|猕猴桃|梨|哈密瓜|车厘子|柚|蓝莓/, 'fruit'],
      [/牛奶|酸奶/, 'dairy'],
      [/坚果/, 'nut'],
    ];
    for (const [re, group] of groupMap) {
      if (re.test(food.name)) {
        food.foodGroup = group;
        break;
      }
    }
    if (!food.foodGroup) {
      // 按一级分类兜底
      const catMap: Record<string, string> = {
        grain: 'grain', protein: 'meat', veggie: 'vegetable', dairy: 'dairy',
        fruit: 'fruit', fat: 'fat', composite: 'composite', beverage: 'beverage',
        snack: 'snack', condiment: 'condiment',
      };
      food.foodGroup = catMap[food.category] ?? 'other';
    }
  }

  // 推导 allergens
  if (!food.allergens) {
    const allergens: string[] = [];
    if (/面|馒头|花卷|包子|饺|面条|拉面|面包|饼|烧饼|烧卖|油条|煎饼|粽|蛋糕|饼干|凉皮|螺蛳粉|酸辣粉/.test(food.name)) allergens.push('gluten');
    if (/牛奶|拿铁|酸奶|奶茶|冰淇淋|蛋糕|巧克力|奶油/.test(food.name)) allergens.push('dairy');
    if (/蛋|鸡蛋|茶叶蛋|蛋糕|蛋花/.test(food.name)) allergens.push('egg');
    if (/虾|小龙虾|基围虾|蟹|贝/.test(food.name)) allergens.push('shellfish');
    if (/鱼|鲈鱼/.test(food.name)) allergens.push('fish');
    if (/豆腐|豆浆|豆制品|豆芽|毛豆/.test(food.name)) allergens.push('soy');
    if (/坚果|花生|杏仁|核桃|腰果/.test(food.name)) allergens.push('nuts');
    food.allergens = allergens;
  }

  // 推导 commonPortions (从 standardServing 生成)
  if (!food.commonPortions) {
    const portions: Array<{ name: string; grams: number }> = [];
    portions.push({ name: food.standardServingDesc.replace(/约/g, '≈'), grams: food.standardServingG });
    // 添加半份
    if (food.standardServingG >= 100) {
      portions.push({ name: '半份', grams: Math.round(food.standardServingG / 2) });
    }
    food.commonPortions = portions;
  }

  // 推导 glycemicLoad (GL = GI × 可用碳水 per serving / 100)
  if (food.glycemicLoad === undefined && food.glycemicIndex !== undefined && food.carbs !== undefined) {
    const availableCarbs = (food.carbs - (food.fiber ?? 0)) * food.standardServingG / 100;
    food.glycemicLoad = Math.round(food.glycemicIndex * availableCarbs / 100 * 10) / 10;
  }

  // 推导简易 nutrientDensity (基于 NRF 简化算法)
  if (food.nutrientDensity === undefined) {
    const p = food.protein ?? 0;
    const fib = food.fiber ?? 0;
    const cal = food.calories || 1;
    // 简化公式: (protein + fiber + vitC_est) / calories * 100 - (saturatedFat + sugar + sodium_g) / calories * 100
    const positive = (p + fib * 2) / cal * 100;
    const negative = ((food.saturatedFat ?? food.fat ?? 0) * 0.3 + (food.sugar ?? 0) * 0.5 + (food.sodium ?? 0) / 1000) / cal * 100;
    food.nutrientDensity = Math.round((positive - negative) * 10) / 10;
  }

  return food;
}

export const SEED_FOODS: SeedFood[] = [
  // ===== 主食 (25) =====
  { name: '白米饭', category: '主食', calories: 116, protein: 2.6, fat: 0.3, carbs: 25.6, fiber: 0.3, sugar: 0, saturatedFat: 0.1, cholesterol: 0, sodium: 1, potassium: 29, calcium: 7, iron: 0.3, zinc: 0.92, magnesium: 15, folate: 2, glycemicIndex: 83, subCategory: 'refined_grain', qualityScore: 4, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1碗约200g', searchWeight: 200 },
  { name: '糙米饭', category: '主食', calories: 111, protein: 2.7, fat: 0.8, carbs: 23.0, fiber: 1.6, sugar: 0, saturatedFat: 0.2, cholesterol: 0, sodium: 3, potassium: 79, calcium: 12, iron: 0.5, zinc: 1.2, magnesium: 44, folate: 9, vitaminE: 0.5, glycemicIndex: 56, subCategory: 'whole_grain', qualityScore: 7, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1碗约200g', searchWeight: 130 },
  { name: '馒头', category: '主食', calories: 223, protein: 7.0, fat: 1.1, carbs: 47.0, fiber: 1.3, sugar: 1.5, sodium: 190, glycemicIndex: 88, subCategory: 'refined_grain', qualityScore: 4, satietyScore: 7, mealTypes: ['breakfast', 'lunch', 'dinner'], standardServingG: 80, standardServingDesc: '1个约80g', searchWeight: 180 },
  { name: '花卷', category: '主食', calories: 211, protein: 6.4, fat: 2.6, carbs: 42.0, fiber: 1.0, sugar: 1.0, sodium: 200, glycemicIndex: 85, subCategory: 'refined_grain', qualityScore: 4, satietyScore: 6, mealTypes: ['breakfast', 'lunch'], standardServingG: 80, standardServingDesc: '1个约80g', searchWeight: 120 },
  { name: '包子（猪肉）', aliases: '肉包子,猪肉包', category: '主食', calories: 211, protein: 9.5, fat: 7.1, carbs: 26.6, fiber: 0.8, sugar: 1.0, sodium: 350, glycemicIndex: 72, subCategory: 'stuffed', qualityScore: 5, satietyScore: 7, mealTypes: ['breakfast', 'lunch'], standardServingG: 90, standardServingDesc: '1个约90g', searchWeight: 170 },
  { name: '水饺（猪肉白菜）', aliases: '饺子,水饺', category: '主食', calories: 203, protein: 8.5, fat: 8.0, carbs: 24.5, fiber: 1.0, sugar: 0.5, sodium: 380, glycemicIndex: 68, subCategory: 'stuffed', qualityScore: 5, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '10个约200g', searchWeight: 175 },
  { name: '煎饺', aliases: '锅贴', category: '主食', calories: 252, protein: 8.0, fat: 12.5, carbs: 26.0, fiber: 0.8, sugar: 0.5, sodium: 400, glycemicIndex: 72, isFried: true, subCategory: 'stuffed', qualityScore: 3, satietyScore: 7, mealTypes: ['breakfast', 'lunch'], standardServingG: 200, standardServingDesc: '10个约200g', searchWeight: 140 },
  { name: '煮面条', aliases: '面条,挂面,汤面', category: '主食', calories: 110, protein: 3.6, fat: 0.6, carbs: 23.0, fiber: 0.8, sugar: 0.5, sodium: 5, glycemicIndex: 81, subCategory: 'refined_grain', qualityScore: 4, satietyScore: 6, mealTypes: ['breakfast', 'lunch', 'dinner'], standardServingG: 250, standardServingDesc: '1碗约250g（熟）', searchWeight: 170 },
  { name: '米粉（煮熟）', aliases: '河粉,粉丝', category: '主食', calories: 109, protein: 2.0, fat: 0.2, carbs: 25.0, fiber: 0.3, sugar: 0, sodium: 3, glycemicIndex: 83, subCategory: 'refined_grain', qualityScore: 3, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 250, standardServingDesc: '1碗约250g', searchWeight: 140 },
  { name: '白粥', aliases: '大米粥,稀饭', category: '主食', calories: 46, protein: 0.8, fat: 0.1, carbs: 10.1, fiber: 0.1, sugar: 0, sodium: 2, glycemicIndex: 78, subCategory: 'refined_grain', qualityScore: 3, satietyScore: 3, mealTypes: ['breakfast'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 160 },
  { name: '油条', category: '主食', calories: 386, protein: 6.9, fat: 17.6, carbs: 50.1, fiber: 0.5, sugar: 1.0, sodium: 580, glycemicIndex: 75, isFried: true, subCategory: 'fried', qualityScore: 2, satietyScore: 5, mealTypes: ['breakfast'], standardServingG: 80, standardServingDesc: '1根约80g', searchWeight: 160 },
  { name: '烧饼', category: '主食', calories: 326, protein: 8.3, fat: 8.4, carbs: 55.0, fiber: 1.0, sugar: 2.0, sodium: 450, glycemicIndex: 73, subCategory: 'baked', qualityScore: 3, satietyScore: 7, mealTypes: ['breakfast'], standardServingG: 70, standardServingDesc: '1个约70g', searchWeight: 130 },
  { name: '米线（煮熟）', aliases: '过桥米线', category: '主食', calories: 92, protein: 1.5, fat: 0.1, carbs: 21.0, fiber: 0.2, sugar: 0, sodium: 5, glycemicIndex: 82, subCategory: 'refined_grain', qualityScore: 3, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 145 },
  { name: '螺蛳粉', category: '主食', calories: 126, protein: 4.0, fat: 3.5, carbs: 20.0, fiber: 1.0, sugar: 1.0, sodium: 800, glycemicIndex: 70, isProcessed: true, subCategory: 'noodle', qualityScore: 3, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 400, standardServingDesc: '1份约400g（含汤）', searchWeight: 155 },
  { name: '炒饭（蛋炒饭）', aliases: '蛋炒饭', category: '主食', calories: 178, protein: 5.2, fat: 6.5, carbs: 24.8, fiber: 0.3, sugar: 0.5, sodium: 350, glycemicIndex: 80, subCategory: 'fried_rice', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 190 },
  { name: '拉面', aliases: '兰州拉面', category: '主食', calories: 115, protein: 4.0, fat: 1.5, carbs: 22.0, fiber: 0.5, sugar: 0.5, sodium: 400, glycemicIndex: 75, subCategory: 'noodle', qualityScore: 4, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 400, standardServingDesc: '1碗约400g（含汤）', searchWeight: 160 },
  { name: '煎饼果子', category: '主食', calories: 225, protein: 7.0, fat: 10.0, carbs: 28.0, fiber: 0.5, sugar: 1.0, sodium: 420, glycemicIndex: 72, isFried: true, subCategory: 'fried', qualityScore: 3, satietyScore: 6, mealTypes: ['breakfast'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 150 },
  { name: '手抓饼', category: '主食', calories: 280, protein: 5.5, fat: 12.0, carbs: 38.0, fiber: 0.5, sugar: 1.0, sodium: 380, glycemicIndex: 75, isFried: true, subCategory: 'fried', qualityScore: 3, satietyScore: 6, mealTypes: ['breakfast'], standardServingG: 120, standardServingDesc: '1个约120g', searchWeight: 140 },
  { name: '烧卖', category: '主食', calories: 215, protein: 8.0, fat: 8.0, carbs: 27.0, fiber: 0.5, sugar: 0.5, sodium: 350, glycemicIndex: 70, subCategory: 'stuffed', qualityScore: 4, satietyScore: 7, mealTypes: ['breakfast', 'lunch'], standardServingG: 120, standardServingDesc: '4个约120g', searchWeight: 130 },
  { name: '粽子（猪肉）', aliases: '肉粽', category: '主食', calories: 195, protein: 6.0, fat: 5.5, carbs: 31.0, fiber: 0.8, sugar: 0.5, sodium: 300, glycemicIndex: 72, subCategory: 'stuffed', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 150, standardServingDesc: '1个约150g', searchWeight: 130 },
  { name: '全麦面包', aliases: '吐司,全麦吐司', category: '主食', calories: 246, protein: 8.5, fat: 3.5, carbs: 44.8, fiber: 5.0, sugar: 4.0, saturatedFat: 0.8, cholesterol: 0, sodium: 450, potassium: 185, calcium: 52, iron: 2.5, zinc: 1.5, magnesium: 55, folate: 28, vitaminE: 0.4, glycemicIndex: 51, subCategory: 'whole_grain', qualityScore: 7, satietyScore: 6, mealTypes: ['breakfast', 'snack'], standardServingG: 60, standardServingDesc: '2片约60g', searchWeight: 150, allergens: ['gluten'] },
  { name: '红薯（蒸）', aliases: '地瓜,番薯', category: '主食', calories: 86, protein: 1.6, fat: 0.1, carbs: 20.1, fiber: 2.3, sugar: 6.5, saturatedFat: 0, cholesterol: 0, sodium: 28, potassium: 337, calcium: 23, iron: 0.5, zinc: 0.15, magnesium: 12, vitaminA: 709, vitaminC: 26, folate: 6, glycemicIndex: 55, subCategory: 'tuber', foodGroup: 'tuber', qualityScore: 7, satietyScore: 7, mealTypes: ['breakfast', 'lunch', 'snack'], standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 145 },
  { name: '玉米（煮）', aliases: '煮玉米', category: '主食', calories: 112, protein: 4.0, fat: 1.2, carbs: 22.8, fiber: 2.9, sugar: 3.2, saturatedFat: 0.2, cholesterol: 0, sodium: 15, potassium: 218, calcium: 4, iron: 0.5, zinc: 0.6, magnesium: 32, vitaminA: 11, vitaminC: 5.5, folate: 46, glycemicIndex: 55, subCategory: 'whole_grain', foodGroup: 'tuber', qualityScore: 7, satietyScore: 7, mealTypes: ['breakfast', 'lunch', 'snack'], standardServingG: 200, standardServingDesc: '1根约200g', searchWeight: 140 },
  { name: '小笼包', aliases: '灌汤包', category: '主食', calories: 220, protein: 10.0, fat: 8.5, carbs: 25.0, fiber: 0.5, sugar: 1.0, sodium: 380, glycemicIndex: 68, subCategory: 'stuffed', qualityScore: 5, satietyScore: 7, mealTypes: ['breakfast', 'lunch'], standardServingG: 120, standardServingDesc: '6个约120g', searchWeight: 155 },
  { name: '凉皮', aliases: '陕西凉皮', category: '主食', calories: 117, protein: 3.5, fat: 2.0, carbs: 21.5, fiber: 0.3, sugar: 1.5, sodium: 400, glycemicIndex: 72, subCategory: 'noodle', qualityScore: 3, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 140 },

  // ===== 肉类/海鲜 (35) =====
  { name: '宫保鸡丁', aliases: '宫爆鸡丁', category: '肉类', calories: 197, protein: 15.0, fat: 12.0, carbs: 7.0, fiber: 1.0, sugar: 3.0, sodium: 600, subCategory: 'poultry_dish', qualityScore: 5, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 200 },
  { name: '鸡胸肉（水煮）', aliases: '白煮鸡胸,水煮鸡胸肉', category: '肉类', calories: 133, protein: 31.0, fat: 1.2, carbs: 0, fiber: 0, sugar: 0, saturatedFat: 0.3, transFat: 0, cholesterol: 85, sodium: 74, potassium: 256, calcium: 11, iron: 0.7, zinc: 0.9, magnesium: 29, vitaminB12: 0.3, folate: 4, subCategory: 'lean_meat', foodGroup: 'poultry', qualityScore: 9, satietyScore: 8, mealTypes: ['lunch', 'dinner'], standardServingG: 150, standardServingDesc: '1块约150g', searchWeight: 195 },
  { name: '红烧肉', aliases: '东坡肉', category: '肉类', calories: 356, protein: 11.0, fat: 32.0, carbs: 6.0, fiber: 0, sugar: 4.0, saturatedFat: 12.5, transFat: 0.2, cholesterol: 85, sodium: 680, potassium: 200, calcium: 6, iron: 1.5, zinc: 2.0, magnesium: 12, vitaminB12: 0.6, subCategory: 'fatty_meat', foodGroup: 'pork', qualityScore: 3, satietyScore: 8, mealTypes: ['lunch', 'dinner'], standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 185 },
  { name: '水煮鱼', aliases: '水煮鱼片', category: '肉类', calories: 143, protein: 16.0, fat: 8.0, carbs: 1.5, fiber: 0.5, sugar: 0.5, sodium: 700, subCategory: 'fish_dish', qualityScore: 5, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1份约300g（含汤）', searchWeight: 180 },
  { name: '回锅肉', category: '肉类', calories: 270, protein: 12.0, fat: 22.0, carbs: 5.0, fiber: 0.5, sugar: 2.0, sodium: 650, subCategory: 'fatty_meat', qualityScore: 3, satietyScore: 8, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 175 },
  { name: '糖醋排骨', aliases: '糖醋小排', category: '肉类', calories: 245, protein: 13.0, fat: 14.0, carbs: 16.0, fiber: 0, sugar: 12.0, sodium: 500, subCategory: 'pork_dish', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 170 },
  { name: '红烧排骨', category: '肉类', calories: 268, protein: 16.0, fat: 20.0, carbs: 5.0, fiber: 0, sugar: 3.0, sodium: 580, subCategory: 'pork_dish', qualityScore: 4, satietyScore: 8, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 165 },
  { name: '鱼香肉丝', category: '肉类', calories: 186, protein: 12.0, fat: 11.0, carbs: 10.0, fiber: 1.0, sugar: 5.0, sodium: 620, subCategory: 'pork_dish', qualityScore: 5, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 175 },
  { name: '清蒸鱼', aliases: '清蒸鲈鱼,蒸鱼', category: '肉类', calories: 105, protein: 18.0, fat: 3.5, carbs: 0.5, fiber: 0, sugar: 0, saturatedFat: 0.8, cholesterol: 55, sodium: 300, potassium: 350, calcium: 18, iron: 0.3, zinc: 0.5, magnesium: 30, vitaminD: 11, vitaminB12: 2.5, subCategory: 'lean_fish', foodGroup: 'seafood', qualityScore: 9, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 250, standardServingDesc: '1份约250g', searchWeight: 155, allergens: ['fish'] },
  { name: '白切鸡', aliases: '白斩鸡', category: '肉类', calories: 167, protein: 19.0, fat: 9.5, carbs: 0.5, fiber: 0, sugar: 0, sodium: 350, subCategory: 'poultry_dish', qualityScore: 7, satietyScore: 8, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '半只约200g', searchWeight: 155 },
  { name: '烤鸡腿', aliases: '烤鸡', category: '肉类', calories: 190, protein: 20.0, fat: 11.0, carbs: 2.0, fiber: 0, sugar: 0.5, sodium: 400, subCategory: 'poultry_dish', qualityScore: 6, satietyScore: 8, mealTypes: ['lunch', 'dinner'], standardServingG: 150, standardServingDesc: '1个约150g', searchWeight: 160 },
  { name: '北京烤鸭', aliases: '烤鸭', category: '肉类', calories: 240, protein: 16.0, fat: 18.0, carbs: 3.0, fiber: 0, sugar: 2.0, sodium: 500, subCategory: 'fatty_meat', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 170 },
  { name: '酸菜鱼', category: '肉类', calories: 120, protein: 14.0, fat: 6.0, carbs: 2.0, fiber: 0.5, sugar: 0.5, sodium: 650, subCategory: 'fish_dish', qualityScore: 5, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 350, standardServingDesc: '1份约350g（含汤）', searchWeight: 170 },
  { name: '红烧牛肉', aliases: '牛腩', category: '肉类', calories: 193, protein: 22.0, fat: 10.0, carbs: 3.0, fiber: 0, sugar: 2.0, sodium: 550, subCategory: 'beef_dish', qualityScore: 6, satietyScore: 9, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 165 },
  { name: '牛排（煎，七分熟）', aliases: '牛排', category: '肉类', calories: 211, protein: 27.0, fat: 11.0, carbs: 0, fiber: 0, sugar: 0, saturatedFat: 4.3, transFat: 0.4, cholesterol: 75, sodium: 60, potassium: 318, calcium: 7, iron: 2.6, zinc: 4.8, magnesium: 22, vitaminB12: 2.1, subCategory: 'lean_meat', foodGroup: 'beef', qualityScore: 8, satietyScore: 9, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1块约200g', searchWeight: 160 },
  { name: '水煮虾', aliases: '白灼虾,基围虾', category: '肉类', calories: 93, protein: 18.6, fat: 1.5, carbs: 0.8, fiber: 0, sugar: 0, saturatedFat: 0.3, cholesterol: 150, sodium: 300, potassium: 185, calcium: 62, iron: 0.5, zinc: 1.6, magnesium: 35, vitaminB12: 1.1, vitaminE: 2.8, subCategory: 'seafood', foodGroup: 'seafood', qualityScore: 9, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 150, standardServingDesc: '1份约150g（去壳）', searchWeight: 150, allergens: ['shellfish'] },
  { name: '红烧茄子', category: '蔬菜', calories: 95, protein: 1.5, fat: 6.0, carbs: 9.0, fiber: 2.5, sugar: 3.0, sodium: 450, subCategory: 'cooked_veg', qualityScore: 5, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 145 },
  { name: '辣子鸡', aliases: '辣子鸡丁', category: '肉类', calories: 238, protein: 16.0, fat: 16.0, carbs: 8.0, fiber: 1.0, sugar: 2.0, sodium: 700, isFried: true, subCategory: 'poultry_dish', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 155 },
  { name: '可乐鸡翅', category: '肉类', calories: 198, protein: 16.0, fat: 10.0, carbs: 10.0, fiber: 0, sugar: 8.0, sodium: 480, subCategory: 'poultry_dish', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 150 },
  { name: '咕噜肉', aliases: '甜酸肉,咕咾肉', category: '肉类', calories: 235, protein: 10.0, fat: 14.0, carbs: 17.0, fiber: 0.5, sugar: 12.0, sodium: 500, isFried: true, subCategory: 'pork_dish', qualityScore: 3, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 140 },
  { name: '麻婆豆腐', category: '豆制品', calories: 97, protein: 7.5, fat: 5.5, carbs: 4.5, fiber: 0.5, sugar: 1.0, saturatedFat: 0.8, cholesterol: 5, sodium: 550, potassium: 150, calcium: 138, iron: 1.5, zinc: 0.8, magnesium: 30, subCategory: 'tofu_dish', qualityScore: 6, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 175, allergens: ['soy'] },
  { name: '炸鸡块', aliases: '炸鸡,炸鸡腿', category: '肉类', calories: 280, protein: 16.0, fat: 18.0, carbs: 12.0, fiber: 0, sugar: 0.5, sodium: 700, isFried: true, isProcessed: true, subCategory: 'fried_meat', qualityScore: 2, satietyScore: 6, mealTypes: ['lunch', 'dinner', 'snack'], standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 170 },
  { name: '水煮肉片', category: '肉类', calories: 182, protein: 14.0, fat: 12.0, carbs: 4.5, fiber: 1.0, sugar: 1.0, sodium: 700, subCategory: 'pork_dish', qualityScore: 5, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1份约300g（含汤）', searchWeight: 160 },
  { name: '京酱肉丝', category: '肉类', calories: 195, protein: 14.0, fat: 12.0, carbs: 8.0, fiber: 0.5, sugar: 5.0, sodium: 650, subCategory: 'pork_dish', qualityScore: 5, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 140 },
  { name: '蒜泥白肉', category: '肉类', calories: 260, protein: 14.0, fat: 22.0, carbs: 2.0, fiber: 0, sugar: 1.0, sodium: 500, subCategory: 'fatty_meat', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 130 },
  { name: '铁板牛柳', category: '肉类', calories: 180, protein: 18.0, fat: 10.0, carbs: 5.0, fiber: 0.5, sugar: 2.0, sodium: 500, subCategory: 'beef_dish', qualityScore: 6, satietyScore: 8, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 140 },
  { name: '烤羊肉串', aliases: '羊肉串', category: '肉类', calories: 206, protein: 18.0, fat: 14.0, carbs: 1.5, fiber: 0, sugar: 0.5, sodium: 600, subCategory: 'grilled_meat', qualityScore: 4, satietyScore: 7, mealTypes: ['dinner', 'snack'], standardServingG: 100, standardServingDesc: '5串约100g', searchWeight: 155 },
  { name: '小龙虾（麻辣）', aliases: '麻辣小龙虾', category: '肉类', calories: 93, protein: 15.0, fat: 3.0, carbs: 1.0, fiber: 0, sugar: 0.5, sodium: 800, subCategory: 'seafood', qualityScore: 6, satietyScore: 6, mealTypes: ['dinner', 'snack'], standardServingG: 200, standardServingDesc: '1份约200g（去壳）', searchWeight: 165 },
  { name: '烤鱼', category: '肉类', calories: 154, protein: 17.0, fat: 8.5, carbs: 2.5, fiber: 0.5, sugar: 1.0, sodium: 600, subCategory: 'fish_dish', qualityScore: 5, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 155 },
  { name: '猪蹄（卤）', aliases: '卤猪蹄', category: '肉类', calories: 260, protein: 23.0, fat: 18.0, carbs: 1.5, fiber: 0, sugar: 0.5, sodium: 700, subCategory: 'fatty_meat', qualityScore: 4, satietyScore: 9, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 130 },

  // ===== 蔬菜/豆制品 (25) =====
  { name: '西红柿炒鸡蛋', aliases: '番茄炒蛋', category: '蔬菜', calories: 86, protein: 5.0, fat: 5.0, carbs: 5.0, fiber: 0.8, sugar: 3.0, saturatedFat: 1.2, cholesterol: 120, sodium: 350, potassium: 260, calcium: 25, iron: 1.0, vitaminA: 63, vitaminC: 12, folate: 22, subCategory: 'cooked_veg', qualityScore: 7, satietyScore: 6, mealTypes: ['breakfast', 'lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 190 },
  { name: '炒青菜', aliases: '清炒菜心,炒菜心', category: '蔬菜', calories: 45, protein: 1.5, fat: 2.5, carbs: 3.5, fiber: 2.0, sugar: 1.0, sodium: 300, subCategory: 'leafy_veg', qualityScore: 8, satietyScore: 4, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 170 },
  { name: '醋溜土豆丝', aliases: '土豆丝,炒土豆丝', category: '蔬菜', calories: 85, protein: 2.0, fat: 3.5, carbs: 12.0, fiber: 1.5, sugar: 0.5, sodium: 350, subCategory: 'root_veg', qualityScore: 5, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 175 },
  { name: '拍黄瓜', aliases: '凉拌黄瓜', category: '蔬菜', calories: 35, protein: 0.8, fat: 1.5, carbs: 3.5, fiber: 0.8, sugar: 1.5, sodium: 500, subCategory: 'cold_dish', qualityScore: 7, satietyScore: 3, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 160 },
  { name: '地三鲜', category: '蔬菜', calories: 120, protein: 2.5, fat: 8.0, carbs: 10.0, fiber: 2.0, sugar: 2.0, sodium: 400, isFried: true, subCategory: 'cooked_veg', qualityScore: 4, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 150 },
  { name: '干煸四季豆', aliases: '炒四季豆', category: '蔬菜', calories: 95, protein: 3.0, fat: 5.5, carbs: 8.0, fiber: 3.0, sugar: 1.5, sodium: 350, subCategory: 'cooked_veg', qualityScore: 6, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 140 },
  { name: '蒜蓉西兰花', aliases: '炒西兰花', category: '蔬菜', calories: 48, protein: 3.5, fat: 2.0, carbs: 4.0, fiber: 3.3, sugar: 1.0, saturatedFat: 0.3, cholesterol: 0, sodium: 280, potassium: 316, calcium: 67, iron: 0.7, zinc: 0.4, magnesium: 21, vitaminA: 31, vitaminC: 89, vitaminE: 0.8, folate: 63, subCategory: 'leafy_veg', foodGroup: 'vegetable', qualityScore: 9, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 155, compatibility: { goodWith: ['chicken', 'beef', 'rice'], badWith: [] } },
  { name: '凉拌木耳', category: '蔬菜', calories: 42, protein: 1.5, fat: 2.0, carbs: 4.5, fiber: 2.6, sugar: 0.5, sodium: 400, subCategory: 'cold_dish', qualityScore: 7, satietyScore: 4, mealTypes: ['lunch', 'dinner'], standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 130 },
  { name: '炒藕片', aliases: '醋溜藕片', category: '蔬菜', calories: 78, protein: 1.5, fat: 3.0, carbs: 11.0, fiber: 2.0, sugar: 2.0, sodium: 300, subCategory: 'root_veg', qualityScore: 6, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 120 },
  { name: '炒豆芽', aliases: '清炒绿豆芽', category: '蔬菜', calories: 42, protein: 2.5, fat: 2.0, carbs: 3.5, fiber: 1.0, sugar: 0.5, sodium: 280, subCategory: 'leafy_veg', qualityScore: 7, satietyScore: 4, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 120 },
  { name: '皮蛋豆腐', aliases: '凉拌皮蛋', category: '豆制品', calories: 85, protein: 7.0, fat: 5.5, carbs: 2.0, fiber: 0.3, sugar: 0.5, sodium: 450, subCategory: 'tofu_dish', qualityScore: 6, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 140 },
  { name: '家常豆腐', category: '豆制品', calories: 120, protein: 8.0, fat: 7.5, carbs: 5.5, fiber: 0.5, sugar: 1.0, sodium: 500, subCategory: 'tofu_dish', qualityScore: 6, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 145 },
  { name: '蒜蒸茄子', aliases: '蒸茄子', category: '蔬菜', calories: 62, protein: 1.0, fat: 3.5, carbs: 6.5, fiber: 2.5, sugar: 2.5, sodium: 350, subCategory: 'cooked_veg', qualityScore: 6, satietyScore: 4, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 115 },
  { name: '手撕包菜', aliases: '炒包菜', category: '蔬菜', calories: 55, protein: 1.5, fat: 3.0, carbs: 5.0, fiber: 1.5, sugar: 2.0, sodium: 350, subCategory: 'leafy_veg', qualityScore: 7, satietyScore: 4, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 135 },
  { name: '酸辣土豆丝', category: '蔬菜', calories: 88, protein: 2.0, fat: 3.5, carbs: 12.5, fiber: 1.5, sugar: 0.5, sodium: 400, subCategory: 'root_veg', qualityScore: 5, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 160 },
  { name: '虎皮青椒', aliases: '擂椒皮蛋', category: '蔬菜', calories: 65, protein: 1.5, fat: 4.0, carbs: 5.5, fiber: 1.5, sugar: 2.0, sodium: 300, subCategory: 'cooked_veg', qualityScore: 6, satietyScore: 4, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 120 },
  { name: '蒜苗炒肉', aliases: '蒜苔炒肉', category: '蔬菜', calories: 135, protein: 8.0, fat: 8.5, carbs: 6.0, fiber: 1.5, sugar: 1.5, sodium: 400, subCategory: 'cooked_veg', qualityScore: 6, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 130 },
  { name: '清炒山药', aliases: '炒山药', category: '蔬菜', calories: 75, protein: 1.5, fat: 2.5, carbs: 12.0, fiber: 1.0, sugar: 1.0, sodium: 250, subCategory: 'root_veg', qualityScore: 7, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 120 },
  { name: '尖椒干豆腐', aliases: '干豆腐', category: '豆制品', calories: 125, protein: 9.0, fat: 7.5, carbs: 5.5, fiber: 0.5, sugar: 0.5, sodium: 450, subCategory: 'tofu_dish', qualityScore: 6, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 120 },
  { name: '凉拌三丝', category: '蔬菜', calories: 55, protein: 1.5, fat: 2.5, carbs: 6.0, fiber: 1.5, sugar: 1.5, sodium: 400, subCategory: 'cold_dish', qualityScore: 7, satietyScore: 3, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 110 },

  // ===== 汤类 (10) =====
  { name: '西红柿蛋汤', aliases: '番茄蛋花汤', category: '汤类', calories: 28, protein: 1.5, fat: 1.2, carbs: 2.5, fiber: 0.3, sugar: 1.5, sodium: 350, subCategory: 'egg_soup', qualityScore: 6, satietyScore: 3, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 160 },
  { name: '紫菜蛋花汤', category: '汤类', calories: 22, protein: 1.8, fat: 0.8, carbs: 1.8, fiber: 0.5, sugar: 0.5, sodium: 400, subCategory: 'egg_soup', qualityScore: 6, satietyScore: 3, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 145 },
  { name: '排骨汤', aliases: '排骨萝卜汤', category: '汤类', calories: 48, protein: 3.5, fat: 2.5, carbs: 2.5, fiber: 0.5, sugar: 1.0, sodium: 400, subCategory: 'meat_soup', qualityScore: 6, satietyScore: 4, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 140 },
  { name: '冬瓜汤', aliases: '冬瓜排骨汤', category: '汤类', calories: 15, protein: 0.5, fat: 0.3, carbs: 2.5, fiber: 0.5, sugar: 1.0, sodium: 300, subCategory: 'veg_soup', qualityScore: 7, satietyScore: 3, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 120 },
  { name: '豆腐汤', category: '汤类', calories: 32, protein: 2.5, fat: 1.5, carbs: 2.0, fiber: 0.3, sugar: 0.5, sodium: 380, subCategory: 'veg_soup', qualityScore: 6, satietyScore: 3, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 115 },
  { name: '酸辣汤', category: '汤类', calories: 38, protein: 2.0, fat: 1.5, carbs: 4.0, fiber: 0.5, sugar: 1.0, sodium: 500, subCategory: 'veg_soup', qualityScore: 5, satietyScore: 4, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 135 },
  { name: '玉米排骨汤', category: '汤类', calories: 45, protein: 3.0, fat: 2.0, carbs: 3.5, fiber: 0.8, sugar: 1.5, sodium: 350, subCategory: 'meat_soup', qualityScore: 7, satietyScore: 4, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 130 },
  { name: '鸡蛋汤', aliases: '蛋花汤', category: '汤类', calories: 25, protein: 1.5, fat: 1.0, carbs: 2.0, fiber: 0, sugar: 0.5, sodium: 350, subCategory: 'egg_soup', qualityScore: 5, satietyScore: 3, mealTypes: ['breakfast', 'lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 120 },
  { name: '银耳莲子汤', aliases: '银耳汤', category: '汤类', calories: 42, protein: 0.8, fat: 0.2, carbs: 9.5, fiber: 1.5, sugar: 6.0, sodium: 20, subCategory: 'sweet_soup', qualityScore: 6, satietyScore: 3, mealTypes: ['breakfast', 'snack'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 115 },
  { name: '胡辣汤', category: '汤类', calories: 55, protein: 2.5, fat: 2.0, carbs: 7.0, fiber: 0.5, sugar: 1.0, sodium: 600, subCategory: 'spicy_soup', qualityScore: 5, satietyScore: 5, mealTypes: ['breakfast'], standardServingG: 300, standardServingDesc: '1碗约300g', searchWeight: 130 },

  // ===== 快餐/外卖 (20) =====
  { name: '黄焖鸡米饭', aliases: '黄焖鸡', category: '快餐', calories: 145, protein: 8.5, fat: 6.5, carbs: 13.0, fiber: 0.5, sugar: 2.0, sodium: 600, isProcessed: true, subCategory: 'rice_set', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 400, standardServingDesc: '1份约400g（含米饭）', searchWeight: 185 },
  { name: '麻辣烫', aliases: '冒菜', category: '快餐', calories: 88, protein: 4.0, fat: 4.5, carbs: 8.0, fiber: 1.5, sugar: 1.0, sodium: 700, isProcessed: true, subCategory: 'soup_set', qualityScore: 4, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 500, standardServingDesc: '1碗约500g', searchWeight: 185 },
  { name: '沙县炒饭', aliases: '扬州炒饭', category: '快餐', calories: 170, protein: 5.0, fat: 6.0, carbs: 24.0, fiber: 0.3, sugar: 0.5, sodium: 450, isProcessed: true, subCategory: 'fried_rice', qualityScore: 3, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 170 },
  { name: '麦辣鸡腿堡', aliases: '麦当劳鸡腿堡', category: '快餐', calories: 245, protein: 13.0, fat: 12.5, carbs: 21.0, fiber: 1.0, sugar: 3.0, sodium: 650, isProcessed: true, isFried: true, subCategory: 'burger', qualityScore: 2, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 175 },
  { name: '巨无霸', aliases: '麦当劳巨无霸', category: '快餐', calories: 229, protein: 12.5, fat: 11.5, carbs: 19.5, fiber: 1.5, sugar: 3.0, sodium: 500, isProcessed: true, subCategory: 'burger', qualityScore: 3, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 215, standardServingDesc: '1个约215g', searchWeight: 170 },
  { name: '薯条（大份）', aliases: '麦当劳薯条', category: '快餐', calories: 312, protein: 3.4, fat: 15.0, carbs: 41.0, fiber: 3.8, sugar: 0.3, sodium: 280, isProcessed: true, isFried: true, subCategory: 'fried_snack', qualityScore: 1, satietyScore: 4, mealTypes: ['snack'], standardServingG: 150, standardServingDesc: '大份约150g', searchWeight: 165 },
  { name: '烧腊饭（叉烧）', aliases: '叉烧饭', category: '快餐', calories: 160, protein: 8.0, fat: 5.5, carbs: 20.0, fiber: 0.3, sugar: 3.0, sodium: 500, isProcessed: true, subCategory: 'rice_set', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 350, standardServingDesc: '1份约350g', searchWeight: 160 },
  { name: '盖浇饭（鱼香肉丝）', aliases: '鱼香肉丝盖饭', category: '快餐', calories: 155, protein: 7.0, fat: 5.5, carbs: 20.0, fiber: 0.5, sugar: 3.0, sodium: 500, isProcessed: true, subCategory: 'rice_set', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 350, standardServingDesc: '1份约350g', searchWeight: 160 },
  { name: '煲仔饭', aliases: '煲仔饭腊味', category: '快餐', calories: 175, protein: 7.5, fat: 6.0, carbs: 24.0, fiber: 0.3, sugar: 2.0, sodium: 500, isProcessed: true, subCategory: 'rice_set', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 400, standardServingDesc: '1煲约400g', searchWeight: 150 },
  { name: '烤肉拌饭', category: '快餐', calories: 165, protein: 9.0, fat: 6.5, carbs: 18.0, fiber: 0.5, sugar: 2.0, sodium: 450, isProcessed: true, subCategory: 'rice_set', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 350, standardServingDesc: '1份约350g', searchWeight: 150 },
  { name: '鸡排饭', aliases: '大鸡排饭', category: '快餐', calories: 175, protein: 10.0, fat: 7.0, carbs: 18.5, fiber: 0.3, sugar: 1.0, sodium: 500, isProcessed: true, isFried: true, subCategory: 'rice_set', qualityScore: 3, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 350, standardServingDesc: '1份约350g', searchWeight: 155 },
  { name: '沙拉（鸡胸肉）', aliases: '鸡胸沙拉', category: '快餐', calories: 75, protein: 9.0, fat: 2.5, carbs: 5.0, fiber: 2.0, sugar: 2.0, sodium: 300, subCategory: 'salad', qualityScore: 9, satietyScore: 5, mealTypes: ['lunch', 'dinner'], standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 150 },
  { name: '肯德基原味鸡', aliases: 'KFC原味鸡', category: '快餐', calories: 250, protein: 17.0, fat: 15.0, carbs: 11.0, fiber: 0.5, sugar: 0.5, sodium: 700, isProcessed: true, isFried: true, subCategory: 'fried_chicken', qualityScore: 2, satietyScore: 6, mealTypes: ['lunch', 'dinner', 'snack'], standardServingG: 120, standardServingDesc: '1块约120g', searchWeight: 160 },
  { name: '关东煮', aliases: '7-11关东煮', category: '快餐', calories: 55, protein: 4.0, fat: 1.5, carbs: 6.0, fiber: 0.5, sugar: 1.5, sodium: 600, isProcessed: true, subCategory: 'soup_set', qualityScore: 4, satietyScore: 4, mealTypes: ['snack'], standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 130 },
  { name: '兰州牛肉面', aliases: '兰州拉面套餐', category: '快餐', calories: 95, protein: 5.0, fat: 2.5, carbs: 14.0, fiber: 0.5, sugar: 0.5, sodium: 600, isProcessed: true, subCategory: 'noodle_set', qualityScore: 4, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 500, standardServingDesc: '1碗约500g', searchWeight: 160 },
  { name: '沙县拌面', aliases: '沙县小吃拌面', category: '快餐', calories: 145, protein: 4.5, fat: 4.5, carbs: 22.0, fiber: 0.5, sugar: 1.0, sodium: 500, isProcessed: true, subCategory: 'noodle_set', qualityScore: 3, satietyScore: 6, mealTypes: ['lunch', 'dinner'], standardServingG: 250, standardServingDesc: '1碗约250g', searchWeight: 140 },
  { name: '酸辣粉', category: '快餐', calories: 98, protein: 2.5, fat: 3.5, carbs: 15.0, fiber: 0.5, sugar: 1.0, sodium: 700, isProcessed: true, subCategory: 'noodle_set', qualityScore: 3, satietyScore: 5, mealTypes: ['lunch', 'dinner', 'snack'], standardServingG: 400, standardServingDesc: '1碗约400g', searchWeight: 155 },
  { name: '炸酱面', category: '快餐', calories: 145, protein: 6.0, fat: 5.0, carbs: 19.0, fiber: 0.8, sugar: 2.0, sodium: 550, isProcessed: true, subCategory: 'noodle_set', qualityScore: 4, satietyScore: 7, mealTypes: ['lunch', 'dinner'], standardServingG: 350, standardServingDesc: '1碗约350g', searchWeight: 145 },
  { name: '肉夹馍', aliases: '腊汁肉夹馍', category: '快餐', calories: 233, protein: 10.0, fat: 9.0, carbs: 28.0, fiber: 0.5, sugar: 1.0, sodium: 500, isProcessed: true, subCategory: 'sandwich', qualityScore: 4, satietyScore: 7, mealTypes: ['breakfast', 'lunch'], standardServingG: 150, standardServingDesc: '1个约150g', searchWeight: 155 },
  { name: '卷饼（鸡肉）', aliases: '鸡肉卷', category: '快餐', calories: 195, protein: 11.0, fat: 7.5, carbs: 21.0, fiber: 1.0, sugar: 2.0, sodium: 500, isProcessed: true, subCategory: 'sandwich', qualityScore: 4, satietyScore: 6, mealTypes: ['breakfast', 'lunch'], standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 135 },

  // ===== 水果 (15) =====
  { name: '苹果', category: '水果', calories: 52, protein: 0.3, fat: 0.2, carbs: 13.5, fiber: 2.4, sugar: 10.4, saturatedFat: 0, cholesterol: 0, sodium: 1, potassium: 107, calcium: 6, iron: 0.1, zinc: 0.04, magnesium: 5, vitaminC: 4.6, vitaminE: 0.2, folate: 3, glycemicIndex: 36, subCategory: 'fresh_fruit', foodGroup: 'fruit', qualityScore: 8, satietyScore: 4, mealTypes: ['snack'], standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 180 },
  { name: '香蕉', category: '水果', calories: 93, protein: 1.4, fat: 0.2, carbs: 22.0, fiber: 2.6, sugar: 12.2, saturatedFat: 0.1, cholesterol: 0, sodium: 1, potassium: 358, calcium: 5, iron: 0.3, zinc: 0.15, magnesium: 27, vitaminC: 8.7, vitaminB12: 0, folate: 20, glycemicIndex: 51, subCategory: 'fresh_fruit', foodGroup: 'fruit', qualityScore: 7, satietyScore: 5, mealTypes: ['breakfast', 'snack'], standardServingG: 120, standardServingDesc: '1根约120g（去皮）', searchWeight: 175 },
  { name: '西瓜', category: '水果', calories: 31, protein: 0.5, fat: 0.1, carbs: 7.1, fiber: 0.4, sugar: 6.2, sodium: 1, glycemicIndex: 72, subCategory: 'fresh_fruit', qualityScore: 6, satietyScore: 2, mealTypes: ['snack'], standardServingG: 300, standardServingDesc: '1块约300g', searchWeight: 170 },
  { name: '草莓', category: '水果', calories: 32, protein: 1.0, fat: 0.2, carbs: 7.1, fiber: 2.0, sugar: 4.9, saturatedFat: 0, cholesterol: 0, sodium: 1, potassium: 153, calcium: 16, iron: 0.4, zinc: 0.14, magnesium: 13, vitaminC: 58.8, folate: 24, glycemicIndex: 25, subCategory: 'berry', foodGroup: 'fruit', qualityScore: 9, satietyScore: 3, mealTypes: ['snack'], standardServingG: 150, standardServingDesc: '8颗约150g', searchWeight: 150 },
  { name: '橙子', category: '水果', calories: 48, protein: 0.8, fat: 0.2, carbs: 11.1, fiber: 2.3, sugar: 9.4, sodium: 0, glycemicIndex: 42, subCategory: 'citrus', qualityScore: 8, satietyScore: 4, mealTypes: ['snack'], standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 155 },
  { name: '葡萄', category: '水果', calories: 45, protein: 0.5, fat: 0.2, carbs: 10.3, fiber: 0.9, sugar: 8.1, sodium: 2, glycemicIndex: 46, subCategory: 'fresh_fruit', qualityScore: 7, satietyScore: 3, mealTypes: ['snack'], standardServingG: 200, standardServingDesc: '1小份约200g', searchWeight: 140 },
  { name: '芒果', category: '水果', calories: 65, protein: 0.6, fat: 0.3, carbs: 15.0, fiber: 1.6, sugar: 13.7, sodium: 1, glycemicIndex: 51, subCategory: 'tropical', qualityScore: 7, satietyScore: 3, mealTypes: ['snack'], standardServingG: 200, standardServingDesc: '1个约200g（去皮）', searchWeight: 150 },
  { name: '火龙果', category: '水果', calories: 55, protein: 1.1, fat: 0.2, carbs: 13.3, fiber: 1.9, sugar: 8.0, sodium: 1, glycemicIndex: 48, subCategory: 'tropical', qualityScore: 7, satietyScore: 3, mealTypes: ['snack'], standardServingG: 200, standardServingDesc: '半个约200g', searchWeight: 140 },
  { name: '桃子', category: '水果', calories: 48, protein: 0.9, fat: 0.1, carbs: 11.0, fiber: 1.5, sugar: 8.4, sodium: 0, glycemicIndex: 42, subCategory: 'fresh_fruit', qualityScore: 7, satietyScore: 3, mealTypes: ['snack'], standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 130 },
  { name: '猕猴桃', aliases: '奇异果', category: '水果', calories: 56, protein: 0.8, fat: 0.6, carbs: 11.9, fiber: 3.0, sugar: 9.0, saturatedFat: 0, cholesterol: 0, sodium: 3, potassium: 312, calcium: 34, iron: 0.3, zinc: 0.14, magnesium: 17, vitaminC: 92.7, vitaminE: 1.5, folate: 25, glycemicIndex: 39, subCategory: 'fresh_fruit', foodGroup: 'fruit', qualityScore: 9, satietyScore: 4, mealTypes: ['snack'], standardServingG: 100, standardServingDesc: '1个约100g', searchWeight: 140 },
  { name: '梨', category: '水果', calories: 50, protein: 0.1, fat: 0.1, carbs: 12.0, fiber: 3.1, sugar: 9.8, sodium: 1, glycemicIndex: 38, subCategory: 'fresh_fruit', qualityScore: 7, satietyScore: 3, mealTypes: ['snack'], standardServingG: 200, standardServingDesc: '1个约200g', searchWeight: 125 },
  { name: '哈密瓜', category: '水果', calories: 34, protein: 0.5, fat: 0.1, carbs: 7.9, fiber: 0.9, sugar: 6.0, sodium: 18, glycemicIndex: 65, subCategory: 'melon', qualityScore: 6, satietyScore: 2, mealTypes: ['snack'], standardServingG: 200, standardServingDesc: '1块约200g', searchWeight: 125 },
  { name: '车厘子', aliases: '樱桃', category: '水果', calories: 46, protein: 1.1, fat: 0.2, carbs: 10.2, fiber: 2.1, sugar: 8.0, sodium: 0, glycemicIndex: 22, subCategory: 'berry', qualityScore: 8, satietyScore: 3, mealTypes: ['snack'], standardServingG: 150, standardServingDesc: '1小份约150g', searchWeight: 140 },
  { name: '柚子', category: '水果', calories: 42, protein: 0.8, fat: 0.2, carbs: 9.5, fiber: 1.6, sugar: 7.0, sodium: 1, glycemicIndex: 25, subCategory: 'citrus', qualityScore: 8, satietyScore: 4, mealTypes: ['snack'], standardServingG: 200, standardServingDesc: '几瓣约200g', searchWeight: 130 },
  { name: '蓝莓', category: '水果', calories: 57, protein: 0.7, fat: 0.3, carbs: 14.5, fiber: 2.4, sugar: 10.0, sodium: 1, glycemicIndex: 25, subCategory: 'berry', qualityScore: 9, satietyScore: 3, mealTypes: ['snack'], standardServingG: 100, standardServingDesc: '1盒约100g', searchWeight: 135 },

  // ===== 饮品 (15) =====
  { name: '珍珠奶茶（正常糖）', aliases: '奶茶,珍珠奶茶', category: '饮品', calories: 70, protein: 1.0, fat: 2.0, carbs: 12.0, fiber: 0, sugar: 10.0, sodium: 30, isProcessed: true, subCategory: 'sweet_drink', qualityScore: 1, satietyScore: 2, mealTypes: ['snack'], standardServingG: 500, standardServingDesc: '1杯约500ml', searchWeight: 195 },
  { name: '美式咖啡（无糖）', aliases: '美式,黑咖啡', category: '饮品', calories: 2, protein: 0.1, fat: 0, carbs: 0.3, fiber: 0, sugar: 0, sodium: 5, subCategory: 'coffee', qualityScore: 7, satietyScore: 1, mealTypes: ['breakfast', 'snack'], standardServingG: 360, standardServingDesc: '1杯约360ml', searchWeight: 160 },
  { name: '拿铁咖啡', aliases: '拿铁,热拿铁', category: '饮品', calories: 40, protein: 2.0, fat: 1.5, carbs: 4.5, fiber: 0, sugar: 4.0, sodium: 40, subCategory: 'coffee', qualityScore: 5, satietyScore: 2, mealTypes: ['breakfast', 'snack'], standardServingG: 360, standardServingDesc: '1杯约360ml', searchWeight: 165 },
  { name: '可口可乐', aliases: '可乐', category: '饮品', calories: 43, protein: 0, fat: 0, carbs: 10.6, fiber: 0, sugar: 10.6, sodium: 5, isProcessed: true, subCategory: 'soda', qualityScore: 1, satietyScore: 1, mealTypes: ['snack'], standardServingG: 330, standardServingDesc: '1罐330ml', searchWeight: 175 },
  { name: '全脂牛奶', aliases: '牛奶,纯牛奶', category: '饮品', calories: 65, protein: 3.0, fat: 3.6, carbs: 5.0, fiber: 0, sugar: 5.0, saturatedFat: 2.3, cholesterol: 14, sodium: 40, potassium: 132, calcium: 104, iron: 0.1, zinc: 0.4, magnesium: 10, vitaminA: 46, vitaminD: 1.0, vitaminB12: 0.4, subCategory: 'dairy', foodGroup: 'dairy', qualityScore: 7, satietyScore: 3, mealTypes: ['breakfast', 'snack'], standardServingG: 250, standardServingDesc: '1盒约250ml', searchWeight: 170, allergens: ['dairy'] },
  { name: '低脂牛奶', aliases: '脱脂牛奶', category: '饮品', calories: 42, protein: 3.4, fat: 1.0, carbs: 5.0, fiber: 0, sugar: 5.0, sodium: 45, subCategory: 'dairy', qualityScore: 8, satietyScore: 3, mealTypes: ['breakfast', 'snack'], standardServingG: 250, standardServingDesc: '1盒约250ml', searchWeight: 140 },
  { name: '豆浆（无糖）', aliases: '豆浆', category: '饮品', calories: 31, protein: 2.9, fat: 1.2, carbs: 1.8, fiber: 0.8, sugar: 0, saturatedFat: 0.2, cholesterol: 0, sodium: 5, potassium: 118, calcium: 10, iron: 0.5, zinc: 0.3, magnesium: 18, folate: 18, subCategory: 'soy', foodGroup: 'legume', qualityScore: 8, satietyScore: 3, mealTypes: ['breakfast'], standardServingG: 300, standardServingDesc: '1碗约300ml', searchWeight: 155, allergens: ['soy'] },
  { name: '橙汁（鲜榨）', aliases: '橙汁,果汁', category: '饮品', calories: 45, protein: 0.7, fat: 0.2, carbs: 10.5, fiber: 0.2, sugar: 8.4, sodium: 1, subCategory: 'juice', qualityScore: 5, satietyScore: 2, mealTypes: ['breakfast', 'snack'], standardServingG: 300, standardServingDesc: '1杯约300ml', searchWeight: 140 },
  { name: '酸奶（原味）', aliases: '酸奶', category: '饮品', calories: 72, protein: 3.1, fat: 2.7, carbs: 9.0, fiber: 0, sugar: 4.7, saturatedFat: 1.7, cholesterol: 10, sodium: 50, potassium: 141, calcium: 110, iron: 0.1, zinc: 0.4, magnesium: 11, vitaminA: 22, vitaminD: 0.6, vitaminB12: 0.5, subCategory: 'dairy', foodGroup: 'dairy', qualityScore: 7, satietyScore: 3, mealTypes: ['breakfast', 'snack'], standardServingG: 200, standardServingDesc: '1杯约200g', searchWeight: 155, allergens: ['dairy'] },
  { name: '雪碧', aliases: '七喜', category: '饮品', calories: 41, protein: 0, fat: 0, carbs: 10.2, fiber: 0, sugar: 10.2, sodium: 15, isProcessed: true, subCategory: 'soda', qualityScore: 1, satietyScore: 1, mealTypes: ['snack'], standardServingG: 330, standardServingDesc: '1罐330ml', searchWeight: 140 },
  { name: '红茶（无糖）', aliases: '冰红茶', category: '饮品', calories: 1, protein: 0, fat: 0, carbs: 0.2, fiber: 0, sugar: 0, sodium: 3, subCategory: 'tea', qualityScore: 7, satietyScore: 1, mealTypes: ['breakfast', 'snack'], standardServingG: 300, standardServingDesc: '1杯约300ml', searchWeight: 115 },
  { name: '啤酒', category: '饮品', calories: 43, protein: 0.4, fat: 0, carbs: 3.4, fiber: 0, sugar: 0, sodium: 10, subCategory: 'alcohol', qualityScore: 2, satietyScore: 1, mealTypes: ['dinner'], standardServingG: 500, standardServingDesc: '1瓶约500ml', searchWeight: 155 },
  { name: '红酒', aliases: '葡萄酒', category: '饮品', calories: 83, protein: 0.1, fat: 0, carbs: 2.6, fiber: 0, sugar: 0.6, sodium: 5, subCategory: 'alcohol', qualityScore: 3, satietyScore: 1, mealTypes: ['dinner'], standardServingG: 150, standardServingDesc: '1杯约150ml', searchWeight: 130 },
  { name: '椰子水', category: '饮品', calories: 19, protein: 0.7, fat: 0.2, carbs: 3.7, fiber: 1.1, sugar: 2.6, sodium: 105, subCategory: 'natural_drink', qualityScore: 7, satietyScore: 1, mealTypes: ['snack'], standardServingG: 330, standardServingDesc: '1瓶约330ml', searchWeight: 120 },
  { name: '运动饮料', aliases: '脉动,佳得乐', category: '饮品', calories: 26, protein: 0, fat: 0, carbs: 6.4, fiber: 0, sugar: 5.8, sodium: 45, isProcessed: true, subCategory: 'sports_drink', qualityScore: 3, satietyScore: 1, mealTypes: ['snack'], standardServingG: 500, standardServingDesc: '1瓶约500ml', searchWeight: 120 },

  // ===== 零食/其他 (10) =====
  { name: '鸡蛋（煮）', aliases: '水煮蛋,白煮蛋', category: '零食', calories: 144, protein: 13.3, fat: 8.8, carbs: 2.8, fiber: 0, sugar: 0.4, saturatedFat: 2.8, cholesterol: 373, sodium: 124, potassium: 126, calcium: 50, iron: 1.2, zinc: 1.1, magnesium: 10, vitaminA: 140, vitaminD: 2.0, vitaminB12: 1.1, vitaminE: 1.1, folate: 44, subCategory: 'healthy_snack', foodGroup: 'egg', qualityScore: 9, satietyScore: 7, mealTypes: ['breakfast', 'snack'], standardServingG: 60, standardServingDesc: '1个约60g', searchWeight: 185, allergens: ['egg'] },
  { name: '茶叶蛋', category: '零食', calories: 144, protein: 13.0, fat: 8.8, carbs: 3.0, fiber: 0, sugar: 0.5, sodium: 350, subCategory: 'healthy_snack', qualityScore: 7, satietyScore: 7, mealTypes: ['breakfast', 'snack'], standardServingG: 60, standardServingDesc: '1个约60g', searchWeight: 150 },
  { name: '薯片', aliases: '乐事薯片', category: '零食', calories: 540, protein: 5.0, fat: 35.0, carbs: 52.0, fiber: 3.0, sugar: 0.5, sodium: 600, isProcessed: true, isFried: true, subCategory: 'junk_food', qualityScore: 1, satietyScore: 2, mealTypes: ['snack'], standardServingG: 40, standardServingDesc: '小份约40g', searchWeight: 160 },
  { name: '坚果（混合）', aliases: '每日坚果,坚果', category: '零食', calories: 580, protein: 17.0, fat: 50.0, carbs: 18.0, fiber: 6.0, sugar: 4.0, saturatedFat: 6.5, cholesterol: 0, sodium: 5, potassium: 620, calcium: 135, iron: 3.0, zinc: 3.2, magnesium: 200, vitaminE: 15.0, folate: 30, subCategory: 'healthy_snack', foodGroup: 'nut', qualityScore: 7, satietyScore: 5, mealTypes: ['snack'], standardServingG: 25, standardServingDesc: '1小袋约25g', searchWeight: 155, allergens: ['nuts'] },
  { name: '巧克力', aliases: '德芙巧克力', category: '零食', calories: 545, protein: 4.8, fat: 31.0, carbs: 60.0, fiber: 3.4, sugar: 48.0, sodium: 24, isProcessed: true, subCategory: 'sweets', qualityScore: 2, satietyScore: 3, mealTypes: ['snack'], standardServingG: 40, standardServingDesc: '1排约40g', searchWeight: 140 },
  { name: '辣条', aliases: '卫龙辣条', category: '零食', calories: 420, protein: 12.0, fat: 22.0, carbs: 42.0, fiber: 1.0, sugar: 5.0, sodium: 2000, isProcessed: true, subCategory: 'junk_food', qualityScore: 1, satietyScore: 3, mealTypes: ['snack'], standardServingG: 100, standardServingDesc: '1包约100g', searchWeight: 150 },
  { name: '面包（奶油）', aliases: '奶油面包', category: '零食', calories: 313, protein: 7.0, fat: 9.0, carbs: 50.0, fiber: 1.5, sugar: 15.0, sodium: 350, isProcessed: true, subCategory: 'bakery', qualityScore: 2, satietyScore: 4, mealTypes: ['breakfast', 'snack'], standardServingG: 80, standardServingDesc: '1个约80g', searchWeight: 135 },
  { name: '蛋糕（奶油）', aliases: '生日蛋糕', category: '零食', calories: 348, protein: 5.5, fat: 17.0, carbs: 43.0, fiber: 0.5, sugar: 25.0, sodium: 300, isProcessed: true, subCategory: 'bakery', qualityScore: 1, satietyScore: 3, mealTypes: ['snack'], standardServingG: 100, standardServingDesc: '1块约100g', searchWeight: 140 },
  { name: '冰淇淋', aliases: '雪糕', category: '零食', calories: 207, protein: 3.5, fat: 11.0, carbs: 23.5, fiber: 0.5, sugar: 21.0, sodium: 80, isProcessed: true, subCategory: 'frozen', qualityScore: 1, satietyScore: 2, mealTypes: ['snack'], standardServingG: 80, standardServingDesc: '1个约80g', searchWeight: 145 },
  { name: '饼干（苏打）', aliases: '苏打饼干', category: '零食', calories: 408, protein: 8.0, fat: 8.5, carbs: 75.0, fiber: 2.0, sugar: 3.0, sodium: 800, isProcessed: true, subCategory: 'biscuit', qualityScore: 2, satietyScore: 3, mealTypes: ['snack'], standardServingG: 30, standardServingDesc: '4块约30g', searchWeight: 120 },
].map(food => {
  // 将中文分类转换为英文标准编码
  const normalizedFood = {
    ...food,
    category: CATEGORY_ZH_TO_EN[food.category] ?? food.category,
  };
  const derived = deriveFields(normalizedFood);
  return {
    ...derived,
    tags: deriveTags(derived),
    primarySource: derived.primarySource ?? ('official' as const),
    confidence: derived.confidence ?? 0.95,
  };
});
