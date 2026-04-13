/**
 * V7.8 P3-A/P3-B: 食物 & 菜谱翻译种子数据
 *
 * 为核心食物和菜谱提供 en-US 英文翻译。
 * 运行: npx ts-node -r tsconfig-paths/register src/scripts/seeds/seed-translations.ts
 *
 * 幂等操作 — 按 (food_id/recipe_id, locale) 唯一约束 upsert
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

// ==================== P3-A: 食物翻译 ====================

/**
 * 核心食物英文翻译
 *
 * 覆盖 224 个种子食物中最高频的条目（按 searchWeight 降序）
 * 格式: [中文名, 英文名, 英文别名, 英文描述, 英文份量说明]
 */
const FOOD_TRANSLATIONS_EN: Array<{
  zhName: string;
  name: string;
  aliases?: string;
  description?: string;
  servingDesc?: string;
}> = [
  // ─── 主食 ───
  {
    zhName: '白米饭',
    name: 'Steamed White Rice',
    aliases: 'white rice,cooked rice',
    servingDesc: '1 bowl (200g)',
  },
  {
    zhName: '糙米饭',
    name: 'Steamed Brown Rice',
    aliases: 'brown rice',
    servingDesc: '1 bowl (200g)',
  },
  {
    zhName: '馒头',
    name: 'Steamed Bun',
    aliases: 'mantou,Chinese steamed bread',
    servingDesc: '1 bun (100g)',
  },
  {
    zhName: '全麦面包',
    name: 'Whole Wheat Bread',
    aliases: 'whole grain bread',
    servingDesc: '2 slices (80g)',
  },
  { zhName: '白面包', name: 'White Bread', servingDesc: '2 slices (60g)' },
  {
    zhName: '面条',
    name: 'Noodles',
    aliases: 'Chinese noodles,wheat noodles',
    servingDesc: '1 bowl (200g)',
  },
  {
    zhName: '红薯',
    name: 'Sweet Potato',
    aliases: 'yam',
    servingDesc: '1 medium (200g)',
  },
  {
    zhName: '玉米',
    name: 'Corn',
    aliases: 'maize,sweet corn',
    servingDesc: '1 ear (200g)',
  },
  { zhName: '土豆', name: 'Potato', servingDesc: '1 medium (200g)' },
  {
    zhName: '燕麦片',
    name: 'Oatmeal',
    aliases: 'rolled oats',
    servingDesc: '1 bowl (40g dry)',
  },
  {
    zhName: '小米粥',
    name: 'Millet Porridge',
    aliases: 'millet congee',
    servingDesc: '1 bowl (250g)',
  },
  {
    zhName: '白粥',
    name: 'Plain Rice Porridge',
    aliases: 'congee,rice porridge',
    servingDesc: '1 bowl (300g)',
  },
  {
    zhName: '包子',
    name: 'Steamed Stuffed Bun',
    aliases: 'baozi',
    servingDesc: '1 bun (100g)',
  },
  {
    zhName: '饺子',
    name: 'Dumplings',
    aliases: 'jiaozi,Chinese dumplings',
    servingDesc: '10 pieces (200g)',
  },
  {
    zhName: '花卷',
    name: 'Steamed Twisted Roll',
    aliases: 'huajuan',
    servingDesc: '1 roll (80g)',
  },
  {
    zhName: '油条',
    name: 'Deep-fried Dough Stick',
    aliases: 'youtiao,Chinese cruller',
    servingDesc: '1 piece (80g)',
  },
  { zhName: '蛋炒饭', name: 'Egg Fried Rice', servingDesc: '1 plate (300g)' },
  {
    zhName: '扬州炒饭',
    name: 'Yangzhou Fried Rice',
    aliases: 'Yangchow fried rice',
    servingDesc: '1 plate (300g)',
  },
  {
    zhName: '葱花鸡蛋饼',
    name: 'Scallion Egg Pancake',
    servingDesc: '1 piece (120g)',
  },

  // ─── 肉类/蛋白质 ───
  { zhName: '鸡胸肉', name: 'Chicken Breast', servingDesc: '1 piece (150g)' },
  {
    zhName: '鸡蛋',
    name: 'Egg',
    aliases: 'hen egg,chicken egg',
    servingDesc: '1 large (50g)',
  },
  {
    zhName: '茶叶蛋',
    name: 'Tea Egg',
    aliases: 'marbled egg',
    servingDesc: '1 egg (60g)',
  },
  {
    zhName: '番茄炒蛋',
    name: 'Stir-fried Tomato with Eggs',
    aliases: 'tomato egg stir-fry',
    servingDesc: '1 plate (200g)',
  },
  {
    zhName: '宫保鸡丁',
    name: 'Kung Pao Chicken',
    aliases: 'Gong Bao chicken',
    servingDesc: '1 plate (200g)',
  },
  {
    zhName: '红烧肉',
    name: 'Red-braised Pork Belly',
    aliases: 'braised pork belly',
    servingDesc: '1 portion (150g)',
  },
  {
    zhName: '红烧排骨',
    name: 'Red-braised Spare Ribs',
    aliases: 'braised ribs',
    servingDesc: '1 portion (200g)',
  },
  {
    zhName: '糖醋里脊',
    name: 'Sweet and Sour Pork Tenderloin',
    servingDesc: '1 plate (180g)',
  },
  {
    zhName: '鱼香肉丝',
    name: 'Yu-Xiang Shredded Pork',
    aliases: 'fish-flavored pork',
    servingDesc: '1 plate (200g)',
  },
  {
    zhName: '水煮肉片',
    name: 'Sichuan Boiled Pork Slices',
    aliases: 'water-boiled pork',
    servingDesc: '1 portion (250g)',
  },
  {
    zhName: '京酱肉丝',
    name: 'Beijing-style Shredded Pork',
    servingDesc: '1 plate (180g)',
  },
  {
    zhName: '回锅肉',
    name: 'Twice-cooked Pork',
    aliases: 'double-cooked pork',
    servingDesc: '1 plate (200g)',
  },
  {
    zhName: '青椒肉丝',
    name: 'Shredded Pork with Green Pepper',
    servingDesc: '1 plate (200g)',
  },
  {
    zhName: '蒜苔炒肉',
    name: 'Stir-fried Pork with Garlic Scapes',
    servingDesc: '1 plate (200g)',
  },
  {
    zhName: '木须肉',
    name: 'Mu Shu Pork',
    aliases: 'moo shu pork',
    servingDesc: '1 plate (200g)',
  },
  {
    zhName: '可乐鸡翅',
    name: 'Cola Chicken Wings',
    servingDesc: '4-5 wings (150g)',
  },
  {
    zhName: '辣子鸡',
    name: 'Spicy Diced Chicken',
    aliases: 'chili chicken',
    servingDesc: '1 plate (200g)',
  },
  {
    zhName: '香菇滑鸡',
    name: 'Steamed Chicken with Mushroom',
    servingDesc: '1 portion (200g)',
  },
  {
    zhName: '清蒸鲈鱼',
    name: 'Steamed Sea Bass',
    servingDesc: '½ fish (200g)',
  },
  {
    zhName: '水煮鱼',
    name: 'Sichuan Boiled Fish',
    aliases: 'water-boiled fish',
    servingDesc: '1 portion (300g)',
  },
  {
    zhName: '烤鸭',
    name: 'Roast Duck',
    aliases: 'Peking duck',
    servingDesc: '¼ duck (200g)',
  },
  {
    zhName: '小炒黄牛肉',
    name: 'Stir-fried Yellow Cattle Beef',
    servingDesc: '1 plate (180g)',
  },
  {
    zhName: '葱爆羊肉',
    name: 'Scallion-fried Lamb',
    servingDesc: '1 plate (180g)',
  },
  {
    zhName: '油焖大虾',
    name: 'Braised Prawns in Oil',
    servingDesc: '1 plate (200g)',
  },
  { zhName: '猪肝', name: 'Pork Liver', servingDesc: '1 portion (100g)' },
  {
    zhName: '牛腱肉',
    name: 'Beef Shank',
    aliases: 'beef tendon meat',
    servingDesc: '1 portion (100g)',
  },
  {
    zhName: '基围虾',
    name: 'White Shrimp',
    aliases: 'greasyback shrimp',
    servingDesc: '10 shrimp (100g)',
  },

  // ─── 蔬菜 ───
  { zhName: '西蓝花', name: 'Broccoli', servingDesc: '1 cup (150g)' },
  { zhName: '菠菜', name: 'Spinach', servingDesc: '1 bunch (100g)' },
  { zhName: '番茄', name: 'Tomato', servingDesc: '1 medium (150g)' },
  { zhName: '黄瓜', name: 'Cucumber', servingDesc: '1 medium (200g)' },
  { zhName: '胡萝卜', name: 'Carrot', servingDesc: '1 medium (120g)' },
  { zhName: '生菜', name: 'Lettuce', servingDesc: '1 cup (50g)' },
  {
    zhName: '白菜',
    name: 'Chinese Cabbage',
    aliases: 'napa cabbage,wombok',
    servingDesc: '1 cup (150g)',
  },
  {
    zhName: '蒜蓉西兰花',
    name: 'Garlic Broccoli',
    aliases: 'broccoli with garlic',
    servingDesc: '1 plate (150g)',
  },
  {
    zhName: '清炒时蔬',
    name: 'Stir-fried Seasonal Vegetables',
    servingDesc: '1 plate (150g)',
  },
  {
    zhName: '醋溜白菜',
    name: 'Vinegar-fried Cabbage',
    servingDesc: '1 plate (150g)',
  },
  {
    zhName: '干煸四季豆',
    name: 'Dry-fried Green Beans',
    servingDesc: '1 plate (150g)',
  },
  {
    zhName: '地三鲜',
    name: 'Di San Xian',
    aliases: 'fried potato, eggplant and pepper',
    servingDesc: '1 plate (200g)',
  },
  {
    zhName: '红烧茄子',
    name: 'Red-braised Eggplant',
    servingDesc: '1 plate (180g)',
  },
  {
    zhName: '酸辣土豆丝',
    name: 'Hot and Sour Shredded Potato',
    servingDesc: '1 plate (150g)',
  },
  {
    zhName: '凉拌黄瓜',
    name: 'Smashed Cucumber Salad',
    servingDesc: '1 dish (120g)',
  },
  {
    zhName: '手撕包菜',
    name: 'Torn Cabbage Stir-fry',
    servingDesc: '1 plate (150g)',
  },

  // ─── 豆制品 ───
  {
    zhName: '豆腐',
    name: 'Tofu',
    aliases: 'bean curd',
    servingDesc: '1 block (150g)',
  },
  { zhName: '豆浆', name: 'Soy Milk', servingDesc: '1 cup (300ml)' },
  {
    zhName: '家常豆腐',
    name: 'Home-style Tofu',
    aliases: 'braised tofu',
    servingDesc: '1 plate (200g)',
  },
  {
    zhName: '皮蛋豆腐',
    name: 'Century Egg Tofu',
    aliases: 'preserved egg tofu',
    servingDesc: '1 plate (150g)',
  },
  {
    zhName: '麻婆豆腐',
    name: 'Mapo Tofu',
    aliases: 'spicy tofu',
    servingDesc: '1 plate (200g)',
  },

  // ─── 汤类 ───
  {
    zhName: '紫菜蛋花汤',
    name: 'Seaweed Egg Drop Soup',
    servingDesc: '1 bowl (200g)',
  },
  {
    zhName: '冬瓜排骨汤',
    name: 'Winter Melon and Pork Rib Soup',
    servingDesc: '1 bowl (250g)',
  },
  {
    zhName: '西红柿蛋汤',
    name: 'Tomato Egg Soup',
    servingDesc: '1 bowl (200g)',
  },

  // ─── 水果 ───
  { zhName: '苹果', name: 'Apple', servingDesc: '1 medium (200g)' },
  { zhName: '香蕉', name: 'Banana', servingDesc: '1 medium (120g)' },
  { zhName: '橙子', name: 'Orange', servingDesc: '1 medium (200g)' },
  { zhName: '西瓜', name: 'Watermelon', servingDesc: '1 slice (300g)' },
  { zhName: '草莓', name: 'Strawberry', servingDesc: '8 pieces (150g)' },
  { zhName: '葡萄', name: 'Grape', servingDesc: '1 bunch (150g)' },
  {
    zhName: '猕猴桃',
    name: 'Kiwi',
    aliases: 'kiwifruit',
    servingDesc: '1 medium (100g)',
  },
  { zhName: '蓝莓', name: 'Blueberry', servingDesc: '½ cup (75g)' },

  // ─── 乳制品 ───
  {
    zhName: '牛奶',
    name: 'Milk',
    aliases: 'whole milk',
    servingDesc: '1 cup (250ml)',
  },
  {
    zhName: '酸奶',
    name: 'Yogurt',
    aliases: 'plain yogurt',
    servingDesc: '1 cup (150g)',
  },
  {
    zhName: '奶酪',
    name: 'Cheese',
    aliases: 'cheddar cheese',
    servingDesc: '1 slice (30g)',
  },
  { zhName: '希腊酸奶', name: 'Greek Yogurt', servingDesc: '1 cup (150g)' },

  // ─── 饮品 ───
  { zhName: '绿茶', name: 'Green Tea', servingDesc: '1 cup (200ml)' },
  { zhName: '黑咖啡', name: 'Black Coffee', servingDesc: '1 cup (200ml)' },

  // ─── 快餐 ───
  {
    zhName: '汉堡',
    name: 'Hamburger',
    aliases: 'burger',
    servingDesc: '1 burger (200g)',
  },
  {
    zhName: '炸鸡腿',
    name: 'Fried Chicken Drumstick',
    servingDesc: '1 piece (150g)',
  },
  {
    zhName: '薯条',
    name: 'French Fries',
    aliases: 'fries',
    servingDesc: '1 medium (120g)',
  },

  // ─── 零食/坚果 ───
  { zhName: '混合坚果', name: 'Mixed Nuts', servingDesc: '1 handful (30g)' },
  {
    zhName: '黑巧克力',
    name: 'Dark Chocolate',
    servingDesc: '3 squares (30g)',
  },

  // ─── 调味料 ───
  { zhName: '橄榄油', name: 'Olive Oil', servingDesc: '1 tbsp (15ml)' },
  { zhName: '酱油', name: 'Soy Sauce', servingDesc: '1 tbsp (15ml)' },
  { zhName: '食盐', name: 'Table Salt', servingDesc: '1 tsp (6g)' },
  { zhName: '黄油', name: 'Butter', servingDesc: '1 tbsp (15g)' },
];

// ==================== P3-B: 菜谱翻译 ====================

/**
 * 核心菜谱英文翻译
 *
 * 覆盖系统中最常用的菜谱名称
 * 格式: [中文名, 英文名, 英文描述]
 */
const RECIPE_TRANSLATIONS_EN: Array<{
  zhName: string;
  name: string;
  description?: string;
}> = [
  {
    zhName: '番茄炒蛋',
    name: 'Stir-fried Tomato with Eggs',
    description:
      'Classic Chinese home-style dish with scrambled eggs and juicy tomatoes',
  },
  {
    zhName: '宫保鸡丁',
    name: 'Kung Pao Chicken',
    description:
      'Sichuan classic: diced chicken with peanuts, chili, and Sichuan peppercorn',
  },
  {
    zhName: '红烧肉',
    name: 'Red-braised Pork Belly',
    description: 'Slow-braised pork belly in soy sauce, sugar, and spices',
  },
  {
    zhName: '红烧排骨',
    name: 'Red-braised Spare Ribs',
    description: 'Tender pork ribs braised in sweet soy sauce',
  },
  {
    zhName: '鱼香肉丝',
    name: 'Yu-Xiang Shredded Pork',
    description: 'Shredded pork in garlic-chili-vinegar sauce (fish-flavored)',
  },
  {
    zhName: '糖醋里脊',
    name: 'Sweet and Sour Pork Tenderloin',
    description: 'Crispy pork tenderloin in tangy sweet and sour sauce',
  },
  {
    zhName: '回锅肉',
    name: 'Twice-cooked Pork',
    description: 'Sliced pork stir-fried with fermented bean paste and leeks',
  },
  {
    zhName: '麻婆豆腐',
    name: 'Mapo Tofu',
    description: 'Soft tofu in spicy fermented bean and minced pork sauce',
  },
  {
    zhName: '水煮鱼',
    name: 'Sichuan Boiled Fish',
    description: 'Fish fillets poached in spicy chili oil broth',
  },
  {
    zhName: '水煮肉片',
    name: 'Sichuan Boiled Pork Slices',
    description: 'Pork slices in fiery chili and Sichuan peppercorn broth',
  },
  {
    zhName: '青椒肉丝',
    name: 'Shredded Pork with Green Pepper',
    description: 'Quick stir-fry of pork and green pepper strips',
  },
  {
    zhName: '酸辣土豆丝',
    name: 'Hot and Sour Shredded Potato',
    description: 'Crispy shredded potato with vinegar and chili',
  },
  {
    zhName: '清蒸鲈鱼',
    name: 'Steamed Sea Bass',
    description: 'Whole sea bass steamed with ginger, scallion, and soy',
  },
  {
    zhName: '蒜蓉西兰花',
    name: 'Garlic Broccoli',
    description: 'Blanched broccoli tossed with minced garlic',
  },
  {
    zhName: '家常豆腐',
    name: 'Home-style Tofu',
    description: 'Pan-fried tofu braised with vegetables in savory sauce',
  },
  {
    zhName: '蛋炒饭',
    name: 'Egg Fried Rice',
    description: 'Wok-fried rice with beaten eggs and scallion',
  },
  {
    zhName: '扬州炒饭',
    name: 'Yangzhou Fried Rice',
    description: 'Fried rice with shrimp, ham, peas, and egg',
  },
  {
    zhName: '可乐鸡翅',
    name: 'Cola Chicken Wings',
    description: 'Chicken wings braised in cola and soy sauce',
  },
  {
    zhName: '地三鲜',
    name: 'Di San Xian',
    description: 'Fried potato, eggplant and green pepper in soy glaze',
  },
  {
    zhName: '紫菜蛋花汤',
    name: 'Seaweed Egg Drop Soup',
    description: 'Light soup with seaweed and egg ribbons',
  },
  {
    zhName: '凉拌黄瓜',
    name: 'Smashed Cucumber Salad',
    description: 'Chilled smashed cucumber with garlic, vinegar and chili oil',
  },
  {
    zhName: '葱爆羊肉',
    name: 'Scallion-fried Lamb',
    description: 'Quick-fried lamb slices with scallion segments',
  },
  {
    zhName: '小炒黄牛肉',
    name: 'Stir-fried Yellow Cattle Beef',
    description: 'Tender beef stir-fried with green chili and garlic',
  },
  {
    zhName: '冬瓜排骨汤',
    name: 'Winter Melon and Pork Rib Soup',
    description: 'Clear pork rib soup with winter melon',
  },
  {
    zhName: '木须肉',
    name: 'Mu Shu Pork',
    description: 'Stir-fried pork with wood ear mushroom and scrambled egg',
  },
  {
    zhName: '红烧茄子',
    name: 'Red-braised Eggplant',
    description: 'Eggplant braised in sweet soy sauce',
  },
  {
    zhName: '手撕包菜',
    name: 'Torn Cabbage Stir-fry',
    description: 'Hand-torn cabbage stir-fried with dried chili',
  },
  {
    zhName: '香菇滑鸡',
    name: 'Steamed Chicken with Mushroom',
    description: 'Silky chicken steamed with shiitake mushrooms',
  },
  {
    zhName: '油焖大虾',
    name: 'Braised Prawns in Oil',
    description: 'Whole prawns braised in soy-sugar oil sauce',
  },
  {
    zhName: '皮蛋豆腐',
    name: 'Century Egg Tofu',
    description:
      'Chilled silken tofu topped with preserved egg and soy dressing',
  },
];

// ==================== 执行入口 ====================

async function seedTranslations() {
  console.log('🌍 开始导入翻译种子数据...\n');

  // ─── P3-A: 食物翻译 ───
  let foodCreated = 0;
  let foodSkipped = 0;
  let foodNotFound = 0;

  for (const t of FOOD_TRANSLATIONS_EN) {
    const food = await prisma.foods.findFirst({ where: { name: t.zhName } });
    if (!food) {
      foodNotFound++;
      console.warn(`  ⚠ 食物 "${t.zhName}" 未找到，跳过翻译`);
      continue;
    }

    const existing = await prisma.food_translations.findFirst({
      where: { food_id: food.id, locale: 'en-US' },
    });

    if (existing) {
      foodSkipped++;
      continue;
    }

    await prisma.food_translations.create({
      data: {
        food_id: food.id,
        locale: 'en-US',
        name: t.name,
        aliases: t.aliases ?? null,
        description: t.description ?? null,
        serving_desc: t.servingDesc ?? null,
      },
    });
    foodCreated++;
  }

  console.log(
    `  食物翻译: 创建 ${foodCreated} 条, 跳过 ${foodSkipped} 条, 未找到 ${foodNotFound} 条`,
  );

  // ─── P3-B: 菜谱翻译 ───
  let recipeCreated = 0;
  let recipeSkipped = 0;
  let recipeNotFound = 0;

  for (const t of RECIPE_TRANSLATIONS_EN) {
    const recipe = await prisma.recipes.findFirst({
      where: { name: t.zhName },
    });
    if (!recipe) {
      recipeNotFound++;
      // 菜谱可能还没有种子数据，静默跳过
      continue;
    }

    const existing = await prisma.recipe_translations.findFirst({
      where: { recipe_id: recipe.id, locale: 'en-US' },
    });

    if (existing) {
      recipeSkipped++;
      continue;
    }

    await prisma.recipe_translations.create({
      data: {
        recipe_id: recipe.id,
        locale: 'en-US',
        name: t.name,
        description: t.description ?? null,
      },
    });
    recipeCreated++;
  }

  console.log(
    `  菜谱翻译: 创建 ${recipeCreated} 条, 跳过 ${recipeSkipped} 条, 未匹配 ${recipeNotFound} 条`,
  );

  console.log('\n✅ 翻译种子数据导入完成');
  await prisma.$disconnect();
}

seedTranslations().catch((err) => {
  console.error('❌ 翻译导入失败:', err);
  process.exit(1);
});
