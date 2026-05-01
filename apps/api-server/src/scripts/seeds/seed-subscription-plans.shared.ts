import { PrismaClient } from '@prisma/client';
import {
  BillingCycle,
  SubscriptionTier,
  TIER_ENTITLEMENTS,
} from '../../modules/subscription/subscription.types';

interface StoreProductSeed {
  provider: string;
  store: string;
  productId: string;
  environment?: string;
}

interface SubscriptionPlanSeed {
  key: string;
  name: string;
  description: string;
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
  priceCents: number;
  currency: string;
  sortOrder: number;
  isActive: boolean;
  products: StoreProductSeed[];
}

const STORE_ENV = process.env.SUBSCRIPTION_STORE_ENV || 'production';

const DEFAULT_SUBSCRIPTION_PLAN_SEEDS: SubscriptionPlanSeed[] = [
  {
    key: 'free',
    name: 'Free',
    description:
      'Basic daily analysis and limited history for first-time users.',
    tier: SubscriptionTier.FREE,
    billingCycle: BillingCycle.MONTHLY,
    priceCents: 0,
    currency: 'USD',
    sortOrder: 0,
    isActive: true,
    products: [],
  },
  {
    key: 'pro_monthly',
    name: 'Pro Monthly',
    description:
      'Higher analysis quota, advanced nutrition insight, and full history.',
    tier: SubscriptionTier.PRO,
    billingCycle: BillingCycle.MONTHLY,
    priceCents: 499,
    currency: 'USD',
    sortOrder: 10,
    isActive: true,
    products: [
      {
        provider: 'revenuecat',
        store: 'app_store',
        productId: 'eatcheck.monthly.v2',
      },
      {
        provider: 'revenuecat',
        store: 'play_store',
        productId: 'eatcheck.monthly.v2',
      },
    ],
  },
  {
    key: 'pro_yearly',
    name: 'Pro Yearly',
    description:
      'Annual Pro access with full history and advanced AI nutrition analysis.',
    tier: SubscriptionTier.PRO,
    billingCycle: BillingCycle.YEARLY,
    priceCents: 2999,
    currency: 'USD',
    sortOrder: 11,
    isActive: true,
    products: [
      {
        provider: 'revenuecat',
        store: 'app_store',
        productId: 'eatcheck.yearly',
      },
      {
        provider: 'revenuecat',
        store: 'play_store',
        productId: 'eatcheck.yearly',
      },
    ],
  },
  {
    key: 'premium_monthly',
    name: 'Premium Monthly',
    description:
      'All advanced EatCheck capabilities with priority AI features.',
    tier: SubscriptionTier.PREMIUM,
    billingCycle: BillingCycle.MONTHLY,
    priceCents: 899,
    currency: 'USD',
    sortOrder: 20,
    isActive: false,
    products: [
      {
        provider: 'revenuecat',
        store: 'app_store',
        productId: 'eatcheck.premium.monthly',
      },
      {
        provider: 'revenuecat',
        store: 'play_store',
        productId: 'eatcheck.premium.monthly',
      },
    ],
  },
  {
    key: 'premium_yearly',
    name: 'Premium Yearly',
    description: 'Annual Premium access for future higher-tier capabilities.',
    tier: SubscriptionTier.PREMIUM,
    billingCycle: BillingCycle.YEARLY,
    priceCents: 5999,
    currency: 'USD',
    sortOrder: 21,
    isActive: false,
    products: [
      {
        provider: 'revenuecat',
        store: 'app_store',
        productId: 'eatcheck.premium.yearly',
      },
      {
        provider: 'revenuecat',
        store: 'play_store',
        productId: 'eatcheck.premium.yearly',
      },
    ],
  },
];

/**
 * 初始化订阅目录数据。
 *
 * 当前项目未上线，seed 以新模型为主：
 * - subscription_plan: 内部套餐
 * - subscription_store_products: provider/store 商品映射
 * - subscription_entitlements: 原子权益目录
 * - subscription_plan_entitlements: 套餐权益值
 *
 */
export async function seedSubscriptionPlans(
  prisma: PrismaClient,
): Promise<void> {
  console.log('📦 初始化订阅目录数据...\n');

  await resetSubscriptionCatalog(prisma);
  await seedEntitlementCatalog(prisma);

  for (const planSeed of DEFAULT_SUBSCRIPTION_PLAN_SEEDS) {
    const plan = await prisma.subscriptionPlan.upsert({
      where: {
        tier_billingCycle: {
          tier: planSeed.tier,
          billingCycle: planSeed.billingCycle,
        },
      } as any,
      create: {
        name: planSeed.name,
        description: planSeed.description,
        tier: planSeed.tier,
        billingCycle: planSeed.billingCycle,
        priceCents: planSeed.priceCents,
        currency: planSeed.currency,
        sortOrder: planSeed.sortOrder,
        isActive: planSeed.isActive,
        entitlements: { ...TIER_ENTITLEMENTS[planSeed.tier] },
      },
      update: {
        name: planSeed.name,
        description: planSeed.description,
        priceCents: planSeed.priceCents,
        currency: planSeed.currency,
        sortOrder: planSeed.sortOrder,
        isActive: planSeed.isActive,
        entitlements: { ...TIER_ENTITLEMENTS[planSeed.tier] },
      },
    });

    await seedStoreProducts(prisma, plan.id, planSeed);
    await seedPlanEntitlements(prisma, plan.id, planSeed.tier);

    console.log(
      `  ✅ ${planSeed.name}: ${planSeed.currency} ${(planSeed.priceCents / 100).toFixed(2)} (${planSeed.products.length} products)`,
    );
  }

  console.log('\n✅ 订阅目录数据初始化完成！');
}

async function seedEntitlementCatalog(prisma: PrismaClient): Promise<void> {
  const allCodes = new Set<string>();
  for (const entitlements of Object.values(TIER_ENTITLEMENTS)) {
    Object.keys(entitlements).forEach((code) => allCodes.add(code));
  }

  for (const code of [...allCodes].sort()) {
    await prisma.subscriptionEntitlement.upsert({
      where: { code },
      create: {
        code,
        displayName: humanizeCode(code),
        valueType: 'json',
        defaultValue: {},
        status: 'active',
      },
      update: {
        displayName: humanizeCode(code),
        status: 'active',
        updatedAt: new Date(),
      },
    });
  }
}

async function seedStoreProducts(
  prisma: PrismaClient,
  planId: string,
  planSeed: SubscriptionPlanSeed,
): Promise<void> {
  const activeProductIds = new Set<string>();

  for (const product of planSeed.products) {
    const environment = product.environment ?? STORE_ENV;
    activeProductIds.add(
      `${product.provider}:${environment}:${product.productId}`,
    );
    await prisma.subscriptionStoreProduct.upsert({
      where: {
        provider_environment_store_productId: {
          provider: product.provider,
          environment,
          store: product.store,
          productId: product.productId,
        },
      },
      create: {
        planId,
        provider: product.provider,
        store: product.store,
        productId: product.productId,
        environment,
        billingCycle: planSeed.billingCycle,
        currency: planSeed.currency,
        priceCents: planSeed.priceCents,
        isActive: planSeed.isActive,
        metadata: { seedKey: planSeed.key },
      },
      update: {
        planId,
        store: product.store,
        billingCycle: planSeed.billingCycle,
        currency: planSeed.currency,
        priceCents: planSeed.priceCents,
        isActive: planSeed.isActive,
        metadata: { seedKey: planSeed.key },
        updatedAt: new Date(),
      },
    });
  }

  if (activeProductIds.size === 0) {
    await prisma.subscriptionStoreProduct.updateMany({
      where: { planId },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });
    return;
  }

  await prisma.subscriptionStoreProduct.updateMany({
    where: {
      planId,
      NOT: [...activeProductIds].map((key) => {
        const [provider, environment, productId] = key.split(':');
        return { provider, environment, productId };
      }),
    },
    data: {
      isActive: false,
      updatedAt: new Date(),
    },
  });
}

async function resetSubscriptionCatalog(prisma: PrismaClient): Promise<void> {
  await prisma.userEntitlement.deleteMany({});
  await prisma.subscriptionPlanEntitlement.deleteMany({});
  await prisma.subscriptionStoreProduct.deleteMany({});
  await prisma.subscriptionEntitlement.deleteMany({});
}

async function seedPlanEntitlements(
  prisma: PrismaClient,
  planId: string,
  tier: SubscriptionTier,
): Promise<void> {
  const entitlements = TIER_ENTITLEMENTS[tier] as unknown as Record<
    string,
    unknown
  >;
  const activeCodes = Object.keys(entitlements);

  for (const [code, value] of Object.entries(entitlements)) {
    await prisma.subscriptionPlanEntitlement.upsert({
      where: {
        planId_entitlementCode: {
          planId,
          entitlementCode: code,
        },
      },
      create: {
        planId,
        entitlementCode: code,
        value: value as any,
        isActive: true,
      },
      update: {
        value: value as any,
        isActive: true,
        updatedAt: new Date(),
      },
    });
  }

  await prisma.subscriptionPlanEntitlement.updateMany({
    where: {
      planId,
      entitlementCode: { notIn: activeCodes },
    },
    data: {
      isActive: false,
      updatedAt: new Date(),
    },
  });
}

function humanizeCode(code: string): string {
  return code
    .split('_')
    .map((part) =>
      part.toLowerCase() === 'ai'
        ? 'AI'
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ');
}
