import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  Prisma,
  SubscriptionPlan,
  Subscription,
  PaymentRecords as PaymentRecord,
  UsageQuota,
  SubscriptionTriggerLogs as SubscriptionTriggerLog,
  AppUsers as AppUser,
} from '@prisma/client';
import { Job, Queue } from 'bullmq';
import {
  SubscriptionStatus,
  SubscriptionTier,
  PaymentChannel,
  PaymentStatus,
  FeatureEntitlements,
  TIER_ENTITLEMENTS,
} from '../subscription.types';
import {
  GetSubscriptionPlansQueryDto,
  CreateSubscriptionPlanDto,
  UpdateSubscriptionPlanDto,
  GetSubscriptionsQueryDto,
  ExtendSubscriptionDto,
  ChangeSubscriptionPlanDto,
  SubscriptionResyncDto,
  AdminSubscriptionActionDto,
  GrantManualEntitlementDto,
  RevokeManualEntitlementDto,
  GetPaymentRecordsQueryDto,
  GetUsageQuotasQueryDto,
  GetTriggerStatsQueryDto,
  GetSubscriptionTimelineQueryDto,
  GetSubscriptionAnomaliesQueryDto,
  GetSubscriptionMaintenanceJobsQueryDto,
  GetSubscriptionMaintenanceDlqQueryDto,
} from './dto/subscription-management.dto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RevenueCatSyncService } from '../app/services/revenuecat-sync.service';
import { SubscriptionDomainSyncService } from '../app/services/subscription-domain-sync.service';
import { SubscriptionService } from '../app/services/subscription.service';
import {
  QUEUE_DEFAULT_OPTIONS,
  QUEUE_NAMES,
  QueueResilienceService,
} from '../../../core/queue';
import { DeadLetterService } from '../../../core/queue/dead-letter.service';
import type { SubscriptionStoreProductInputDto } from './dto/subscription-management.dto';

export type SubscriptionMaintenanceJobData =
  | {
      action: 'rebuild_entitlements';
      requestedBy: 'admin';
      reason?: string;
    }
  | {
      action: 'resync_subscription';
      subscriptionId: string;
      requestedBy: 'admin';
      reason?: string;
    };

export interface SubscriptionMaintenanceDispatchResult {
  mode: 'queued' | 'sync';
  jobId?: string;
  queuedAt: string;
  action: SubscriptionMaintenanceJobData['action'];
  result?: unknown;
}

@Injectable()
export class SubscriptionManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenueCatSyncService: RevenueCatSyncService,
    private readonly domainSync: SubscriptionDomainSyncService,
    private readonly subscriptionService: SubscriptionService,
    private readonly queueResilienceService: QueueResilienceService,
    private readonly deadLetterService: DeadLetterService,
    @InjectQueue(QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE)
    private readonly subscriptionMaintenanceQueue: Queue,
  ) {}

  // ==================== 订阅计划管理 ====================

  /**
   * 获取订阅计划列表（分页）
   */
  async findPlans(query: GetSubscriptionPlansQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const { tier, isActive } = query;

    const where: any = {};
    if (tier) {
      where.tier = tier;
    }
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        where,
        include: {
          storeProducts: {
            where: { isActive: true },
            orderBy: [{ provider: 'asc' }, { store: 'asc' }],
          },
          planEntitlements: {
            where: { isActive: true },
            orderBy: { entitlementCode: 'asc' },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.subscriptionPlan.count({ where }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 查询单个订阅计划（含完整 entitlements）
   */
  async findPlanById(id: string) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
    });
    if (!plan) {
      throw new NotFoundException(`订阅计划 #${id} 不存在`);
    }
    const [storeProducts, planEntitlements] = await Promise.all([
      (this.prisma as any).subscriptionStoreProduct?.findMany?.({
        where: { planId: id },
        orderBy: [{ provider: 'asc' }, { store: 'asc' }],
      }) ?? Promise.resolve([]),
      (this.prisma as any).subscriptionPlanEntitlement?.findMany?.({
        where: { planId: id },
        orderBy: { entitlementCode: 'asc' },
      }) ?? Promise.resolve([]),
    ]);
    return { ...plan, storeProducts, planEntitlements };
  }

  /**
   * 创建订阅计划
   */
  async createPlan(dto: CreateSubscriptionPlanDto) {
    this.assertValidStoreProducts(dto.tier, dto.storeProducts);
    const entitlements = this.resolveCreatePlanEntitlements(
      dto.tier,
      dto.entitlements,
    );

    const plan = await this.prisma.subscriptionPlan.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        tier: dto.tier,
        billingCycle: dto.billingCycle,
        priceCents: dto.priceCents,
        currency: dto.currency ?? 'CNY',
        entitlements: entitlements as any,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.domainSync.syncPlanCatalog(plan as any, dto.storeProducts ?? []);
    return plan;
  }

  /**
   * 更新订阅计划
   */
  async updatePlan(id: string, dto: UpdateSubscriptionPlanDto) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id },
    });

    if (!plan) {
      throw new NotFoundException(`订阅计划 #${id} 不存在`);
    }
    this.assertValidStoreProducts(
      dto.tier ?? (plan.tier as any),
      dto.storeProducts,
    );

    // 只更新传入的字段
    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.tier !== undefined) updateData.tier = dto.tier;
    if (dto.billingCycle !== undefined)
      updateData.billingCycle = dto.billingCycle;
    if (dto.priceCents !== undefined) updateData.priceCents = dto.priceCents;
    if (dto.currency !== undefined) updateData.currency = dto.currency;
    if (dto.entitlements !== undefined)
      updateData.entitlements = dto.entitlements;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    const updated = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: updateData,
    });
    await this.domainSync.syncPlanCatalog(updated as any, dto.storeProducts);
    return updated;
  }

  async rebuildUserEntitlements() {
    const queuedAt = new Date().toISOString();
    const jobData: SubscriptionMaintenanceJobData = {
      action: 'rebuild_entitlements',
      requestedBy: 'admin',
      reason: 'Admin rebuild user entitlements',
    };
    const queueConfig =
      QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE];
    const enqueueResult = await this.queueResilienceService.safeEnqueue(
      this.subscriptionMaintenanceQueue,
      jobData.action,
      jobData,
      {
        attempts: queueConfig.maxRetries + 1,
        backoff: {
          type: queueConfig.backoffType,
          delay: queueConfig.backoffDelay,
        },
        removeOnComplete: 20,
        removeOnFail: 50,
        jobId: `subscription:rebuild-entitlements:${Date.now()}`,
      },
    );

    if (enqueueResult.mode === 'sync') {
      const result = await this.performRebuildUserEntitlements();
      return {
        mode: 'sync' as const,
        queuedAt,
        action: jobData.action,
        result,
      };
    }

    return {
      mode: 'queued' as const,
      jobId: enqueueResult.jobId,
      queuedAt,
      action: jobData.action,
    };
  }

  private assertValidStoreProducts(
    tier: SubscriptionTier,
    storeProducts?: SubscriptionStoreProductInputDto[],
  ) {
    if (tier === SubscriptionTier.FREE || storeProducts === undefined) return;

    const activeProducts = storeProducts.filter(
      (item) => item.productId?.trim() && item.isActive !== false,
    );
    const hasApple = activeProducts.some(
      (item) => item.provider === 'revenuecat' && item.store === 'app_store',
    );
    const hasGoogle = activeProducts.some(
      (item) => item.provider === 'revenuecat' && item.store === 'play_store',
    );

    if (!hasApple || !hasGoogle) {
      throw new BadRequestException(
        '付费海外套餐必须配置 revenuecat/app_store 与 revenuecat/play_store 商品映射',
      );
    }
  }

  private resolveCreatePlanEntitlements(
    tier: SubscriptionTier,
    entitlements: FeatureEntitlements | undefined,
  ) {
    if (!entitlements || Object.keys(entitlements).length === 0) {
      return { ...TIER_ENTITLEMENTS[tier] };
    }
    return {
      ...TIER_ENTITLEMENTS[tier],
      ...entitlements,
    };
  }

  // ==================== 用户订阅管理 ====================

  /**
   * 获取用户订阅列表（分页，含用户和计划信息）
   */
  async findSubscriptions(query: GetSubscriptionsQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const {
      userId,
      status,
      tier,
      paymentChannel,
      planId,
      startDate,
      endDate,
      keyword,
      platformSubscriptionId,
      productId,
      hasRefundRecord,
      hasManualEntitlement,
      hasRevenueCatSignal,
      webhookProcessingStatus,
      sortBy,
      sortOrder,
    } = query;

    const where: any = {};
    if (userId) {
      where.userId = userId;
    }
    if (status) {
      where.status = status;
    }
    if (tier) {
      where.subscriptionPlan = {
        is: { tier },
      };
    }
    if (paymentChannel) {
      where.paymentChannel = paymentChannel;
    }
    if (planId) {
      where.planId = planId;
    }
    if (platformSubscriptionId?.trim()) {
      where.platformSubscriptionId = {
        contains: platformSubscriptionId.trim(),
        mode: 'insensitive',
      };
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const normalizedKeyword = keyword?.trim();
    if (normalizedKeyword) {
      const matchedUsers = await this.prisma.appUsers.findMany({
        where: {
          OR: [
            {
              id: normalizedKeyword.match(/^[0-9a-f-]{36}$/i)
                ? normalizedKeyword
                : undefined,
            },
            { nickname: { contains: normalizedKeyword, mode: 'insensitive' } },
            { email: { contains: normalizedKeyword, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 100,
      });

      const matchedUserIds = matchedUsers.map((user) => user.id);
      if (normalizedKeyword.match(/^[0-9a-f-]{36}$/i)) {
        matchedUserIds.push(normalizedKeyword);
      }

      const uniqueUserIds = [...new Set(matchedUserIds)];
      if (uniqueUserIds.length === 0) {
        return {
          list: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        };
      }

      where.userId = where.userId
        ? { in: uniqueUserIds.filter((id) => id === where.userId) }
        : { in: uniqueUserIds };
    }

    const normalizedProductId = productId?.trim();
    if (normalizedProductId) {
      const [matchedPlans, matchedTransactions, matchedWebhookUsers] =
        await Promise.all([
          (this.prisma as any).subscriptionStoreProduct.findMany({
            where: {
              productId: {
                contains: normalizedProductId,
                mode: 'insensitive',
              },
            },
            select: { planId: true },
          }),
          this.prisma.subscriptionTransactions.findMany({
            where: {
              storeProductId: {
                contains: normalizedProductId,
                mode: 'insensitive',
              },
            },
            select: { subscriptionId: true },
            take: 100,
          }),
          this.prisma.billingWebhookEvents.findMany({
            where: {
              productId: { contains: normalizedProductId, mode: 'insensitive' },
            },
            select: { appUserId: true },
            take: 100,
          }),
        ]);

      const matchedPlanIds = matchedPlans.map((item: any) => item.planId);
      const matchedSubscriptionIds = matchedTransactions
        .map((item) => item.subscriptionId)
        .filter((value): value is string => !!value);
      const matchedWebhookUserIds = matchedWebhookUsers
        .map((item) => item.appUserId)
        .filter((value): value is string => this.isUuid(value));

      if (
        matchedPlanIds.length === 0 &&
        matchedSubscriptionIds.length === 0 &&
        matchedWebhookUserIds.length === 0
      ) {
        return {
          list: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        };
      }

      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            ...(matchedPlanIds.length
              ? [{ planId: { in: matchedPlanIds } }]
              : []),
            ...(matchedSubscriptionIds.length
              ? [{ id: { in: [...new Set(matchedSubscriptionIds)] } }]
              : []),
            ...(matchedWebhookUserIds.length
              ? [{ userId: { in: [...new Set(matchedWebhookUserIds)] } }]
              : []),
          ],
        },
      ];
    }

    if (hasRefundRecord !== undefined) {
      const refundCandidates = await this.prisma.paymentRecords.findMany({
        where: hasRefundRecord
          ? {
              OR: [
                { refundedAt: { not: null } },
                { status: 'refunded' as any },
              ],
            }
          : {
              refundedAt: null,
              status: { not: 'refunded' as any },
            },
        select: { subscriptionId: true, userId: true },
        take: 5000,
      });
      const matchedSubscriptionIds = [
        ...new Set(
          refundCandidates
            .map((item) => item.subscriptionId)
            .filter((value): value is string => !!value),
        ),
      ];
      const matchedUserIds = [
        ...new Set(refundCandidates.map((item) => item.userId)),
      ];
      if (
        hasRefundRecord &&
        !matchedSubscriptionIds.length &&
        !matchedUserIds.length
      ) {
        return { list: [], total: 0, page, pageSize, totalPages: 0 };
      }
      where.AND = [
        ...(where.AND ?? []),
        hasRefundRecord
          ? {
              OR: [
                ...(matchedSubscriptionIds.length
                  ? [{ id: { in: matchedSubscriptionIds } }]
                  : []),
                ...(matchedUserIds.length
                  ? [{ userId: { in: matchedUserIds } }]
                  : []),
              ],
            }
          : {
              AND: [
                ...(matchedSubscriptionIds.length
                  ? [{ id: { notIn: matchedSubscriptionIds } }]
                  : []),
                ...(matchedUserIds.length
                  ? [{ userId: { notIn: matchedUserIds } }]
                  : []),
              ],
            },
      ];
    }

    if (hasManualEntitlement !== undefined) {
      const manualCandidates = await this.prisma.userEntitlement.findMany({
        where: {
          sourceType: 'manual',
          status: hasManualEntitlement ? 'active' : undefined,
        },
        select: { subscriptionId: true, userId: true },
        take: 5000,
      });
      const matchedSubscriptionIds = [
        ...new Set(
          manualCandidates
            .map((item) => item.subscriptionId)
            .filter((value): value is string => !!value),
        ),
      ];
      const matchedUserIds = [
        ...new Set(manualCandidates.map((item) => item.userId)),
      ];
      if (
        hasManualEntitlement &&
        !matchedSubscriptionIds.length &&
        !matchedUserIds.length
      ) {
        return { list: [], total: 0, page, pageSize, totalPages: 0 };
      }
      where.AND = [
        ...(where.AND ?? []),
        hasManualEntitlement
          ? {
              OR: [
                ...(matchedSubscriptionIds.length
                  ? [{ id: { in: matchedSubscriptionIds } }]
                  : []),
                ...(matchedUserIds.length
                  ? [{ userId: { in: matchedUserIds } }]
                  : []),
              ],
            }
          : {
              AND: [
                ...(matchedSubscriptionIds.length
                  ? [{ id: { notIn: matchedSubscriptionIds } }]
                  : []),
                ...(matchedUserIds.length
                  ? [{ userId: { notIn: matchedUserIds } }]
                  : []),
              ],
            },
      ];
    }

    if (
      hasRevenueCatSignal !== undefined ||
      (webhookProcessingStatus && webhookProcessingStatus.trim().length > 0)
    ) {
      const [signalTransactions, signalWebhooks] = await Promise.all([
        this.prisma.subscriptionTransactions.findMany({
          where: { provider: 'revenuecat' },
          select: { subscriptionId: true, userId: true },
          take: 10000,
        }),
        this.prisma.billingWebhookEvents.findMany({
          where: {
            provider: 'revenuecat',
            ...(webhookProcessingStatus?.trim()
              ? { processingStatus: webhookProcessingStatus.trim() }
              : {}),
          },
          select: { appUserId: true },
          take: 10000,
        }),
      ]);

      const signalSubscriptionIds = [
        ...new Set(
          signalTransactions
            .map((item) => item.subscriptionId)
            .filter((value): value is string => !!value),
        ),
      ];
      const signalUserIds = [
        ...new Set([
          ...signalTransactions
            .map((item) => item.userId)
            .filter((value): value is string => !!value),
          ...signalWebhooks
            .map((item) => item.appUserId)
            .filter((value): value is string => this.isUuid(value)),
        ]),
      ];

      if (
        webhookProcessingStatus?.trim() &&
        !signalSubscriptionIds.length &&
        !signalUserIds.length
      ) {
        return { list: [], total: 0, page, pageSize, totalPages: 0 };
      }

      if (hasRevenueCatSignal !== undefined) {
        where.AND = [
          ...(where.AND ?? []),
          hasRevenueCatSignal
            ? {
                OR: [
                  ...(signalSubscriptionIds.length
                    ? [{ id: { in: signalSubscriptionIds } }]
                    : []),
                  ...(signalUserIds.length
                    ? [{ userId: { in: signalUserIds } }]
                    : []),
                ],
              }
            : {
                AND: [
                  ...(signalSubscriptionIds.length
                    ? [{ id: { notIn: signalSubscriptionIds } }]
                    : []),
                  ...(signalUserIds.length
                    ? [{ userId: { notIn: signalUserIds } }]
                    : []),
                ],
              },
        ];
      } else if (webhookProcessingStatus?.trim()) {
        where.AND = [
          ...(where.AND ?? []),
          {
            OR: [
              ...(signalUserIds.length
                ? [{ userId: { in: signalUserIds } }]
                : []),
            ],
          },
        ];
      }
    }

    const rawList = await this.prisma.subscription.findMany({
      where,
      include: { subscriptionPlan: true },
      orderBy:
        sortBy === 'expiresAt'
          ? { expiresAt: sortOrder === 'asc' ? 'asc' : 'desc' }
          : sortBy === 'createdAt'
            ? { createdAt: sortOrder === 'asc' ? 'asc' : 'desc' }
            : { createdAt: 'desc' },
    });
    const total = rawList.length;

    // 批量查询用户信息
    const userIds = [...new Set(rawList.map((s) => s.userId))];
    const users =
      userIds.length > 0
        ? await this.prisma.appUsers.findMany({
            where: { id: { in: userIds } },
            select: { id: true, nickname: true, avatar: true, email: true },
          })
        : [];

    const subscriptionIds = rawList.map((item) => item.id);
    const [
      latestAudits,
      latestTransactions,
      latestWebhookEvents,
      paymentSignals,
      manualEntitlements,
      activeStoreProducts,
    ] = await Promise.all([
      this.prisma.subscriptionAuditLogs.findMany({
        where: {
          OR: [
            { subscriptionId: { in: subscriptionIds } },
            { userId: { in: userIds } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: Math.max(subscriptionIds.length * 4, 20),
      }),
      this.prisma.subscriptionTransactions.findMany({
        where: {
          OR: [
            { subscriptionId: { in: subscriptionIds } },
            { userId: { in: userIds } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: Math.max(subscriptionIds.length * 4, 20),
      }),
      this.prisma.billingWebhookEvents.findMany({
        where: { appUserId: { in: userIds } },
        orderBy: { receivedAt: 'desc' },
        take: Math.max(subscriptionIds.length * 6, 30),
      }),
      this.prisma.paymentRecords.findMany({
        where: {
          OR: [
            { subscriptionId: { in: subscriptionIds } },
            { userId: { in: userIds } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: Math.max(subscriptionIds.length * 4, 20),
      }),
      this.prisma.userEntitlement.findMany({
        where: {
          userId: { in: userIds },
          sourceType: 'manual',
          status: 'active',
        },
        select: { subscriptionId: true, userId: true },
        take: Math.max(subscriptionIds.length * 2, 20),
      }),
      this.prisma.subscriptionStoreProduct.findMany({
        where: { isActive: true },
        select: { productId: true, offeringId: true, packageId: true },
      }),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const auditBySubscriptionId = new Map<
      string,
      (typeof latestAudits)[number]
    >();
    const auditByUserId = new Map<string, (typeof latestAudits)[number]>();
    const transactionBySubscriptionId = new Map<
      string,
      (typeof latestTransactions)[number]
    >();
    const transactionByUserId = new Map<
      string,
      (typeof latestTransactions)[number]
    >();
    const webhookByUserId = new Map<
      string,
      (typeof latestWebhookEvents)[number]
    >();
    const failedWebhookByUserId = new Map<
      string,
      (typeof latestWebhookEvents)[number]
    >();
    const refundSubscriptionIds = new Set<string>();
    const refundUserIds = new Set<string>();
    const manualEntitlementSubscriptionIds = new Set<string>();
    const manualEntitlementUserIds = new Set<string>();
    const mappingByProductId = new Map(
      activeStoreProducts.map((item) => [item.productId, item]),
    );

    for (const item of latestAudits) {
      if (
        item.subscriptionId &&
        !auditBySubscriptionId.has(item.subscriptionId)
      ) {
        auditBySubscriptionId.set(item.subscriptionId, item);
      }
      if (item.userId && !auditByUserId.has(item.userId)) {
        auditByUserId.set(item.userId, item);
      }
    }
    for (const item of latestTransactions) {
      if (
        item.subscriptionId &&
        !transactionBySubscriptionId.has(item.subscriptionId)
      ) {
        transactionBySubscriptionId.set(item.subscriptionId, item);
      }
      if (item.userId && !transactionByUserId.has(item.userId)) {
        transactionByUserId.set(item.userId, item);
      }
    }
    for (const item of latestWebhookEvents) {
      if (
        this.isUuid(item.appUserId) &&
        !webhookByUserId.has(item.appUserId!)
      ) {
        webhookByUserId.set(item.appUserId!, item);
      }
      if (
        this.isUuid(item.appUserId) &&
        item.processingStatus === 'failed' &&
        !failedWebhookByUserId.has(item.appUserId!)
      ) {
        failedWebhookByUserId.set(item.appUserId!, item);
      }
    }
    for (const item of paymentSignals) {
      if (
        item.subscriptionId &&
        (item.refundedAt || item.status === ('refunded' as any))
      ) {
        refundSubscriptionIds.add(item.subscriptionId);
      }
      if (item.refundedAt || item.status === ('refunded' as any)) {
        refundUserIds.add(item.userId);
      }
    }
    for (const item of manualEntitlements) {
      if (item.subscriptionId)
        manualEntitlementSubscriptionIds.add(item.subscriptionId);
      manualEntitlementUserIds.add(item.userId);
    }

    const aggregatedList = rawList.map((sub) => ({
      ...sub,
      plan: sub.subscriptionPlan,
      user: userMap.get(sub.userId) ?? null,
      lastSyncedAt:
        auditBySubscriptionId.get(sub.id)?.createdAt ??
        auditByUserId.get(sub.userId)?.createdAt ??
        webhookByUserId.get(sub.userId)?.processedAt ??
        webhookByUserId.get(sub.userId)?.receivedAt ??
        null,
      lastSyncSource:
        auditBySubscriptionId.get(sub.id)?.actorType ??
        auditByUserId.get(sub.userId)?.actorType ??
        (webhookByUserId.get(sub.userId) ? 'webhook' : null),
      lastSyncStatus: failedWebhookByUserId.has(sub.userId)
        ? 'failed'
        : auditBySubscriptionId.get(sub.id) ||
            auditByUserId.get(sub.userId) ||
            webhookByUserId.get(sub.userId)
          ? 'ok'
          : 'unknown',
      lastWebhookStatus:
        webhookByUserId.get(sub.userId)?.processingStatus ?? null,
      lastWebhookError:
        failedWebhookByUserId.get(sub.userId)?.lastError ?? null,
      latestStoreProductId:
        transactionBySubscriptionId.get(sub.id)?.storeProductId ??
        transactionByUserId.get(sub.userId)?.storeProductId ??
        null,
      latestMappedOfferingId:
        mappingByProductId.get(
          transactionBySubscriptionId.get(sub.id)?.storeProductId ??
            transactionByUserId.get(sub.userId)?.storeProductId ??
            '',
        )?.offeringId ?? null,
      latestMappedPackageId:
        mappingByProductId.get(
          transactionBySubscriptionId.get(sub.id)?.storeProductId ??
            transactionByUserId.get(sub.userId)?.storeProductId ??
            '',
        )?.packageId ?? null,
      latestTransactionAt:
        transactionBySubscriptionId.get(sub.id)?.createdAt ??
        transactionByUserId.get(sub.userId)?.createdAt ??
        null,
      latestTransactionType:
        transactionBySubscriptionId.get(sub.id)?.transactionType ??
        transactionByUserId.get(sub.userId)?.transactionType ??
        null,
      latestWebhookAt: webhookByUserId.get(sub.userId)?.receivedAt ?? null,
      latestWebhookEventType:
        webhookByUserId.get(sub.userId)?.eventType ?? null,
      hasRefundRecord:
        refundSubscriptionIds.has(sub.id) || refundUserIds.has(sub.userId),
      hasManualEntitlement:
        manualEntitlementSubscriptionIds.has(sub.id) ||
        manualEntitlementUserIds.has(sub.userId),
      hasRevenueCatSignal:
        transactionBySubscriptionId.has(sub.id) ||
        transactionByUserId.has(sub.userId) ||
        webhookByUserId.has(sub.userId),
    }));

    const sortedList = [...aggregatedList].sort((a, b) => {
      const direction = sortOrder === 'asc' ? 1 : -1;
      if (sortBy === 'latestTransactionAt') {
        return (
          ((a.latestTransactionAt
            ? new Date(a.latestTransactionAt).getTime()
            : 0) -
            (b.latestTransactionAt
              ? new Date(b.latestTransactionAt).getTime()
              : 0)) *
          direction
        );
      }
      if (sortBy === 'latestWebhookAt') {
        return (
          ((a.latestWebhookAt ? new Date(a.latestWebhookAt).getTime() : 0) -
            (b.latestWebhookAt ? new Date(b.latestWebhookAt).getTime() : 0)) *
          direction
        );
      }
      return (
        (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) *
        (sortOrder === 'asc' ? -1 : 1)
      );
    });

    const skip = (page - 1) * pageSize;
    const list = sortedList.slice(skip, skip + pageSize);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取订阅详情（含计划、支付记录、用量配额）
   */
  async getSubscriptionDetail(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        subscriptionPlan: {
          include: {
            storeProducts: {
              where: { isActive: true },
              orderBy: [{ provider: 'asc' }, { store: 'asc' }],
            },
          },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    // 查询用户信息
    const user = await this.prisma.appUsers.findUnique({
      where: { id: subscription.userId },
      select: { id: true, nickname: true, avatar: true, email: true },
    });

    // 查询关联支付记录
    const paymentRecords = await this.prisma.paymentRecords.findMany({
      where: { subscriptionId: id },
      orderBy: { createdAt: 'desc' },
    });

    // 查询用户用量配额
    const usageQuotas = await this.prisma.usageQuota.findMany({
      where: { userId: subscription.userId },
      orderBy: { feature: 'asc' },
    });

    const [userEntitlements, providerCustomers] = await Promise.all([
      this.prisma.userEntitlement.findMany({
        where: {
          OR: [{ subscriptionId: id }, { userId: subscription.userId }],
        },
        orderBy: [
          { status: 'asc' },
          { entitlementCode: 'asc' },
          { updatedAt: 'desc' },
        ],
      }),
      this.prisma.subscriptionProviderCustomer.findMany({
        where: { userId: subscription.userId },
        orderBy: [{ provider: 'asc' }, { updatedAt: 'desc' }],
      }),
    ]);

    return {
      ...subscription,
      plan: subscription.subscriptionPlan,
      user,
      paymentRecords,
      usageQuotas,
      userEntitlements,
      providerCustomers,
    };
  }

  async getSubscriptionTimeline(
    id: string,
    query: GetSubscriptionTimelineQueryDto,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const limit = query.limit ?? 50;
    const [audits, transactions, webhookEvents, activeStoreProducts] =
      await Promise.all([
        this.prisma.subscriptionAuditLogs.findMany({
          where: {
            OR: [{ subscriptionId: id }, { userId: subscription.userId }],
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.prisma.subscriptionTransactions.findMany({
          where: {
            OR: [{ subscriptionId: id }, { userId: subscription.userId }],
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.prisma.billingWebhookEvents.findMany({
          where: { appUserId: subscription.userId },
          orderBy: { receivedAt: 'desc' },
          take: limit,
        }),
        this.prisma.subscriptionStoreProduct.findMany({
          where: { isActive: true },
          select: {
            productId: true,
            offeringId: true,
            packageId: true,
          },
        }),
      ]);

    const mappingByProductId = new Map(
      activeStoreProducts.map((item) => [item.productId, item]),
    );

    return {
      subscriptionId: id,
      userId: subscription.userId,
      audits,
      transactions: transactions.map((item) => ({
        ...item,
        mappedOfferingId:
          item.storeProductId &&
          mappingByProductId.get(item.storeProductId)?.offeringId,
        mappedPackageId:
          item.storeProductId &&
          mappingByProductId.get(item.storeProductId)?.packageId,
      })),
      webhookEvents: webhookEvents.map((item) => ({
        ...item,
        mappedOfferingId:
          item.productId && mappingByProductId.get(item.productId)?.offeringId,
        mappedPackageId:
          item.productId && mappingByProductId.get(item.productId)?.packageId,
      })),
    };
  }

  async resyncSubscription(id: string, dto: SubscriptionResyncDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const queuedAt = new Date().toISOString();
    const jobData: SubscriptionMaintenanceJobData = {
      action: 'resync_subscription',
      subscriptionId: id,
      requestedBy: 'admin',
      reason: dto.reason ?? 'Admin manual resync',
    };
    const queueConfig =
      QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE];
    const enqueueResult = await this.queueResilienceService.safeEnqueue(
      this.subscriptionMaintenanceQueue,
      jobData.action,
      jobData,
      {
        attempts: queueConfig.maxRetries + 1,
        backoff: {
          type: queueConfig.backoffType,
          delay: queueConfig.backoffDelay,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
        jobId: `subscription:resync:${id}:${Date.now()}`,
      },
    );

    if (enqueueResult.mode === 'sync') {
      const result = await this.performResyncSubscription(id, dto);
      return {
        mode: 'sync' as const,
        queuedAt,
        action: jobData.action,
        result,
      };
    }

    return {
      mode: 'queued' as const,
      jobId: enqueueResult.jobId,
      queuedAt,
      action: jobData.action,
    };
  }

  async performRebuildUserEntitlements() {
    return this.domainSync.rebuildAllActiveUserEntitlements();
  }

  async performResyncSubscription(id: string, dto: SubscriptionResyncDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const isRevenueCatChannel = [
      PaymentChannel.APPLE_IAP,
      PaymentChannel.GOOGLE_PLAY,
    ].includes(subscription.paymentChannel as PaymentChannel);

    const result = isRevenueCatChannel
      ? await this.revenueCatSyncService.triggerSyncForUser(
          subscription.userId,
          'client_trigger',
        )
      : await this.syncSubscriptionState(subscription, {
          reason: dto.reason ?? 'Admin manual resync',
        });

    await this.prisma.subscriptionAuditLogs.create({
      data: {
        subscriptionId: subscription.id,
        userId: subscription.userId,
        actorType: 'admin',
        actorId: 'manual-resync',
        action: 'resync',
        runtimeEnv: process.env.NODE_ENV || 'unknown',
        beforeState: {},
        afterState: {},
        reason: dto.reason ?? 'Admin manual resync',
      },
    });

    return result;
  }

  /**
   * 延长订阅到期时间
   */
  async extendSubscription(id: string, dto: ExtendSubscriptionDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const baseDate =
      subscription.expiresAt > new Date() ? subscription.expiresAt : new Date();

    const newExpiresAt = new Date(baseDate);
    newExpiresAt.setDate(newExpiresAt.getDate() + dto.extendDays);

    const updateData: any = {
      expiresAt: newExpiresAt,
    };

    // 如果订阅已过期，自动恢复为活跃状态
    if (subscription.status === SubscriptionStatus.EXPIRED) {
      updateData.status = SubscriptionStatus.ACTIVE;
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: updateData,
    });

    await this.syncSubscriptionState(updated, {
      action: 'extend',
      reason: `Admin extend ${dto.extendDays} days`,
      afterState: {
        extendDays: dto.extendDays,
        expiresAt: newExpiresAt.toISOString(),
      },
    });

    return updated;
  }

  /**
   * 变更订阅计划
   */
  async changeSubscriptionPlan(id: string, dto: ChangeSubscriptionPlanDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const newPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.newPlanId },
    });

    if (!newPlan) {
      throw new NotFoundException(`订阅计划 #${dto.newPlanId} 不存在`);
    }

    if (!newPlan.isActive) {
      throw new BadRequestException('不能切换到未启用的订阅计划');
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: { planId: dto.newPlanId },
    });

    await this.syncSubscriptionState(updated, {
      action: 'change_plan',
      reason: `Admin change plan to ${dto.newPlanId}`,
      afterState: {
        previousPlanId: subscription.planId,
        planId: dto.newPlanId,
      },
    });

    return updated;
  }

  async refundSubscription(id: string, dto: AdminSubscriptionActionDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });
    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const now = new Date();
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.REFUNDED,
        autoRenew: false,
        cancelledAt: now,
        expiresAt: now,
        gracePeriodEndsAt: null,
      },
    });

    await this.prisma.paymentRecords.updateMany({
      where: {
        subscriptionId: id,
        status: { in: [PaymentStatus.SUCCESS, PaymentStatus.PENDING] as any },
      },
      data: {
        status: PaymentStatus.REFUNDED,
        refundedAt: now,
      },
    });

    await this.domainSync.syncUserEntitlementsFromSubscription({
      subscription: updated as any,
      provider: updated.paymentChannel,
      lastEventAt: now,
    });
    await this.subscriptionService.invalidateUserSummaryCache(updated.userId);
    await this.createAdminAuditLog(updated, 'refund', dto.reason, {
      refundedAt: now.toISOString(),
    });
    return updated;
  }

  async revokeSubscription(id: string, dto: AdminSubscriptionActionDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });
    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const now = new Date();
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.REVOKED,
        autoRenew: false,
        cancelledAt: now,
        expiresAt: now,
        gracePeriodEndsAt: null,
      },
    });

    await this.domainSync.syncUserEntitlementsFromSubscription({
      subscription: updated as any,
      provider: updated.paymentChannel,
      lastEventAt: now,
    });
    await this.subscriptionService.invalidateUserSummaryCache(updated.userId);
    await this.createAdminAuditLog(updated, 'revoke', dto.reason, {
      revokedAt: now.toISOString(),
    });
    return updated;
  }

  async grantManualEntitlement(id: string, dto: GrantManualEntitlementDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });
    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const now = new Date();
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    const sourceKey = `manual:${dto.entitlementCode}`;

    const record = await this.prisma.userEntitlement.upsert({
      where: {
        userId_entitlementCode_sourceType_sourceKey: {
          userId: subscription.userId,
          entitlementCode: dto.entitlementCode,
          sourceType: 'manual',
          sourceKey,
        },
      },
      create: {
        userId: subscription.userId,
        entitlementCode: dto.entitlementCode,
        sourceType: 'manual',
        sourceKey,
        sourceId: subscription.id,
        subscriptionId: subscription.id,
        provider: 'admin_manual',
        status: 'active',
        value: dto.value as any,
        effectiveFrom: now,
        effectiveTo,
        lastEventAt: now,
      },
      update: {
        status: 'active',
        value: dto.value as any,
        effectiveFrom: now,
        effectiveTo,
        lastEventAt: now,
        updatedAt: now,
      },
    });

    await this.subscriptionService.invalidateUserSummaryCache(
      subscription.userId,
    );
    await this.createAdminAuditLog(
      subscription,
      'grant_manual_entitlement',
      dto.reason,
      {
        entitlementCode: dto.entitlementCode,
        value: dto.value,
        effectiveTo: effectiveTo?.toISOString() ?? null,
      },
    );
    return record;
  }

  async revokeManualEntitlement(id: string, dto: RevokeManualEntitlementDto) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
    });
    if (!subscription) {
      throw new NotFoundException(`订阅记录 #${id} 不存在`);
    }

    const record = await this.prisma.userEntitlement.findUnique({
      where: { id: dto.userEntitlementId },
    });
    if (!record || record.userId !== subscription.userId) {
      throw new NotFoundException(
        `用户权益记录 #${dto.userEntitlementId} 不存在`,
      );
    }
    if (record.sourceType !== 'manual') {
      throw new BadRequestException('仅支持撤销手动授予的权益记录');
    }

    const now = new Date();
    const updated = await this.prisma.userEntitlement.update({
      where: { id: dto.userEntitlementId },
      data: {
        status: 'inactive',
        effectiveTo: now,
        lastEventAt: now,
      },
    });

    await this.subscriptionService.invalidateUserSummaryCache(
      subscription.userId,
    );
    await this.createAdminAuditLog(
      subscription,
      'revoke_manual_entitlement',
      dto.reason,
      {
        entitlementCode: record.entitlementCode,
        userEntitlementId: record.id,
      },
    );
    return updated;
  }

  private async createAdminAuditLog(
    subscription: { id: string; userId: string; status?: string },
    action: string,
    reason?: string,
    afterState: Record<string, unknown> = {},
  ) {
    await this.prisma.subscriptionAuditLogs.create({
      data: {
        subscriptionId: subscription.id,
        userId: subscription.userId,
        actorType: 'admin',
        actorId: 'admin-console',
        action,
        runtimeEnv: process.env.NODE_ENV || 'unknown',
        beforeState: { status: subscription.status ?? null } as any,
        afterState: afterState as any,
        reason: reason ?? action,
      },
    });
  }

  private async syncSubscriptionState(
    subscription: Subscription,
    options?: {
      action?: string;
      reason?: string;
      afterState?: Record<string, unknown>;
    },
  ) {
    const now = new Date();
    await this.domainSync.syncUserEntitlementsFromSubscription({
      subscription: subscription as any,
      provider: subscription.paymentChannel,
      lastEventAt: now,
    });
    await this.subscriptionService.invalidateUserSummaryCache(
      subscription.userId,
    );

    if (options?.action) {
      await this.createAdminAuditLog(
        subscription,
        options.action,
        options.reason,
        options.afterState,
      );
    }

    return {
      accepted: true,
      source: 'admin_manual',
      userId: subscription.userId,
      queuedAt: now.toISOString(),
      currentSubscriptionId: subscription.id,
    };
  }

  // ==================== 支付记录管理 ====================

  /**
   * 获取支付记录列表（分页，含用户信息）
   */
  async findPaymentRecords(query: GetPaymentRecordsQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const { userId, status, channel, startDate, endDate, orderNo } = query;

    const where: any = {};
    if (userId) {
      where.userId = userId;
    }
    if (status) {
      where.status = status;
    }
    if (channel) {
      where.channel = channel;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }
    if (orderNo) {
      where.orderNo = { contains: orderNo };
    }

    const skip = (page - 1) * pageSize;

    const [rawList, total] = await Promise.all([
      this.prisma.paymentRecords.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.paymentRecords.count({ where }),
    ]);

    // 批量查询用户信息
    const userIds = [...new Set(rawList.map((r) => r.userId))];
    const subscriptionIds = [
      ...new Set(
        rawList
          .map((record) => record.subscriptionId)
          .filter((value): value is string => !!value),
      ),
    ];
    const users =
      userIds.length > 0
        ? await this.prisma.appUsers.findMany({
            where: { id: { in: userIds } },
            select: { id: true, nickname: true, avatar: true, email: true },
          })
        : [];
    const subscriptions =
      subscriptionIds.length > 0
        ? await this.prisma.subscription.findMany({
            where: { id: { in: subscriptionIds } },
            include: { subscriptionPlan: true },
          })
        : [];

    const userMap = new Map(users.map((u) => [u.id, u]));
    const subscriptionMap = new Map(
      subscriptions.map((item) => [item.id, item]),
    );

    const list = rawList.map((record) => {
      const subscription = record.subscriptionId
        ? subscriptionMap.get(record.subscriptionId)
        : null;
      return {
        ...record,
        user: userMap.get(record.userId) ?? null,
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              expiresAt: subscription.expiresAt,
              plan: subscription.subscriptionPlan
                ? {
                    id: subscription.subscriptionPlan.id,
                    name: subscription.subscriptionPlan.name,
                    tier: subscription.subscriptionPlan.tier,
                    billingCycle: subscription.subscriptionPlan.billingCycle,
                  }
                : null,
            }
          : null,
      };
    });

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ==================== 用量配额管理 ====================

  /**
   * 查询用户用量配额
   */
  async getUserUsageQuotas(query: GetUsageQuotasQueryDto) {
    const { userId, feature } = query;

    const where: any = { userId: userId };
    if (feature) {
      where.feature = feature;
    }

    const list = await this.prisma.usageQuota.findMany({
      where,
      orderBy: { feature: 'asc' },
    });

    return { list, userId };
  }

  /**
   * 重置用量配额（将 used 归零）
   */
  async resetUsageQuota(quotaId: string) {
    const quota = await this.prisma.usageQuota.findUnique({
      where: { id: quotaId },
    });

    if (!quota) {
      throw new NotFoundException(`用量配额记录 #${quotaId} 不存在`);
    }

    return this.prisma.usageQuota.update({
      where: { id: quotaId },
      data: { used: 0 },
    });
  }

  // ==================== 统计概览 ====================

  /**
   * 订阅概览统计
   * - 各等级订阅人数
   * - 活跃订阅数
   * - MRR（月经常性收入）
   * - 最近新增订阅
   */
  async getSubscriptionOverview() {
    const [totalSubscriptions, activeCount, tierStats, channelStats] =
      await Promise.all([
        this.prisma.subscription.count(),
        this.prisma.subscription.count({
          where: { status: SubscriptionStatus.ACTIVE },
        }),
        this.prisma.$queryRaw<Array<{ tier: string | null; count: number }>>`
      SELECT p.tier, COUNT(s.id)::int as count
      FROM subscription s
      LEFT JOIN subscription_plan p ON p.id = s.plan_id
      WHERE s.status = ${SubscriptionStatus.ACTIVE}
      GROUP BY p.tier`,
        this.prisma.$queryRaw<Array<{ channel: string; count: number }>>`
      SELECT payment_channel as channel, COUNT(id)::int as count
      FROM subscription
      WHERE status = ${SubscriptionStatus.ACTIVE}
      GROUP BY payment_channel`,
      ]);

    // MRR: 活跃订阅的月收入（将季度和年度价格折算为月度）
    const mrrResult = await this.prisma.$queryRaw<
      Array<{ mrr: number | null }>
    >`
      SELECT SUM(
        CASE p.billing_cycle
          WHEN 'monthly' THEN p.price_cents
          WHEN 'quarterly' THEN ROUND(p.price_cents / 3.0)
          WHEN 'yearly' THEN ROUND(p.price_cents / 12.0)
          ELSE 0
        END
      )::int as mrr
      FROM subscription s
      LEFT JOIN subscription_plan p ON p.id = s.plan_id
      WHERE s.status = ${SubscriptionStatus.ACTIVE}`;

    const mrr = (mrrResult as any)[0]?.mrr ?? 0;

    // 最近 7 天新增订阅数
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentNewSubscribers = await this.prisma.subscription.count({
      where: { createdAt: { gte: sevenDaysAgo } },
    });

    // 各状态订阅统计
    const statusStats = await this.prisma.$queryRaw`
      SELECT status, COUNT(id)::int as count
      FROM subscription
      GROUP BY status`;

    // 支付收入统计（本月成功支付总额）
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthlyRevenue = await this.prisma.$queryRaw<
      Array<{ total: number | null }>
    >`
      SELECT COALESCE(SUM(amount_cents), 0)::int as total
      FROM payment_records
      WHERE status = ${PaymentStatus.SUCCESS}
      AND paid_at >= ${monthStart}`;

    const byTier: Record<SubscriptionTier, number> = {
      [SubscriptionTier.FREE]: 0,
      [SubscriptionTier.PRO]: 0,
      [SubscriptionTier.PREMIUM]: 0,
    };
    for (const item of tierStats) {
      if (item.tier && item.tier in byTier) {
        byTier[item.tier as SubscriptionTier] = Number(item.count ?? 0);
      }
    }

    const byChannel = channelStats.reduce<Record<string, number>>(
      (acc, item) => {
        acc[item.channel] = Number(item.count ?? 0);
        return acc;
      },
      {},
    );

    return {
      totalSubscriptions,
      activeSubscriptions: activeCount,
      byTier,
      byChannel,
      currency: 'CNY',
      tierStats,
      activeCount,
      mrr,
      recentNewSubscribers,
      statusStats,
      monthlyRevenue: (monthlyRevenue as any)[0]?.total ?? 0,
    };
  }

  // ==================== 付费墙触发统计 ====================

  /**
   * 付费墙触发统计
   * - 按功能/场景分组的触发次数
   * - 转化率
   */
  async getTriggerStats(query: GetTriggerStatsQueryDto) {
    const { days = 30, feature, triggerScene } = query;

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    // 按功能分组统计
    const byFeature = await this.prisma.$queryRaw<
      Array<{ feature: string; totalTriggers: number; conversions: number }>
    >`
      SELECT feature, COUNT(id)::int as "totalTriggers",
        SUM(CASE WHEN converted = true THEN 1 ELSE 0 END)::int as conversions
      FROM subscription_trigger_logs
      WHERE created_at >= ${sinceDate}
      ${feature ? Prisma.sql`AND feature = ${feature}` : Prisma.empty}
      ${triggerScene ? Prisma.sql`AND trigger_scene = ${triggerScene}` : Prisma.empty}
      GROUP BY feature`;

    // 按场景分组统计
    const byScene = await this.prisma.$queryRaw<
      Array<{
        triggerScene: string;
        totalTriggers: number;
        conversions: number;
      }>
    >`
      SELECT trigger_scene as "triggerScene", COUNT(id)::int as "totalTriggers",
        SUM(CASE WHEN converted = true THEN 1 ELSE 0 END)::int as conversions
      FROM subscription_trigger_logs
      WHERE created_at >= ${sinceDate}
      ${feature ? Prisma.sql`AND feature = ${feature}` : Prisma.empty}
      ${triggerScene ? Prisma.sql`AND trigger_scene = ${triggerScene}` : Prisma.empty}
      GROUP BY trigger_scene`;

    // 计算转化率
    const enrichWithRate = (
      items: Array<{ totalTriggers: number; conversions: number }>,
    ) =>
      items.map((item) => {
        const total = Number(item.totalTriggers);
        const converted = Number(item.conversions);
        return {
          ...item,
          totalTriggers: total,
          conversions: converted,
          conversionRate:
            total > 0 ? +((converted / total) * 100).toFixed(2) : 0,
        };
      });

    // 按等级分组统计
    const byTier = await this.prisma.$queryRaw<
      Array<{
        currentTier: string;
        totalTriggers: number;
        conversions: number;
      }>
    >`
      SELECT current_tier as "currentTier", COUNT(id)::int as "totalTriggers",
        SUM(CASE WHEN converted = true THEN 1 ELSE 0 END)::int as conversions
      FROM subscription_trigger_logs
      WHERE created_at >= ${sinceDate}
      ${feature ? Prisma.sql`AND feature = ${feature}` : Prisma.empty}
      ${triggerScene ? Prisma.sql`AND trigger_scene = ${triggerScene}` : Prisma.empty}
      GROUP BY current_tier`;

    // 汇总
    const totalTriggers = byFeature.reduce(
      (sum, item) => sum + Number(item.totalTriggers),
      0,
    );
    const totalConversions = byFeature.reduce(
      (sum, item) => sum + Number(item.conversions),
      0,
    );

    return {
      days,
      totalTriggers,
      totalConversions,
      overallConversionRate:
        totalTriggers > 0
          ? +((totalConversions / totalTriggers) * 100).toFixed(2)
          : 0,
      byFeature: enrichWithRate(byFeature),
      byScene: enrichWithRate(byScene),
      byTier: enrichWithRate(byTier),
    };
  }

  async getSubscriptionAnomalies(query: GetSubscriptionAnomaliesQueryDto) {
    const limit = query.limit ?? 20;

    const [failedWebhooks, orphanTransactions, activeSubscriptions] =
      await Promise.all([
        this.prisma.billingWebhookEvents.findMany({
          where: {
            provider: 'revenuecat',
            processingStatus: 'failed',
          },
          orderBy: { receivedAt: 'desc' },
          take: limit,
        }),
        this.prisma.subscriptionTransactions.findMany({
          where: {
            provider: 'revenuecat',
            subscriptionId: null,
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.prisma.subscription.findMany({
          where: {
            status: {
              in: [
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.GRACE_PERIOD,
                SubscriptionStatus.CANCELLED,
              ],
            },
            paymentChannel: {
              in: ['apple_iap', 'google_play'],
            },
          },
          include: { subscriptionPlan: true },
          orderBy: { updatedAt: 'desc' },
          take: limit * 3,
        }),
      ]);

    const relatedUserIds = [
      ...new Set([
        ...failedWebhooks
          .map((item) => item.appUserId)
          .filter((value): value is string => this.isUuid(value)),
        ...orphanTransactions
          .map((item) => item.userId)
          .filter((value): value is string => this.isUuid(value)),
      ]),
    ];
    const relatedSubscriptions = relatedUserIds.length
      ? await this.prisma.subscription.findMany({
          where: { userId: { in: relatedUserIds } },
          orderBy: [{ updatedAt: 'desc' }],
          select: { id: true, userId: true },
        })
      : [];
    const relatedSubscriptionByUserId = new Map<string, string>();
    for (const item of relatedSubscriptions) {
      if (!relatedSubscriptionByUserId.has(item.userId)) {
        relatedSubscriptionByUserId.set(item.userId, item.id);
      }
    }

    const activeStoreProducts =
      await this.prisma.subscriptionStoreProduct.findMany({
        where: { isActive: true },
        select: {
          productId: true,
          offeringId: true,
          packageId: true,
        },
      });
    const mappedProductIds = new Set(
      activeStoreProducts.map((item) => item.productId),
    );
    const mappingByProductId = new Map(
      activeStoreProducts.map((item) => [item.productId, item]),
    );

    const [unmappedWebhookCandidates, unmappedTransactionCandidates] =
      await Promise.all([
        this.prisma.billingWebhookEvents.findMany({
          where: {
            provider: 'revenuecat',
            productId: { not: null },
          },
          orderBy: { receivedAt: 'desc' },
          take: limit * 10,
        }),
        this.prisma.subscriptionTransactions.findMany({
          where: {
            provider: 'revenuecat',
            storeProductId: { not: null },
          },
          orderBy: { createdAt: 'desc' },
          take: limit * 10,
        }),
      ]);

    const unmappedProducts = [
      ...unmappedWebhookCandidates
        .filter(
          (item) => item.productId && !mappedProductIds.has(item.productId),
        )
        .map((item) => ({
          source: 'webhook',
          productId: item.productId,
          mappedOfferingId:
            item.productId &&
            mappingByProductId.get(item.productId)?.offeringId,
          mappedPackageId:
            item.productId && mappingByProductId.get(item.productId)?.packageId,
          userId: item.appUserId,
          eventType: item.eventType,
          happenedAt: item.receivedAt,
        })),
      ...unmappedTransactionCandidates
        .filter(
          (item) =>
            item.storeProductId && !mappedProductIds.has(item.storeProductId),
        )
        .map((item) => ({
          source: 'transaction',
          productId: item.storeProductId,
          mappedOfferingId:
            item.storeProductId &&
            mappingByProductId.get(item.storeProductId)?.offeringId,
          mappedPackageId:
            item.storeProductId &&
            mappingByProductId.get(item.storeProductId)?.packageId,
          userId: item.userId,
          eventType: item.transactionType,
          happenedAt: item.createdAt,
        })),
    ]
      .filter(
        (item, index, self) =>
          self.findIndex(
            (candidate) =>
              `${candidate.source}:${candidate.productId}` ===
              `${item.source}:${item.productId}`,
          ) === index,
      )
      .slice(0, limit);

    const activeUserIds = [
      ...new Set(activeSubscriptions.map((item) => item.userId)),
    ];
    const activeSubscriptionIds = activeSubscriptions.map((item) => item.id);
    const [signalWebhooks, signalTransactions, activeUsers] = await Promise.all(
      [
        this.prisma.billingWebhookEvents.findMany({
          where: { appUserId: { in: activeUserIds } },
          select: { appUserId: true },
        }),
        this.prisma.subscriptionTransactions.findMany({
          where: {
            OR: [
              { subscriptionId: { in: activeSubscriptionIds } },
              { userId: { in: activeUserIds } },
            ],
          },
          select: { subscriptionId: true, userId: true },
        }),
        this.prisma.appUsers.findMany({
          where: { id: { in: activeUserIds } },
          select: { id: true, nickname: true, email: true },
        }),
      ],
    );

    const webhookSignalUsers = new Set(
      signalWebhooks
        .map((item) => item.appUserId)
        .filter((value): value is string => this.isUuid(value)),
    );
    const transactionSignalSubscriptions = new Set(
      signalTransactions
        .map((item) => item.subscriptionId)
        .filter((value): value is string => !!value),
    );
    const transactionSignalUsers = new Set(
      signalTransactions
        .map((item) => item.userId)
        .filter((value): value is string => !!value),
    );
    const activeUserMap = new Map(activeUsers.map((item) => [item.id, item]));

    const activeWithoutRevenueCatSignals = activeSubscriptions
      .filter(
        (item) =>
          !webhookSignalUsers.has(item.userId) &&
          !transactionSignalSubscriptions.has(item.id) &&
          !transactionSignalUsers.has(item.userId),
      )
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        userId: item.userId,
        user: activeUserMap.get(item.userId) ?? null,
        status: item.status,
        paymentChannel: item.paymentChannel,
        platformSubscriptionId: item.platformSubscriptionId,
        expiresAt: item.expiresAt,
        updatedAt: item.updatedAt,
        plan: item.subscriptionPlan,
      }));

    return {
      summary: {
        failedWebhookCount: failedWebhooks.length,
        orphanTransactionCount: orphanTransactions.length,
        unmappedProductCount: unmappedProducts.length,
        activeWithoutRevenueCatSignalCount:
          activeWithoutRevenueCatSignals.length,
      },
      failedWebhooks: failedWebhooks.map((item) => ({
        ...item,
        mappedOfferingId:
          item.productId && mappingByProductId.get(item.productId)?.offeringId,
        mappedPackageId:
          item.productId && mappingByProductId.get(item.productId)?.packageId,
        subscriptionId:
          item.appUserId && this.isUuid(item.appUserId)
            ? (relatedSubscriptionByUserId.get(item.appUserId) ?? null)
            : null,
      })),
      orphanTransactions: orphanTransactions.map((item) => ({
        ...item,
        mappedOfferingId:
          item.storeProductId &&
          mappingByProductId.get(item.storeProductId)?.offeringId,
        mappedPackageId:
          item.storeProductId &&
          mappingByProductId.get(item.storeProductId)?.packageId,
        relatedSubscriptionId:
          item.userId && this.isUuid(item.userId)
            ? (relatedSubscriptionByUserId.get(item.userId) ?? null)
            : null,
      })),
      unmappedProducts: unmappedProducts.map((item) => ({
        ...item,
        relatedSubscriptionId:
          item.userId && this.isUuid(item.userId)
            ? (relatedSubscriptionByUserId.get(item.userId) ?? null)
            : null,
      })),
      activeWithoutRevenueCatSignals,
    };
  }

  async getSubscriptionMaintenanceJobs(
    query: GetSubscriptionMaintenanceJobsQueryDto,
  ) {
    const limit = query.limit ?? 20;
    const counts = await this.subscriptionMaintenanceQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
    const jobs = await this.subscriptionMaintenanceQueue.getJobs(
      ['active', 'waiting', 'delayed', 'failed', 'completed'],
      0,
      limit - 1,
      false,
    );
    const list = await Promise.all(
      jobs.map((job) => this.serializeMaintenanceJob(job)),
    );

    return {
      counts,
      list,
    };
  }

  async getSubscriptionMaintenanceJob(jobId: string) {
    const job = await this.subscriptionMaintenanceQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`任务 #${jobId} 不存在`);
    }
    return this.serializeMaintenanceJob(job);
  }

  async getSubscriptionMaintenanceDlq(
    query: GetSubscriptionMaintenanceDlqQueryDto,
  ) {
    const result = await this.deadLetterService.queryFailedJobs({
      queueName: QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE,
      status:
        query.status === 'pending' ||
        query.status === 'retried' ||
        query.status === 'discarded'
          ? query.status
          : undefined,
      limit: query.limit ?? 20,
    });

    return {
      list: result.items,
      total: result.total,
    };
  }

  async replaySubscriptionMaintenanceDlq(dlqId: string) {
    return this.deadLetterService.replayJob(dlqId);
  }

  async discardSubscriptionMaintenanceDlq(dlqId: string) {
    await this.deadLetterService.discardJob(dlqId);
    return { id: dlqId, status: 'discarded' };
  }

  private async serializeMaintenanceJob(job: Job) {
    const state = await job.getState();
    const result = job.returnvalue ?? null;
    const failedReason = job.failedReason ?? null;
    return {
      id: String(job.id),
      name: job.name,
      status: state,
      data: job.data,
      result,
      failedReason,
      summary: this.buildMaintenanceJobSummary({
        name: job.name,
        data: job.data as Record<string, unknown>,
        state,
        result,
        failedReason,
      }),
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn ?? null,
      finishedOn: job.finishedOn ?? null,
      timestamp: job.timestamp,
    };
  }

  private buildMaintenanceJobSummary(params: {
    name?: string | null;
    data?: Record<string, unknown>;
    state: string;
    result: unknown;
    failedReason?: string | null;
  }) {
    const action = String(params.data?.action || params.name || 'unknown');
    const subscriptionId = params.data?.subscriptionId
      ? String(params.data.subscriptionId)
      : null;

    if (params.failedReason) {
      return action === 'resync_subscription' && subscriptionId
        ? `重同步失败: ${subscriptionId}，${params.failedReason}`
        : `任务失败: ${params.failedReason}`;
    }

    if (params.state === 'completed') {
      if (
        action === 'rebuild_entitlements' &&
        params.result &&
        typeof params.result === 'object' &&
        'subscriptions' in (params.result as Record<string, unknown>)
      ) {
        return `权益重建完成，处理 ${(params.result as { subscriptions?: number }).subscriptions ?? 0} 个有效订阅`;
      }

      if (action === 'resync_subscription' && subscriptionId) {
        return `订阅重同步完成: ${subscriptionId}`;
      }

      return '任务已完成';
    }

    if (params.state === 'active') {
      return action === 'rebuild_entitlements'
        ? '正在重建有效订阅权益'
        : subscriptionId
          ? `正在重同步订阅: ${subscriptionId}`
          : '任务执行中';
    }

    if (params.state === 'waiting' || params.state === 'delayed') {
      return action === 'rebuild_entitlements'
        ? '等待执行权益重建'
        : subscriptionId
          ? `等待执行订阅重同步: ${subscriptionId}`
          : '任务等待执行';
    }

    return '任务状态未知';
  }

  private isUuid(value?: string | null): boolean {
    return (
      !!value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }
}
