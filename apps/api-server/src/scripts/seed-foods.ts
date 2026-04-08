import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { FoodLibrary } from '../entities/food-library.entity';
import { SEED_FOODS } from './seed-foods.data';

config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'ai_platform',
  synchronize: false,
  logging: false,
  entities: [FoodLibrary],
  ...(process.env.DB_SSL === 'true' && {
    ssl: { rejectUnauthorized: false },
  }),
});

/** 将 SeedFood 映射为 FoodLibrary 实体字段 */
function mapToEntity(food: (typeof SEED_FOODS)[number], code: string): Partial<FoodLibrary> {
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

  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(FoodLibrary);

  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < SEED_FOODS.length; i++) {
    const food = SEED_FOODS[i];
    const existing = await repo.findOne({ where: { name: food.name } });
    const code = existing?.code ?? `FOOD_CN_${String(i + 1).padStart(4, '0')}`;

    if (existing) {
      const { code: _code, ...updateData } = mapToEntity(food, code);
      await repo.update(existing.id, updateData);
      updated++;
    } else {
      await repo.save(repo.create(mapToEntity(food, code)));
      inserted++;
    }
  }

  console.log(`✅ 食物库导入完成: 新增 ${inserted} 条, 更新 ${updated} 条 (共 ${SEED_FOODS.length} 条)`);
  await AppDataSource.destroy();
}

seedFoods().catch((err) => {
  console.error('❌ 导入失败:', err);
  process.exit(1);
});
