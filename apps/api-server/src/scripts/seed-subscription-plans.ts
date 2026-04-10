/**
 * 默认订阅计划种子脚本
 * 运行方式：npx ts-node -r tsconfig-paths/register src/scripts/seed-subscription-plans.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedSubscriptionPlans } from './seed-subscription-plans.shared';

const prisma = new PrismaClient();

async function seed() {
  try {
    await seedSubscriptionPlans(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

seed().catch((err) => {
  console.error('❌ 订阅计划初始化失败:', err);
  process.exit(1);
});
