import { PrismaClient, Prisma } from '@prisma/client';
import { config } from 'dotenv';
import { SEED_FOODS } from './seed-foods.data';

config();

const prisma = new PrismaClient();

/** 将 SeedFood 映射为 Prisma foods 表字段 */
function mapToData(
  food: (typeof SEED_FOODS)[number],
  code: string,
): Prisma.foodsCreateInput {
  return {
    code,
    name: food.name,
    aliases: food.aliases,
    status: 'active',
    category: food.category,
    sub_category: food.subCategory,
    food_group: food.foodGroup,
    // 宏量营养素
    calories: food.calories,
    protein: food.protein,
    fat: food.fat,
    carbs: food.carbs,
    fiber: food.fiber,
    sugar: food.sugar,
    saturated_fat: food.saturatedFat,
    trans_fat: food.transFat,
    cholesterol: food.cholesterol,
    // 矿物质
    sodium: food.sodium,
    potassium: food.potassium,
    calcium: food.calcium,
    iron: food.iron,
    zinc: food.zinc,
    magnesium: food.magnesium,
    // 维生素
    vitamin_a: food.vitaminA,
    vitamin_c: food.vitaminC,
    vitamin_d: food.vitaminD,
    vitamin_e: food.vitaminE,
    vitamin_b12: food.vitaminB12,
    folate: food.folate,
    // 健康指标
    glycemic_index: food.glycemicIndex,
    glycemic_load: food.glycemicLoad,
    is_processed: food.isProcessed ?? false,
    is_fried: food.isFried ?? false,
    processing_level: food.processingLevel ?? 1,
    allergens: food.allergens ?? [],
    // 评分
    quality_score: food.qualityScore,
    satiety_score: food.satietyScore,
    nutrient_density: food.nutrientDensity,
    // 行为
    meal_types: food.mealTypes ?? [],
    tags: food.tags ?? [],
    main_ingredient: food.mainIngredient,
    compatibility: food.compatibility ?? {},
    // 份量
    standard_serving_g: food.standardServingG ?? 100,
    standard_serving_desc: food.standardServingDesc,
    common_portions: food.commonPortions ?? [],
    // 元数据
    search_weight: food.searchWeight ?? 100,
    primary_source: food.primarySource ?? 'official',
    confidence: food.confidence ?? 0.95,
    data_version: 1,
    is_verified: true,
    verified_by: 'seed-script',
    // V7.3: 食物大众化
    food_form: food.foodForm ?? 'ingredient',
    dish_priority: food.dishPriority ?? undefined,
    // V7.4: 食物可获得性
    acquisition_difficulty: food.acquisitionDifficulty ?? 3,
    // V7.4 Phase 3-A: 精细化营养字段
    omega3: food.omega3 ?? undefined,
    omega6: food.omega6 ?? undefined,
    soluble_fiber: food.solubleFiber ?? undefined,
    insoluble_fiber: food.insolubleFiber ?? undefined,
  };
}

/**
 * 食物库种子数据导入脚本
 * 运行: npx ts-node -r tsconfig-paths/register src/scripts/seed-foods.ts
 *
 * 幂等操作 — 重复运行会 upsert（按 name 去重）
 */
async function seedFoods() {
  console.log('🚀 开始导入食物库种子数据...\n');

  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < SEED_FOODS.length; i++) {
    const food = SEED_FOODS[i];
    const existing = await prisma.foods.findFirst({
      where: { name: food.name },
    });
    const code = existing?.code ?? `FOOD_CN_${String(i + 1).padStart(4, '0')}`;

    if (existing) {
      const { code: _code, ...updateData } = mapToData(food, code);
      await prisma.foods.update({
        where: { id: existing.id },
        data: updateData,
      });
      updated++;
    } else {
      await prisma.foods.create({
        data: mapToData(food, code),
      });
      inserted++;
    }
  }

  console.log(
    `✅ 食物库导入完成: 新增 ${inserted} 条, 更新 ${updated} 条 (共 ${SEED_FOODS.length} 条)`,
  );
  await prisma.$disconnect();
}

seedFoods().catch((err) => {
  console.error('❌ 导入失败:', err);
  process.exit(1);
});
