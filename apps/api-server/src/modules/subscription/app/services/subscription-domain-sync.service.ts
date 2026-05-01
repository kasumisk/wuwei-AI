import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { SubscriptionStatus } from '../../subscription.types';

type PlanLike = {
  id: string;
  billingCycle: string;
  currency: string;
  priceCents: number;
  isActive: boolean;
  entitlements?: unknown;
};

export type StoreProductInput = {
  provider: string;
  store: string;
  productId: string;
  offeringId?: string | null;
  packageId?: string | null;
  environment?: string | null;
  isActive?: boolean | null;
};

type SubscriptionLike = {
  id: string;
  userId: string;
  planId: string;
  status: string;
  startsAt: Date;
  expiresAt: Date;
  gracePeriodEndsAt?: Date | null;
  paymentChannel: string;
  platformSubscriptionId?: string | null;
};

@Injectable()
export class SubscriptionDomainSyncService {
  private readonly logger = new Logger(SubscriptionDomainSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async syncPlanCatalog(
    plan: PlanLike,
    storeProducts?: StoreProductInput[],
  ): Promise<void> {
    await Promise.all([
      storeProducts
        ? this.replaceStoreProducts(plan, storeProducts)
        : Promise.resolve(),
      this.syncPlanEntitlements(plan.id, plan.entitlements),
    ]);
    await this.syncActiveSubscriptionsForPlan(plan.id);
  }

  async findPlanByStoreProduct(params: {
    provider: string;
    productId: string;
    store?: string | null;
    environment?: string | null;
  }) {
    const productModel = (this.prisma as any).subscriptionStoreProduct;
    if (!productModel) return null;

    const environment = params.environment ?? this.getStoreEnvironment();
    const baseWhere = {
      provider: params.provider,
      productId: params.productId,
      isActive: true,
      ...(params.store ? { store: params.store } : {}),
    };

    const exact = await productModel.findFirst({
      where: {
        ...baseWhere,
        environment,
      },
      include: { subscriptionPlan: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (exact?.subscriptionPlan) return exact.subscriptionPlan;

    const productionFallback = await productModel.findFirst({
      where: {
        ...baseWhere,
        environment: 'production',
      },
      include: { subscriptionPlan: true },
      orderBy: { updatedAt: 'desc' },
    });
    return productionFallback?.subscriptionPlan ?? null;
  }

  async syncProviderCustomer(params: {
    userId: string;
    provider: string;
    providerCustomerId: string;
    originalProviderCustomerId?: string | null;
    aliases?: string[];
    environment?: string | null;
  }): Promise<void> {
    const model = (this.prisma as any).subscriptionProviderCustomer;
    if (!model) return;

    await model.upsert({
      where: {
        provider_environment_providerCustomerId: {
          provider: params.provider,
          environment: params.environment ?? this.getStoreEnvironment(),
          providerCustomerId: params.providerCustomerId,
        },
      },
      create: {
        userId: params.userId,
        provider: params.provider,
        providerCustomerId: params.providerCustomerId,
        originalProviderCustomerId: params.originalProviderCustomerId ?? null,
        aliases: params.aliases ?? [],
        environment: params.environment ?? this.getStoreEnvironment(),
        status: 'active',
        lastSyncedAt: new Date(),
      },
      update: {
        userId: params.userId,
        originalProviderCustomerId: params.originalProviderCustomerId ?? null,
        aliases: params.aliases ?? [],
        status: 'active',
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async syncUserEntitlementsFromSubscription(params: {
    subscription: SubscriptionLike;
    provider?: string | null;
    providerCustomerId?: string | null;
    lastEventAt?: Date | null;
  }): Promise<void> {
    const userEntitlementModel = (this.prisma as any).userEntitlement;
    if (!userEntitlementModel) return;

    const { subscription } = params;
    const hasAccess = this.subscriptionHasAccess(subscription);
    const sourceKey = subscription.id;

    if (!hasAccess) {
      await userEntitlementModel.updateMany({
        where: {
          userId: subscription.userId,
          sourceType: 'subscription',
          sourceKey,
          status: 'active',
        },
        data: {
          status: subscription.status,
          effectiveTo: new Date(),
          lastEventAt: params.lastEventAt ?? new Date(),
          updatedAt: new Date(),
        },
      });
      return;
    }

    const planEntitlements = await this.getPlanEntitlementValues(
      subscription.planId,
    );
    const now = new Date();
    const seen = new Set<string>();

    for (const [code, value] of Object.entries(planEntitlements)) {
      seen.add(code);
      await userEntitlementModel.upsert({
        where: {
          userId_entitlementCode_sourceType_sourceKey: {
            userId: subscription.userId,
            entitlementCode: code,
            sourceType: 'subscription',
            sourceKey,
          },
        },
        create: {
          userId: subscription.userId,
          entitlementCode: code,
          sourceType: 'subscription',
          sourceKey,
          sourceId: subscription.id,
          subscriptionId: subscription.id,
          provider: params.provider ?? subscription.paymentChannel,
          providerCustomerId: params.providerCustomerId ?? null,
          status: 'active',
          value: value as any,
          effectiveFrom: subscription.startsAt ?? now,
          effectiveTo:
            subscription.status === SubscriptionStatus.GRACE_PERIOD
              ? (subscription.gracePeriodEndsAt ?? subscription.expiresAt)
              : subscription.expiresAt,
          lastEventAt: params.lastEventAt ?? now,
        },
        update: {
          subscriptionId: subscription.id,
          provider: params.provider ?? subscription.paymentChannel,
          providerCustomerId: params.providerCustomerId ?? null,
          status: 'active',
          value: value as any,
          effectiveFrom: subscription.startsAt ?? now,
          effectiveTo:
            subscription.status === SubscriptionStatus.GRACE_PERIOD
              ? (subscription.gracePeriodEndsAt ?? subscription.expiresAt)
              : subscription.expiresAt,
          lastEventAt: params.lastEventAt ?? now,
          updatedAt: now,
        },
      });
    }

    await userEntitlementModel.updateMany({
      where: {
        userId: subscription.userId,
        sourceType: 'subscription',
        sourceKey,
        status: 'active',
        entitlementCode: { notIn: [...seen] },
      },
      data: {
        status: 'inactive',
        effectiveTo: now,
        updatedAt: now,
      },
    });
  }

  async syncActiveSubscriptionsForPlan(planId: string): Promise<void> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        planId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.GRACE_PERIOD,
            SubscriptionStatus.CANCELLED,
          ],
        },
      },
    });

    for (const subscription of subscriptions) {
      await this.syncUserEntitlementsFromSubscription({
        subscription: subscription as any,
        provider: subscription.paymentChannel,
      });
    }

    if (subscriptions.length > 0) {
      this.logger.log(
        `已刷新套餐关联用户权益: planId=${planId}, subscriptions=${subscriptions.length}`,
      );
    }
  }

  async rebuildAllActiveUserEntitlements(): Promise<{ subscriptions: number }> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        OR: [
          { status: SubscriptionStatus.ACTIVE },
          { status: SubscriptionStatus.GRACE_PERIOD },
          {
            status: SubscriptionStatus.CANCELLED,
            expiresAt: { gt: new Date() },
          },
        ],
      },
    });

    for (const subscription of subscriptions) {
      await this.syncUserEntitlementsFromSubscription({
        subscription: subscription as any,
        provider: subscription.paymentChannel,
      });
    }

    this.logger.log(
      `已重建当前有效用户权益: subscriptions=${subscriptions.length}`,
    );
    return { subscriptions: subscriptions.length };
  }

  async replaceStoreProducts(
    plan: PlanLike,
    storeProducts: StoreProductInput[],
  ): Promise<void> {
    const model = (this.prisma as any).subscriptionStoreProduct;
    if (!model) return;

    await model.updateMany({
      where: { planId: plan.id },
      data: { isActive: false, updatedAt: new Date() },
    });

    for (const item of this.normalizeStoreProducts(storeProducts)) {
      await this.syncStoreProduct(plan, item);
    }
  }

  private async syncStoreProduct(
    plan: PlanLike,
    item: Required<StoreProductInput>,
  ): Promise<void> {
    const model = (this.prisma as any).subscriptionStoreProduct;
    if (!model) return;

    await model.upsert({
      where: {
        provider_environment_store_productId: {
          provider: item.provider,
          environment: item.environment,
          store: item.store,
          productId: item.productId,
        },
      },
      create: {
        planId: plan.id,
        provider: item.provider,
        store: item.store,
        productId: item.productId,
        environment: item.environment,
        offeringId: item.offeringId,
        packageId: item.packageId,
        billingCycle: plan.billingCycle,
        currency: plan.currency,
        priceCents: plan.priceCents,
        isActive: plan.isActive && item.isActive,
        metadata: { source: 'subscription_plan_catalog' },
      },
      update: {
        planId: plan.id,
        store: item.store,
        offeringId: item.offeringId,
        packageId: item.packageId,
        billingCycle: plan.billingCycle,
        currency: plan.currency,
        priceCents: plan.priceCents,
        isActive: plan.isActive && item.isActive,
        updatedAt: new Date(),
      },
    });
  }

  private normalizeStoreProducts(
    storeProducts: StoreProductInput[],
  ): Array<
    Required<
      Pick<StoreProductInput, 'provider' | 'store' | 'productId' | 'environment' | 'isActive'>
    > & {
      offeringId: string | null;
      packageId: string | null;
    }
  > {
    const environment = this.getStoreEnvironment();
    const byKey = new Map<
      string,
      Required<
        Pick<
          StoreProductInput,
          'provider' | 'store' | 'productId' | 'environment' | 'isActive'
        >
      > & {
        offeringId: string | null;
        packageId: string | null;
      }
    >();

    for (const item of storeProducts) {
      const provider = item.provider?.trim();
      const store = item.store?.trim();
      const productId = item.productId?.trim();
      const productEnvironment = item.environment?.trim() || environment;
      if (!provider || !store || !productId) continue;

      byKey.set(
        `${provider}:${productEnvironment}:${store}:${productId}`,
        {
          provider,
          store,
          productId,
          offeringId: item.offeringId?.trim() || null,
          packageId: item.packageId?.trim() || null,
          environment: productEnvironment,
          isActive: item.isActive ?? true,
        },
      );
    }

    return [...byKey.values()];
  }

  private async syncPlanEntitlements(
    planId: string,
    entitlements: unknown,
  ): Promise<void> {
    const entitlementModel = (this.prisma as any).subscriptionEntitlement;
    const planEntitlementModel = (this.prisma as any)
      .subscriptionPlanEntitlement;
    if (!entitlementModel || !planEntitlementModel) return;

    const values = this.asEntitlementRecord(entitlements);
    for (const [code, value] of Object.entries(values)) {
      await entitlementModel.upsert({
        where: { code },
        create: {
          code,
          displayName: this.humanizeCode(code),
          valueType: 'json',
          defaultValue: {},
          status: 'active',
        },
        update: {
          displayName: this.humanizeCode(code),
          status: 'active',
          updatedAt: new Date(),
        },
      });

      await planEntitlementModel.upsert({
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
  }

  private async getPlanEntitlementValues(
    planId: string,
  ): Promise<Record<string, unknown>> {
    const planEntitlementModel = (this.prisma as any)
      .subscriptionPlanEntitlement;
    if (planEntitlementModel) {
      const rows = await planEntitlementModel.findMany({
        where: { planId, isActive: true },
      });
      if (rows.length > 0) {
        return Object.fromEntries(
          rows.map((row: any) => [row.entitlementCode, row.value]),
        );
      }
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      select: { entitlements: true },
    });
    return this.asEntitlementRecord(plan?.entitlements);
  }

  private subscriptionHasAccess(subscription: SubscriptionLike): boolean {
    if (subscription.status === SubscriptionStatus.ACTIVE) {
      return subscription.expiresAt > new Date();
    }
    if (subscription.status === SubscriptionStatus.GRACE_PERIOD) {
      return (
        (subscription.gracePeriodEndsAt ?? subscription.expiresAt) > new Date()
      );
    }
    return (
      subscription.status === SubscriptionStatus.CANCELLED &&
      subscription.expiresAt > new Date()
    );
  }

  private asEntitlementRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private humanizeCode(code: string): string {
    return code
      .split('_')
      .map((part) =>
        part.toLowerCase() === 'ai'
          ? 'AI'
          : part.charAt(0).toUpperCase() + part.slice(1),
      )
      .join(' ');
  }

  private getStoreEnvironment(): string {
    return (
      this.configService.get<string>('SUBSCRIPTION_STORE_ENV') ?? 'production'
    );
  }
}
