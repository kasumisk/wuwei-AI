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

  for (const food of SEED_FOODS) {
    const existing = await repo.findOne({ where: { name: food.name } });
    if (existing) {
      // 更新已存在的记录
      await repo.update(existing.id, {
        aliases: food.aliases,
        category: food.category,
        caloriesPer100g: food.caloriesPer100g,
        proteinPer100g: food.proteinPer100g,
        fatPer100g: food.fatPer100g,
        carbsPer100g: food.carbsPer100g,
        standardServingG: food.standardServingG,
        standardServingDesc: food.standardServingDesc,
        searchWeight: food.searchWeight,
      });
      updated++;
    } else {
      await repo.save(repo.create({
        name: food.name,
        aliases: food.aliases,
        category: food.category,
        caloriesPer100g: food.caloriesPer100g,
        proteinPer100g: food.proteinPer100g,
        fatPer100g: food.fatPer100g,
        carbsPer100g: food.carbsPer100g,
        standardServingG: food.standardServingG,
        standardServingDesc: food.standardServingDesc,
        searchWeight: food.searchWeight,
      }));
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
