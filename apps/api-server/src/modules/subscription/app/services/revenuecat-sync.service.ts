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
import {
  QUEUE_DEFAULT_OPTIONS,
  QUEUE_NAMES,
  QueueProducer,
} from '../../../../core/queue';
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
    private readonly queueProducer: QueueProducer,
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

  /**
   * 通过 RevenueCat appUserId（非 UUID）解析内部 userId。
   *
   * RevenueCat 匿名用户的 app_user_id 格式为 "$RCAnonymousID:xxx"；
   * 登录后 RC 会保留旧别名。我们在 subscriptionProviderCustomer 表中存储了
   * providerCustomerId 和 aliases，据此反查。
   */
  private async resolveUserIdFromAlias(
    appUserId: string,
  ): Promise<string | null> {
    // 1. 直接按 providerCustomerId 查
    const byCustomerId =
      await this.prisma.subscriptionProviderCustomer.findFirst({
        where: {
          provider: 'revenuecat',
          providerCustomerId: appUserId,
        },
        select: { userId: true },
      });
    if (byCustomerId) return byCustomerId.userId;

    // 2. 按 aliases JSON 数组查（PostgreSQL @> 操作符）
    const byAlias = await this.prisma.subscriptionProviderCustomer.findFirst({
      where: {
        provider: 'revenuecat',
        aliases: { array_contains: appUserId },
      },
      select: { userId: true },
    });
    return byAlias?.userId ?? null;
  }

  async ingestWebhook(
    payload: RevenueCatWebhookPayload,
  ): Promise<RevenueCatWebhookIngestResult> {
    const event = payload?.event ?? null;
    // TRANSFER 事件的 app_user_id 可能为空，尝试从 transferred_to / aliases 里取新用户 ID
    const transferredTo = (event as any)?.transferred_to;
    const appUserId =
      event?.app_user_id ??
      event?.original_app_user_id ??
      (Array.isArray(transferredTo)
        ? (transferredTo[0] ?? null)
        : (transferredTo ?? null)) ??
      (Array.isArray(event?.aliases) ? (event.aliases[0] ?? null) : null) ??
      null;
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

    if (appUserId) {
      // 非 UUID appUserId: RevenueCat 匿名用户 ($RCAnonymousID:xxx) 或自定义字符串。
      // 尝试通过 subscriptionProviderCustomer 别名表解析出真实 userId。
      // 无论 UUID 与否，一律入队异步处理，避免同步阻塞 webhook 响应。
      const resolvedUserId = this.isUuid(appUserId)
        ? appUserId
        : await this.resolveUserIdFromAlias(appUserId);

      if (!resolvedUserId) {
        this.logger.warn(
          `RevenueCat webhook: 无法解析 appUserId 到内部用户 (appUserId=${appUserId})，` +
            `已落库 webhookEventId=${webhookEvent.id}，等待 reconcile cron 重试`,
        );
        // 不标记 processed — 留给 retryFailedWebhookEvents / reconcile cron 重试
      } else {
        const queueConfig =
          QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE];
        const enqueueResult = await this.queueProducer.enqueue(
          QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE,
          'process_revenuecat_event',
          {
            action: 'process_revenuecat_event' as const,
            userId: resolvedUserId,
            webhookEventId: webhookEvent.id,
            providerEventId,
            source: 'revenuecat_webhook' as const,
          },
          {
            attempts: queueConfig.maxRetries + 1,
            backoff: {
              type: queueConfig.backoffType,
              delay: queueConfig.backoffDelay,
            },
            removeOnComplete: 50,
            removeOnFail: 100,
            jobId: `rc-webhook:${webhookEvent.id}`,
          },
        );

        if (enqueueResult.mode === 'sync') {
          // BullMQ 降级：Redis 不可用时同步执行，保证事件不丢失
          try {
            await this.triggerSyncForUser(
              resolvedUserId,
              'revenuecat_webhook',
              webhookEvent.id,
              providerEventId,
            );
            await this.markWebhookProcessed(webhookEvent.id);
          } catch (error) {
            await this.markWebhookFailed(webhookEvent.id, error);
            throw error;
          }
        }
        // 'queued' / 'tasks' 路径: processor 负责调用 triggerSyncForUser + markWebhookProcessed
      }
    }

    return result;
  }

  async triggerSyncForUser(
    userId: string,
    source: 'client_trigger' | 'revenuecat_webhook',
    webhookEventId?: string,
    providerEventId?: string,
  ): Promise<RevenueCatSyncTriggerResult> {
    const lockKey = `subscription:rc-sync:${userId}`;
    const lockTtlMs = 8 * 1000; // reduced from 15s — webhook retries handle contention
    const lockToken = `${source}:${providerEventId ?? webhookEventId ?? 'direct'}:${Date.now()}`;

    if (this.redis.isConfigured) {
      const acquired = await this.redis.setNX(lockKey, lockToken, lockTtlMs);
      if (!acquired) {
        if (source === 'revenuecat_webhook') {
          // Webhook processing must not be silently dropped — throw so BullMQ
          // retries via its backoff schedule rather than marking as processed.
          throw new Error(
            `RevenueCat sync lock busy (userId=${userId}), webhook will be retried`,
          );
        }
        // client_trigger: silent skip is acceptable; the client will poll again.
        this.logger.log(
          `RevenueCat sync skipped due to in-flight sync: userId=${userId}, source=${source}`,
        );
        return {
          accepted: true,
          source,
          userId,
          queuedAt: new Date().toISOString(),
          webhookEventId: webhookEventId ?? null,
        };
      }
    }

    try {
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

      const currentSubscription = await this.prisma.subscription.findFirst({
        where: {
          OR: [
            {
              userId,
              paymentChannel: {
                in: [PaymentChannel.APPLE_IAP, PaymentChannel.GOOGLE_PLAY],
              },
              status: SubscriptionStatus.ACTIVE,
            },
            {
              userId,
              paymentChannel: {
                in: [PaymentChannel.APPLE_IAP, PaymentChannel.GOOGLE_PLAY],
              },
              status: SubscriptionStatus.GRACE_PERIOD,
            },
            {
              userId,
              paymentChannel: {
                in: [PaymentChannel.APPLE_IAP, PaymentChannel.GOOGLE_PLAY],
              },
              status: SubscriptionStatus.CANCELLED,
              expiresAt: { gte: new Date() },
            },
          ],
        },
        orderBy: { expiresAt: 'desc' },
      });

      const beforeSummary =
        await this.subscriptionService.getUserSummary(userId);

      // 对纯手工会员 / 微信 / 支付宝用户，不要走 RevenueCat 快照收敛，
      // 否则会因 RC 空快照把本地非 RC 订阅误撤销为 free。
      // 但 free/首次购买场景必须允许向 RC 拉快照，否则客户端购买成功后后端永远收敛不到新订阅。
      if (
        !currentSubscription &&
        source === 'client_trigger' &&
        beforeSummary.tier !== SubscriptionTier.FREE &&
        beforeSummary.subscriptionId
      ) {
        result.currentTier = beforeSummary.tier;
        result.currentSubscriptionId = beforeSummary.subscriptionId;
        result.snapshotFetched = false;
        this.logger.log(
          [
            'RevenueCat sync skipped',
            `source=${source}`,
            `userId=${userId}`,
            `tier=${beforeSummary.tier}`,
            'reason=non_rc_subscription_without_local_rc_record',
          ].join(' | '),
        );
        return result;
      }

      const subscriberLookupId = await this.resolveSubscriberLookupId(userId);
      const snapshot = await this.fetchSubscriberSnapshot(subscriberLookupId);
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
    } finally {
      if (this.redis.isConfigured) {
        await this.redis.del(lockKey);
      }
    }
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
        paymentChannel: {
          in: [PaymentChannel.APPLE_IAP, PaymentChannel.GOOGLE_PLAY],
        },
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.GRACE_PERIOD,
            SubscriptionStatus.CANCELLED,
          ],
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { userId: true },
    });

    // Deduplicate by userId — a user with N subscription rows must only be
    // synced once per reconcile tick, otherwise each row generates another
    // triggerSyncForUser call which (when providerSubscriptionKey is null)
    // can create a new orphan row on every iteration, leading to exponential growth.
    const uniqueUserIds = [...new Set(recentSubs.map((s) => s.userId))];

    for (const userId of uniqueUserIds) {
      try {
        await this.triggerSyncForUser(userId, 'client_trigger');
      } catch (error) {
        this.logger.warn(
          `RevenueCat reconcile failed: userId=${userId}, error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async backfillPlatformSubscriptionIdsFromRevenueCat(): Promise<number> {
    const result = await this.prisma.$executeRaw`
      UPDATE subscription s
      SET platform_subscription_id = bwe.original_transaction_id,
          updated_at = NOW()
      FROM billing_webhook_events bwe
      WHERE bwe.provider = 'revenuecat'
        AND bwe.original_transaction_id IS NOT NULL
        AND s.user_id = bwe.app_user_id::uuid
        AND s.payment_channel IN ('apple_iap', 'google_play')
        AND s.platform_subscription_id IS NULL
        AND s.created_at <= bwe.received_at
        AND s.expires_at >= (bwe.event_timestamp - INTERVAL '1 hour')
    `;
    return Number(result);
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

  private async resolveSubscriberLookupId(userId: string): Promise<string> {
    const providerCustomerModel = (this.prisma as any)
      .subscriptionProviderCustomer;
    if (!providerCustomerModel) {
      return userId;
    }

    const providerCustomer = await providerCustomerModel.findFirst({
      where: {
        userId,
        provider: 'revenuecat',
        status: 'active',
      },
      orderBy: [{ lastSyncedAt: 'desc' }, { updatedAt: 'desc' }],
      select: { providerCustomerId: true, environment: true },
    });

    if (providerCustomer?.providerCustomerId) {
      return providerCustomer.providerCustomerId;
    }

    const preferredEnvironment =
      this.configService.get<string>('SUBSCRIPTION_STORE_ENV') ?? 'production';

    const fallbackProviderCustomer = await providerCustomerModel.findFirst({
      where: {
        userId,
        provider: 'revenuecat',
        status: 'active',
        environment: preferredEnvironment,
      },
      orderBy: [{ lastSyncedAt: 'desc' }, { updatedAt: 'desc' }],
      select: { providerCustomerId: true },
    });

    return fallbackProviderCustomer?.providerCustomerId || userId;
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
    const webhookEvent = webhookEventId
      ? await this.prisma.billingWebhookEvents.findUnique({
          where: { id: webhookEventId },
          select: { originalTransactionId: true },
        })
      : null;
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
      candidate?.original_transaction_id ??
      webhookEvent?.originalTransactionId ??
      candidate?.purchase_token ??
      null;
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

    // Prefer exact match by platformSubscriptionId (prevents wrong-row updates
    // that would violate the unique constraint on user_id+payment_channel+platform_subscription_id).
    // Falls back to finding any live subscription for the user when the key is
    // unknown (e.g. client_trigger with no original_transaction_id in snapshot).
    const iapChannels = [PaymentChannel.APPLE_IAP, PaymentChannel.GOOGLE_PLAY];
    let currentSub = providerSubscriptionKey
      ? await this.prisma.subscription.findFirst({
          where: {
            userId,
            paymentChannel: { in: iapChannels },
            platformSubscriptionId: providerSubscriptionKey,
          },
          include: { subscriptionPlan: true },
          orderBy: { expiresAt: 'desc' },
        })
      : null;

    if (!currentSub) {
      currentSub = await this.prisma.subscription.findFirst({
        where: {
          OR: [
            {
              userId,
              paymentChannel: { in: iapChannels },
              status: SubscriptionStatus.ACTIVE,
            },
            {
              userId,
              paymentChannel: { in: iapChannels },
              status: SubscriptionStatus.GRACE_PERIOD,
            },
            {
              userId,
              paymentChannel: { in: iapChannels },
              status: SubscriptionStatus.CANCELLED,
              expiresAt: { gte: new Date() },
            },
          ],
        },
        include: { subscriptionPlan: true },
        orderBy: { expiresAt: 'desc' },
      });
    }

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
          platformSubscriptionId:
            providerSubscriptionKey ?? currentSub.platformSubscriptionId,
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
        (currentSub.platformSubscriptionId === providerSubscriptionKey ||
          !currentSub.platformSubscriptionId ||
          // When providerSubscriptionKey is unknown (no original_transaction_id
          // in snapshot), reuse the found subscription instead of creating a
          // duplicate row. The platformSubscriptionId will stay unchanged.
          !providerSubscriptionKey)
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
            platformSubscriptionId:
              providerSubscriptionKey ?? currentSub.platformSubscriptionId,
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
          platformSubscriptionId:
            providerSubscriptionKey ?? currentSub.platformSubscriptionId,
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
          platformSubscriptionId:
            providerSubscriptionKey ?? currentSub.platformSubscriptionId,
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
    } else if (!candidate && currentSub) {
      // C5a: RC 返回空订阅快照（无任何购买记录），但本地有 active 订阅。
      //
      // 注意：RC Sandbox 购买后快照同步存在延迟（数秒~数分钟），reconcile cron
      // 可能在 webhook 到达前先跑，此时 RC 快照为空并不代表真正撤销。
      // 因此：
      //  - webhook 触发（source=revenuecat_webhook）：确实是 RC 推送的空快照，可以撤销
      //  - cron/client_trigger：不确定，跳过撤销，等待下一次 webhook 或 reconcile
      if (source === 'revenuecat_webhook') {
        this.logger.warn(
          `RevenueCat webhook 快照无活跃订阅，强制撤销: userId=${userId}, subscriptionId=${currentSub.id}`,
        );
        const revoked = await this.prisma.subscription.update({
          where: { id: currentSub.id },
          data: {
            status: SubscriptionStatus.REVOKED,
            autoRenew: false,
            platformSubscriptionId:
              providerSubscriptionKey ?? currentSub.platformSubscriptionId,
            expiresAt: new Date(),
            gracePeriodEndsAt: null,
          },
        });
        await this.domainSync.syncUserEntitlementsFromSubscription({
          subscription: revoked as any,
          provider: 'revenuecat',
          providerCustomerId,
          lastEventAt: new Date(),
        });
        action = 'revoke';
        cacheInvalidated = true;
      } else {
        // cron / client_trigger：快照为空可能是同步延迟，跳过撤销，保留本地订阅状态
        this.logger.log(
          `RevenueCat 快照暂无活跃订阅（source=${source}），跳过撤销，等待 webhook 确认: userId=${userId}, subscriptionId=${currentSub.id}`,
        );
        action = 'noop';
      }
    } else if (candidate?.productId && !matchedPlan) {
      // C5b: 商品未映射到 subscription_plan — 这是配置问题，不能静默跳过。
      // 抛出异常使 BullMQ job 进入 failed 状态，触发 dead-letter 存储和告警。
      const msg =
        `RevenueCat 商品未映射到 subscription_plan: userId=${userId}, productId=${candidate.productId}` +
        `${providerEventId ? `, providerEventId=${providerEventId}` : ''}` +
        `. 请在管理后台添加商品映射后重新处理该 webhook event。`;
      this.logger.error(msg);
      throw new Error(msg);
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

  async markWebhookProcessed(webhookEventId: string): Promise<void> {
    await this.prisma.billingWebhookEvents.update({
      where: { id: webhookEventId },
      data: {
        processingStatus: 'processed',
        processedAt: new Date(),
        lastError: null,
      },
    });
  }

  async markWebhookFailed(
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
