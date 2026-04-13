import { PrismaClient } from '@prisma/client';
import {
  BillingCycle,
  SubscriptionTier,
  TIER_ENTITLEMENTS,
} from '../../modules/subscription/subscription.types';

interface SubscriptionPlanSeed {
  name: string;
  description: string;
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  priceCents: number;
  currency: string;
  appleProductId: string | null;
  wechatProductId: string | null;
  sortOrder: number;
  isActive: boolean;
}

const DEFAULT_SUBSCRIPTION_PLAN_SEEDS: SubscriptionPlanSeed[] = [
  {
    name: 'Free 免费版',
    description: '基础推荐与分析能力，适合首次体验和轻度使用。',
    tier: SubscriptionTier.FREE,
    billingCycle: BillingCycle.MONTHLY,
    priceCents: 0,
    currency: 'CNY',
    appleProductId: null,
    wechatProductId: null,
    sortOrder: 0,
    isActive: true,
  },
  {
    name: 'Pro 月付',
    description: '解锁深度营养拆解、个性化替代建议和完整历史分析记录。',
    tier: SubscriptionTier.PRO,
    billingCycle: BillingCycle.MONTHLY,
    priceCents: 1990,
    currency: 'CNY',
    appleProductId: 'com.wuwei.pro.monthly',
    wechatProductId: 'pro_monthly',
    sortOrder: 10,
    isActive: true,
  },
  {
    name: 'Premium 月付',
    description: '解锁全天联动、趋势能力与全部高级推荐分析功能。',
    tier: SubscriptionTier.PREMIUM,
    billingCycle: BillingCycle.MONTHLY,
    priceCents: 3990,
    currency: 'CNY',
    appleProductId: 'com.wuwei.premium.monthly',
    wechatProductId: 'premium_monthly',
    sortOrder: 20,
    isActive: true,
  },
];

/**
 * 初始化默认订阅计划
 *
 * 幂等规则：按 tier + billingCycle 查找，存在则更新，不存在则创建。
 */
export async function seedSubscriptionPlans(
  prisma: PrismaClient,
): Promise<void> {
  console.log('📦 初始化默认订阅计划...\n');

  for (const planSeed of DEFAULT_SUBSCRIPTION_PLAN_SEEDS) {
    const existing = await prisma.subscriptionPlan.findFirst({
      where: {
        tier: planSeed.tier,
        billingCycle: planSeed.billingCycle,
      },
    });

    const payload = {
      name: planSeed.name,
      description: planSeed.description,
      tier: planSeed.tier,
      billingCycle: planSeed.billingCycle,
      priceCents: planSeed.priceCents,
      currency: planSeed.currency,
      appleProductId: planSeed.appleProductId,
      wechatProductId: planSeed.wechatProductId,
      sortOrder: planSeed.sortOrder,
      isActive: planSeed.isActive,
      entitlements: { ...TIER_ENTITLEMENTS[planSeed.tier] },
    };

    if (existing) {
      await prisma.subscriptionPlan.update({
        where: { id: existing.id },
        data: payload,
      });
      console.log(
        `  ⏭️  已更新套餐: ${planSeed.name} (${planSeed.tier}/${planSeed.billingCycle})`,
      );
      continue;
    }

    await prisma.subscriptionPlan.create({
      data: payload,
    });
    console.log(
      `  ✅ 已创建套餐: ${planSeed.name} (${planSeed.priceCents / 100} ${planSeed.currency})`,
    );
  }

  console.log('\n✅ 默认订阅计划初始化完成！');
}
