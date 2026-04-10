/**
 * 默认订阅计划种子脚本
 * 运行方式：npx ts-node -r tsconfig-paths/register src/scripts/seed-subscription-plans.ts
 */
import AppDataSource from '../core/database/data-source-dev';
import { seedSubscriptionPlans } from './seed-subscription-plans.shared';

async function seed() {
  await AppDataSource.initialize();

  try {
    await seedSubscriptionPlans(AppDataSource);
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((err) => {
  console.error('❌ 订阅计划初始化失败:', err);
  process.exit(1);
});
