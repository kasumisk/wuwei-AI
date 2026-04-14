import { PrismaClient, Prisma } from '@prisma/client';
import { config } from 'dotenv';
import { SEED_FOODS } from './seed-foods.data';

config();

const prisma = new PrismaClient();

/** 将 SeedFood 映射为 Prisma foods 表字段 */
function mapToData(
  food: (typeof SEED_FOODS)[number],
  code: string,
): Prisma.FoodsCreateInput {
  return {
    code,
    name: food.name,
    aliases: food.aliases,
    status: 'active',
    category: food.category,
    subCategory: food.subCategory,
    foodGroup: food.foodGroup,
    // 宏量营养素
    calories: food.calories,
    protein: food.protein,
    fat: food.fat,
    carbs: food.carbs,
    fiber: food.fiber,
    sugar: food.sugar,
    saturatedFat: food.saturatedFat,
    transFat: food.transFat,
    cholesterol: food.cholesterol,
    // 矿物质
    sodium: food.sodium,
    potassium: food.potassium,
    calcium: food.calcium,
    iron: food.iron,
    zinc: food.zinc,
    magnesium: food.magnesium,
    // 维生素
    vitaminA: food.vitaminA,
    vitaminC: food.vitaminC,
    vitaminD: food.vitaminD,
    vitaminE: food.vitaminE,
    vitaminB12: food.vitaminB12,
    folate: food.folate,
    // 健康指标
    glycemicIndex: food.glycemicIndex,
    glycemicLoad: food.glycemicLoad,
    isProcessed: food.isProcessed ?? false,
    isFried: food.isFried ?? false,
    processingLevel: food.processingLevel ?? 1,
    allergens: food.allergens ?? [],
    // 评分
    qualityScore: food.qualityScore,
    satietyScore: food.satietyScore,
    nutrientDensity: food.nutrientDensity,
    // 行为
    mealTypes: food.mealTypes ?? [],
    tags: food.tags ?? [],
    mainIngredient: food.mainIngredient,
    compatibility: food.compatibility ?? {},
    // 份量
    standardServingG: food.standardServingG ?? 100,
    standardServingDesc: food.standardServingDesc,
    commonPortions: food.commonPortions ?? [],
    // 元数据
    searchWeight: food.searchWeight ?? 100,
    primarySource: food.primarySource ?? 'official',
    confidence: food.confidence ?? 0.95,
    dataVersion: 1,
    isVerified: true,
    verifiedBy: 'seed-script',
    // V7.3: 食物大众化
    // V8.8 FIX: 不设默认值，保持 NULL 让 AI 补全判断真实形态
    // 原 `?? 'ingredient'` 默认值会导致 applyEnrichment 因字段非 NULL 而跳过补全
    foodForm: food.foodForm ?? undefined,
    dishPriority: food.dishPriority ?? undefined,
    // V7.4: 食物可获得性
    acquisitionDifficulty: food.acquisitionDifficulty ?? 3,
    // V7.8 P2-J: 大众化评分（基于中国饮食调查数据校准）
    commonalityScore: food.commonalityScore ?? 50,
    // V7.4 Phase 3-A: 精细化营养字段
    omega3: food.omega3 ?? undefined,
    omega6: food.omega6 ?? undefined,
    solubleFiber: food.solubleFiber ?? undefined,
    insolubleFiber: food.insolubleFiber ?? undefined,
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
