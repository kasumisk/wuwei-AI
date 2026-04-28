import { PrismaClient, Prisma } from '@prisma/client';
import { config } from 'dotenv';
import { SEED_FOODS } from './seed-foods.data';
import { upsertFoodSplitTables } from '../../modules/food/food-split.helper';

config();

const prisma = new PrismaClient();

/** 将 SeedFood 映射为 Prisma foods 表字段（仅主表保留列） */
function mapToData(
  food: (typeof SEED_FOODS)[number],
  code: string,
): Prisma.FoodCreateInput {
  return {
    code,
    name: food.name,
    aliases: food.aliases,
    status: 'active',
    category: food.category,
    subCategory: food.subCategory,
    foodGroup: food.foodGroup,
    // 宏量营养素（主表保留）
    calories: food.calories,
    protein: food.protein,
    fat: food.fat,
    carbs: food.carbs,
    fiber: food.fiber,
    sugar: food.sugar,
    // 元数据
    mainIngredient: food.mainIngredient,
    searchWeight: food.searchWeight ?? 100,
    primarySource: food.primarySource ?? 'official',
    confidence: food.confidence ?? 0.95,
    dataVersion: 1,
    isVerified: true,
    verifiedBy: 'seed-script',
    foodForm: food.foodForm ?? undefined,
    dishPriority: food.dishPriority ?? undefined,
    acquisitionDifficulty: food.acquisitionDifficulty ?? 3,
    commonalityScore: food.commonalityScore ?? 50,
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
    const existing = await prisma.food.findFirst({
      where: { name: food.name },
    });
    const code = existing?.code ?? `FOOD_CN_${String(i + 1).padStart(4, '0')}`;

    if (existing) {
      const { code: _code, ...updateData } = mapToData(food, code);
      await prisma.food.update({
        where: { id: existing.id },
        data: updateData,
      });
      await upsertFoodSplitTables(prisma, existing.id, food as any);
      updated++;
    } else {
      const created = await prisma.food.create({
        data: mapToData(food, code),
      });
      await upsertFoodSplitTables(prisma, created.id, food as any);
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
