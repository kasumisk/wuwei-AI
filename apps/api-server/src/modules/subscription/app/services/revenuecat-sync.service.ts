import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import { CronBackend, CronHandlerRegistry } from '../../../../core/cron';
import { SubscriptionService } from './subscription.service';
import { SubscriptionDomainSyncService } from './subscription-domain-sync.service';
import {
  PaymentChannel,
  SubscriptionStatus,
  SubscriptionTier,
} from '../../subscription.types';

interface RevenueCatEventLike {
  id?: string;
  type?: string;
  event_timestamp_ms?: number;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  entitlement_ids?: string[];
  environment?: string;
  store?: string;
  aliases?: string[];
  transaction_id?: string;
  original_transaction_id?: string;
}

interface RevenueCatWebhookPayload {
  api_version?: string;
  event?: RevenueCatEventLike;
}

export interface RevenueCatWebhookIngestResult {
  accepted: boolean;
  provider: 'revenuecat';
  eventId: string | null;
  eventType: string | null;
  appUserId: string | null;
  queuedAt: string;
}

export interface RevenueCatSyncTriggerResult {
  accepted: boolean;
  source: 'client_trigger' | 'revenuecat_webhook';
  userId: string;
  queuedAt: string;
  currentTier?: SubscriptionTier;
  currentSubscriptionId?: string | null;
  snapshotFetched?: boolean;
  webhookEventId?: string | null;
}

interface RevenueCatSubscriberResponse {
  subscriber?: {
    original_app_user_id?: string;
    aliases?: string[];
    entitlements?: Record<string, RevenueCatEntitlementSnapshot>;
    subscriptions?: Record<string, RevenueCatSubscriptionSnapshot>;
  };
}

interface RevenueCatEntitlementSnapshot {
  product_identifier?: string;
  purchase_date?: string;
  expires_date?: string | null;
}

interface RevenueCatSubscriptionSnapshot {
  store?: string;
  is_sandbox?: boolean;
  ownership_type?: string;
  expires_date?: string | null;
  purchase_date?: string | null;
  original_purchase_date?: string | null;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  refunded_at?: string | null;
  store_transaction_id?: string | null;
  original_transaction_id?: string | null;
  purchase_token?: string | null;
}

type SelectedSubscription = RevenueCatSubscriptionSnapshot & {
  productId: string;
};

@Injectable()
export class RevenueCatSyncService implements OnModuleInit {
  private readonly logger = new Logger(RevenueCatSyncService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly domainSync: SubscriptionDomainSyncService,
    private readonly redis: RedisCacheService,
    private readonly cronBackend: CronBackend,
    private readonly cronRegistry: CronHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.cronRegistry.register('subscription-revenuecat-reconcile', () =>
      this.reconcileRecentSubscriptions(),
    );
    this.cronRegistry.register('subscription-revenuecat-webhook-retry', () =>
      this.retryFailedWebhookEvents(),
    );
  }

  /**
   * 校验 RevenueCat webhook 的 Authorization 头。
   *
   * 安全要求（生产）：
   * - REVENUECAT_WEBHOOK_AUTH 必须配置，否则任何环境一律拒绝
   * - 使用 timing-safe 比较，避免基于响应时间的 token 探测
   * - 兼容 `Bearer xxx` 与裸 token 两种格式
   */
  assertWebhookAuthorization(authHeader?: string): void {
    const expected = (
      this.configService.get<string>('REVENUECAT_WEBHOOK_AUTH', '') ?? ''
    ).trim();

    if (!expected) {
      // 任何环境缺失都拒绝（包括 staging）。绝不允许 webhook 裸奔。
      this.logger.error(
        'REVENUECAT_WEBHOOK_AUTH 未配置，拒绝所有 RevenueCat webhook 请求',
      );
      throw new UnauthorizedException('RevenueCat webhook auth is not set');
    }

    const raw = (authHeader ?? '').trim();
    // 兼容 "Bearer xxx" 与 "xxx"
    const actual = raw.replace(/^Bearer\s+/i, '').trim();

    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid RevenueCat webhook auth');
    }
  }

  async ingestWebhook(
    payload: RevenueCatWebhookPayload,
  ): Promise<RevenueCatWebhookIngestResult> {
    const event = payload?.event ?? null;
    const appUserId = event?.app_user_id ?? event?.original_app_user_id ?? null;
    const providerEventId = this.getWebhookEventId(event);
    const runtimeEnv = this.getRuntimeEnv();
    const eventTimestamp = this.fromTimestampMs(event?.event_timestamp_ms);
    const webhookEvent = await this.prisma.billingWebhookEvents.upsert({
      where: {
        provider_providerEventId: {
          provider: 'revenuecat',
          providerEventId,
        },
      },
      create: {
        provider: 'revenuecat',
        providerEventId,
        eventType: event?.type ?? null,
        appUserId,
        originalAppUserId: event?.original_app_user_id ?? null,
        aliases: event?.aliases ?? [],
        store: event?.store ?? null,
        environment: event?.environment ?? null,
        runtimeEnv,
        productId: event?.product_id ?? null,
        entitlementIds: event?.entitlement_ids ?? [],
        transactionId: event?.transaction_id ?? null,
        originalTransactionId: event?.original_transaction_id ?? null,
        eventTimestamp,
        processingStatus: 'pending',
        rawPayload: payload as any,
      },
      // update 分支：仅刷新 rawPayload（RC 偶尔补字段），其余字段保持不动。
      // 特别地：不覆写 processingStatus——已处理的事件不应被重新触发。
      update: {
        rawPayload: payload as any,
      },
    });

    // 幂等保护：事件已成功处理过，直接返回 200，跳过重复同步。
    // RC 在网络抖动时会重发相同 eventId；重复执行 triggerSyncForUser 无害但浪费资源。
    if (webhookEvent.processingStatus === 'processed') {
      this.logger.debug(
        `RevenueCat webhook already processed, skipping sync | eventId=${providerEventId}`,
      );
      return {
        accepted: true,
        provider: 'revenuecat',
        eventId: providerEventId,
        eventType: event?.type ?? null,
        appUserId,
        queuedAt: new Date().toISOString(),
      };
    }

    const result: RevenueCatWebhookIngestResult = {
      accepted: true,
      provider: 'revenuecat',
      eventId: providerEventId,
      eventType: event?.type ?? null,
      appUserId,
      queuedAt: new Date().toISOString(),
    };

    this.logger.log(
      [
        'RevenueCat webhook accepted',
        `eventId=${result.eventId ?? 'unknown'}`,
        `type=${result.eventType ?? 'unknown'}`,
        `appUserId=${appUserId ?? 'unknown'}`,
      ].join(' | '),
    );

    if (appUserId && this.isUuid(appUserId)) {
      try {
        await this.triggerSyncForUser(
          appUserId,
          'revenuecat_webhook',
          webhookEvent.id,
          providerEventId,
        );
        await this.markWebhookProcessed(webhookEvent.id);
      } catch (error) {
        await this.markWebhookFailed(webhookEvent.id, error);
        throw error;
      }
    } else if (appUserId) {
      this.logger.warn(
        `RevenueCat webhook appUserId 不是 UUID，跳过用户摘要预热: ${appUserId}`,
      );
      await this.markWebhookProcessed(webhookEvent.id);
    }

    return result;
  }

  async triggerSyncForUser(
    userId: string,
    source: 'client_trigger' | 'revenuecat_webhook',
    webhookEventId?: string,
    providerEventId?: string,
  ): Promise<RevenueCatSyncTriggerResult> {
    const queuedAt = new Date().toISOString();
    const result: RevenueCatSyncTriggerResult = {
      accepted: true,
      source,
      userId,
      queuedAt,
      webhookEventId: webhookEventId ?? null,
    };

    if (!this.isUuid(userId)) {
      this.logger.warn(`跳过 RevenueCat 同步，非法 userId: ${userId}`);
      return result;
    }

    const beforeSummary = await this.subscriptionService.getUserSummary(userId);
    const snapshot = await this.fetchSubscriberSnapshot(userId);
    result.snapshotFetched = true;

    const syncOutcome = await this.applySubscriberSnapshot({
      userId,
      source,
      snapshot,
      webhookEventId,
      providerEventId,
    });

    if (syncOutcome.cacheInvalidated) {
      await this.subscriptionService.invalidateUserSummaryCache(userId);
    }

    const summary = syncOutcome.cacheInvalidated
      ? await this.subscriptionService.getUserSummary(userId)
      : beforeSummary;

    result.currentTier = summary.tier;
    result.currentSubscriptionId = summary.subscriptionId;

    this.logger.log(
      [
        'RevenueCat sync triggered',
        `source=${source}`,
        `userId=${userId}`,
        `tier=${summary.tier}`,
      ].join(' | '),
    );

    return result;
  }

  @Cron('*/15 * * * *', { name: 'subscription-revenuecat-reconcile' })
  async reconcileRecentSubscriptionsTick(): Promise<void> {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.reconcileRecentSubscriptions();
  }

  async reconcileRecentSubscriptions(): Promise<void> {
    // 分布式锁：14 分钟 TTL（稍短于 Cron 间隔 15 分钟）
    const acquired = await this.redis.setNX(
      'rc:reconcile:lock',
      '1',
      14 * 60 * 1000,
    );
    if (!acquired) return;

    const recentSubs = await this.prisma.subscription.findMany({
      where: {
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.GRACE_PERIOD,
            SubscriptionStatus.CANCELLED,
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    for (const sub of recentSubs) {
      try {
        await this.triggerSyncForUser(sub.userId, 'client_trigger');
      } catch (error) {
        this.logger.warn(
          `RevenueCat reconcile failed: userId=${sub.userId}, error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  @Cron('*/10 * * * *', { name: 'subscription-revenuecat-webhook-retry' })
  async retryFailedWebhookEventsTick(): Promise<void> {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.retryFailedWebhookEvents();
  }

  async retryFailedWebhookEvents(): Promise<void> {
    // 分布式锁：9 分钟 TTL（稍短于 Cron 间隔 10 分钟）
    const acquired = await this.redis.setNX(
      'rc:webhook-retry:lock',
      '1',
      9 * 60 * 1000,
    );
    if (!acquired) return;

    const failedEvents = await this.prisma.billingWebhookEvents.findMany({
      where: {
        provider: 'revenuecat',
        processingStatus: 'failed',
        retryCount: { lt: 5 },
      },
      orderBy: { receivedAt: 'asc' },
      take: 20,
    });

    for (const event of failedEvents) {
      try {
        await this.prisma.billingWebhookEvents.update({
          where: { id: event.id },
          data: { processingStatus: 'pending' },
        });
        await this.ingestWebhook(event.rawPayload as RevenueCatWebhookPayload);
      } catch (error) {
        await this.markWebhookFailed(event.id, error);
      }
    }
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private getRuntimeEnv(): string {
    return (
      this.configService.get<string>('APP_RUNTIME_ENV') ||
      process.env.NODE_ENV ||
      'unknown'
    );
  }

  private getWebhookEventId(event?: RevenueCatEventLike | null): string {
    if (event?.id) return event.id;
    const fingerprint = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          type: event?.type ?? null,
          app_user_id: event?.app_user_id ?? null,
          original_app_user_id: event?.original_app_user_id ?? null,
          event_timestamp_ms: event?.event_timestamp_ms ?? null,
          product_id: event?.product_id ?? null,
          transaction_id: event?.transaction_id ?? null,
          original_transaction_id: event?.original_transaction_id ?? null,
        }),
      )
      .digest('hex')
      .slice(0, 32);
    return [
      'rc',
      event?.type ?? 'unknown',
      event?.app_user_id ?? event?.original_app_user_id ?? 'unknown',
      event?.event_timestamp_ms ?? 'no_timestamp',
      fingerprint,
    ].join(':');
  }

  private fromTimestampMs(value?: number): Date | null {
    if (!value || Number.isNaN(value)) return null;
    return new Date(value);
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async fetchSubscriberSnapshot(
    appUserId: string,
  ): Promise<RevenueCatSubscriberResponse> {
    const secret = this.configService.get<string>('REVENUECAT_SECRET_KEY', '');
    if (!secret) {
      throw new InternalServerErrorException(
        'RevenueCat secret key is not configured',
      );
    }

    const baseUrl = this.configService.get<string>(
      'REVENUECAT_API_BASE',
      'https://api.revenuecat.com/v1',
    );
    const url = `${baseUrl.replace(/\/$/, '')}/subscribers/${encodeURIComponent(
      appUserId,
    )}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new InternalServerErrorException(
        `RevenueCat subscriber fetch failed: ${response.status} ${text}`,
      );
    }

    return (await response.json()) as RevenueCatSubscriberResponse;
  }

  private selectSubscription(
    subscriptions?: Record<string, RevenueCatSubscriptionSnapshot>,
  ): {
    latest: SelectedSubscription | null;
    active: SelectedSubscription | null;
  } {
    const items = Object.entries(subscriptions ?? {}).map(
      ([productId, snapshot]) => ({
        productId,
        ...snapshot,
      }),
    );

    items.sort((a, b) => {
      const aTs = this.parseDate(a.expires_date)?.getTime() ?? 0;
      const bTs = this.parseDate(b.expires_date)?.getTime() ?? 0;
      return bTs - aTs;
    });

    const latest = items[0] ?? null;
    const now = Date.now();
    const active =
      items.find((item) => {
        const refundedAt = this.parseDate(item.refunded_at);
        if (refundedAt) return false;
        const expiresAt = this.parseDate(item.expires_date);
        return !!expiresAt && expiresAt.getTime() > now;
      }) ?? null;

    return { latest, active };
  }

  private mapStoreToPaymentChannel(store?: string | null): PaymentChannel {
    if (store === 'play_store') {
      return PaymentChannel.GOOGLE_PLAY;
    }
    return PaymentChannel.APPLE_IAP;
  }

  private async applySubscriberSnapshot(params: {
    userId: string;
    source: 'client_trigger' | 'revenuecat_webhook';
    snapshot: RevenueCatSubscriberResponse;
    webhookEventId?: string;
    providerEventId?: string;
  }): Promise<{ cacheInvalidated: boolean }> {
    const { userId, source, snapshot, webhookEventId, providerEventId } =
      params;
    const runtimeEnv = this.getRuntimeEnv();
    const { latest, active } = this.selectSubscription(
      snapshot.subscriber?.subscriptions,
    );
    const candidate = active ?? latest;
    const candidateExpiresAt = this.parseDate(candidate?.expires_date);
    const candidateCancelledAt = this.parseDate(
      candidate?.unsubscribe_detected_at,
    );
    const candidateBillingIssueAt = this.parseDate(
      candidate?.billing_issues_detected_at,
    );
    const candidateRefundedAt = this.parseDate(candidate?.refunded_at);
    const providerSubscriptionKey =
      candidate?.original_transaction_id ?? candidate?.purchase_token ?? null;
    const providerCustomerId =
      snapshot.subscriber?.original_app_user_id ?? userId;

    await this.domainSync.syncProviderCustomer({
      userId,
      provider: 'revenuecat',
      providerCustomerId,
      originalProviderCustomerId: snapshot.subscriber?.original_app_user_id,
      aliases: snapshot.subscriber?.aliases ?? [],
      environment: candidate?.is_sandbox ? 'sandbox' : 'production',
    });

    const currentSub = await this.prisma.subscription.findFirst({
      where: {
        OR: [
          { userId, status: SubscriptionStatus.ACTIVE },
          { userId, status: SubscriptionStatus.GRACE_PERIOD },
          {
            userId,
            status: SubscriptionStatus.CANCELLED,
            expiresAt: { gte: new Date() },
          },
        ],
      },
      include: { subscriptionPlan: true },
      orderBy: { expiresAt: 'desc' },
    });

    const beforeState = this.serializeSubscriptionState(currentSub);
    let action = 'noop';
    let cacheInvalidated = false;
    let targetSubscriptionId = currentSub?.id ?? null;

    let matchedPlan = null as any;
    if (candidate?.productId) {
      matchedPlan = await this.domainSync.findPlanByStoreProduct({
        provider: 'revenuecat',
        productId: candidate.productId,
        store: candidate.store,
        environment: candidate.is_sandbox ? 'sandbox' : 'production',
      });
    }

    if (currentSub && candidateRefundedAt) {
      const updated = await this.prisma.subscription.update({
        where: { id: currentSub.id },
        data: {
          status: SubscriptionStatus.REFUNDED,
          autoRenew: false,
          cancelledAt: candidateRefundedAt,
          expiresAt: candidateRefundedAt,
          gracePeriodEndsAt: null,
        },
      });
      await this.domainSync.syncUserEntitlementsFromSubscription({
        subscription: updated as any,
        provider: 'revenuecat',
        providerCustomerId,
        lastEventAt: candidateRefundedAt,
      });
      action = 'refund';
      cacheInvalidated = true;
    } else if (active && candidateExpiresAt && matchedPlan) {
      const selectedCandidate = active;
      if (
        currentSub &&
        currentSub.planId === matchedPlan.id &&
        currentSub.platformSubscriptionId === providerSubscriptionKey
      ) {
        const nextStatus = this.determineRevenueCatStatus({
          expiresAt: candidateExpiresAt,
          cancelledAt: candidateCancelledAt,
          billingIssueAt: candidateBillingIssueAt,
        });
        const updated = await this.prisma.subscription.update({
          where: { id: currentSub.id },
          data: {
            paymentChannel: this.mapStoreToPaymentChannel(
              selectedCandidate.store,
            ),
            expiresAt: candidateExpiresAt,
            status: nextStatus,
            autoRenew: !candidateCancelledAt && !candidateBillingIssueAt,
            cancelledAt: candidateCancelledAt,
            gracePeriodEndsAt:
              nextStatus === SubscriptionStatus.GRACE_PERIOD
                ? candidateExpiresAt
                : null,
          },
        });
        await this.domainSync.syncUserEntitlementsFromSubscription({
          subscription: updated as any,
          provider: 'revenuecat',
          providerCustomerId,
          lastEventAt: candidateExpiresAt,
        });
        targetSubscriptionId = updated.id;
        action = candidateCancelledAt ? 'cancel' : 'renew';
        cacheInvalidated = true;
      } else if (candidate) {
        const created = await this.subscriptionService.createSubscription({
          userId,
          planId: matchedPlan.id,
          paymentChannel: this.mapStoreToPaymentChannel(
            selectedCandidate.store,
          ),
          platformSubscriptionId: providerSubscriptionKey ?? undefined,
          startsAt:
            this.parseDate(selectedCandidate.original_purchase_date) ??
            this.parseDate(selectedCandidate.purchase_date) ??
            new Date(),
          expiresAt: candidateExpiresAt,
        });
        targetSubscriptionId = created.id;
        action = 'activate';
        cacheInvalidated = true;

        if (candidateCancelledAt || candidateBillingIssueAt) {
          const status = this.determineRevenueCatStatus({
            expiresAt: candidateExpiresAt,
            cancelledAt: candidateCancelledAt,
            billingIssueAt: candidateBillingIssueAt,
          });
          const adjusted = await this.prisma.subscription.update({
            where: { id: created.id },
            data: {
              status,
              autoRenew: status === SubscriptionStatus.ACTIVE,
              cancelledAt: candidateCancelledAt,
              gracePeriodEndsAt:
                status === SubscriptionStatus.GRACE_PERIOD
                  ? candidateExpiresAt
                  : null,
            },
          });
          await this.domainSync.syncUserEntitlementsFromSubscription({
            subscription: adjusted as any,
            provider: 'revenuecat',
            providerCustomerId,
            lastEventAt: candidateBillingIssueAt ?? candidateCancelledAt,
          });
          action =
            status === SubscriptionStatus.GRACE_PERIOD
              ? 'activate_grace_period'
              : 'activate_cancelled';
        }
      }
    } else if (currentSub && candidateCancelledAt && candidateExpiresAt) {
      const updated = await this.prisma.subscription.update({
        where: { id: currentSub.id },
        data: {
          status:
            candidateExpiresAt > new Date()
              ? SubscriptionStatus.CANCELLED
              : SubscriptionStatus.EXPIRED,
          autoRenew: false,
          cancelledAt: candidateCancelledAt,
          expiresAt: candidateExpiresAt,
        },
      });
      await this.domainSync.syncUserEntitlementsFromSubscription({
        subscription: updated as any,
        provider: 'revenuecat',
        providerCustomerId,
        lastEventAt: candidateCancelledAt,
      });
      action = candidateExpiresAt > new Date() ? 'cancel' : 'expire';
      cacheInvalidated = true;
    } else if (
      currentSub &&
      candidateExpiresAt &&
      candidateExpiresAt <= new Date()
    ) {
      const updated = await this.prisma.subscription.update({
        where: { id: currentSub.id },
        data: {
          status: SubscriptionStatus.EXPIRED,
          autoRenew: false,
          expiresAt: candidateExpiresAt,
          gracePeriodEndsAt: null,
        },
      });
      await this.domainSync.syncUserEntitlementsFromSubscription({
        subscription: updated as any,
        provider: 'revenuecat',
        providerCustomerId,
        lastEventAt: candidateExpiresAt,
      });
      action = 'expire';
      cacheInvalidated = true;
    } else if (candidate?.productId && !matchedPlan) {
      this.logger.warn(
        `RevenueCat 商品未映射到 subscription_plan，跳过本地订阅收敛: userId=${userId}, productId=${candidate.productId}`,
      );
    }

    if (cacheInvalidated) {
      await this.subscriptionService.invalidateUserSummaryCache(userId);
    }

    const latestState = targetSubscriptionId
      ? await this.prisma.subscription.findUnique({
          where: { id: targetSubscriptionId },
          include: { subscriptionPlan: true },
        })
      : currentSub;
    const afterState = this.serializeSubscriptionState(latestState);

    await this.persistTransaction({
      providerEventId,
      runtimeEnv,
      webhookEventId,
      userId,
      subscriptionId: targetSubscriptionId,
      snapshot: candidate,
      action,
    });

    if (
      source === 'revenuecat_webhook' ||
      JSON.stringify(beforeState) !== JSON.stringify(afterState)
    ) {
      await this.prisma.subscriptionAuditLogs.create({
        data: {
          subscriptionId: targetSubscriptionId,
          userId,
          actorType:
            source === 'revenuecat_webhook' ? 'webhook' : 'client_trigger',
          actorId: providerEventId ?? webhookEventId ?? null,
          action,
          runtimeEnv,
          beforeState: beforeState as any,
          afterState: afterState as any,
          reason:
            source === 'revenuecat_webhook'
              ? 'RevenueCat webhook sync'
              : 'Client-triggered RevenueCat sync',
        },
      });
    }

    return { cacheInvalidated };
  }

  private async persistTransaction(params: {
    providerEventId?: string;
    webhookEventId?: string;
    runtimeEnv: string;
    userId: string;
    subscriptionId: string | null;
    snapshot: SelectedSubscription | null;
    action: string;
  }): Promise<void> {
    const {
      providerEventId,
      runtimeEnv,
      userId,
      subscriptionId,
      snapshot,
      action,
    } = params;

    if (!snapshot) return;

    const transactionId = snapshot.store_transaction_id ?? null;
    if (transactionId) {
      const exists = await this.prisma.subscriptionTransactions.findFirst({
        where: {
          provider: 'revenuecat',
          transactionId,
        },
      });
      if (exists) return;
    }

    const status = snapshot.refunded_at
      ? 'refunded'
      : action === 'expire'
        ? 'expired'
        : action === 'cancel'
          ? 'cancelled'
          : 'success';

    try {
      await this.prisma.subscriptionTransactions.create({
        data: {
          subscriptionId,
          userId,
          provider: 'revenuecat',
          providerEventId: providerEventId ?? null,
          transactionType: this.mapActionToTransactionType(action),
          store: snapshot.store ?? null,
          environment: snapshot.is_sandbox ? 'sandbox' : 'production',
          runtimeEnv,
          storeProductId: snapshot.productId,
          transactionId,
          originalTransactionId: snapshot.original_transaction_id ?? null,
          purchaseToken: snapshot.purchase_token ?? null,
          purchasedAt:
            this.parseDate(snapshot.purchase_date) ??
            this.parseDate(snapshot.original_purchase_date),
          effectiveFrom:
            this.parseDate(snapshot.purchase_date) ??
            this.parseDate(snapshot.original_purchase_date),
          effectiveTo: this.parseDate(snapshot.expires_date),
          status,
          rawSnapshot: snapshot as any,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        this.logger.debug(
          `忽略重复 RevenueCat 交易: transactionId=${transactionId ?? 'none'}, providerEventId=${providerEventId ?? 'none'}`,
        );
        return;
      }
      throw error;
    }
  }

  private mapActionToTransactionType(action: string): string {
    switch (action) {
      case 'activate':
      case 'activate_cancelled':
      case 'activate_grace_period':
        return 'initial_purchase';
      case 'renew':
        return 'renewal';
      case 'cancel':
        return 'cancellation';
      case 'refund':
        return 'refund';
      case 'expire':
        return 'expiration';
      default:
        return 'resync';
    }
  }

  private determineRevenueCatStatus(params: {
    expiresAt: Date;
    cancelledAt?: Date | null;
    billingIssueAt?: Date | null;
  }): SubscriptionStatus {
    if (params.expiresAt <= new Date()) return SubscriptionStatus.EXPIRED;
    if (params.cancelledAt) return SubscriptionStatus.CANCELLED;
    if (params.billingIssueAt) return SubscriptionStatus.GRACE_PERIOD;
    return SubscriptionStatus.ACTIVE;
  }

  private serializeSubscriptionState(
    subscription: any,
  ): Record<string, unknown> {
    if (!subscription) return {};
    return {
      id: subscription.id,
      userId: subscription.userId,
      planId: subscription.planId,
      planTier: subscription.subscriptionPlan?.tier ?? null,
      status: subscription.status,
      paymentChannel: subscription.paymentChannel,
      startsAt: subscription.startsAt?.toISOString?.() ?? null,
      expiresAt: subscription.expiresAt?.toISOString?.() ?? null,
      cancelledAt: subscription.cancelledAt?.toISOString?.() ?? null,
      autoRenew: subscription.autoRenew,
      platformSubscriptionId: subscription.platformSubscriptionId,
      gracePeriodEndsAt:
        subscription.gracePeriodEndsAt?.toISOString?.() ?? null,
    };
  }

  private async markWebhookProcessed(webhookEventId: string): Promise<void> {
    await this.prisma.billingWebhookEvents.update({
      where: { id: webhookEventId },
      data: {
        processingStatus: 'processed',
        processedAt: new Date(),
        lastError: null,
      },
    });
  }

  private async markWebhookFailed(
    webhookEventId: string,
    error: unknown,
  ): Promise<void> {
    await this.prisma.billingWebhookEvents.update({
      where: { id: webhookEventId },
      data: {
        processingStatus: 'failed',
        retryCount: { increment: 1 },
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
