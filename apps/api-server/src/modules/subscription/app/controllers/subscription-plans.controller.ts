/**
 * V6.1 — App 端订阅计划查询
 *
 * 提供 GET /app/subscription/plans 端点，供前端/小程序获取当前可用的订阅计划列表。
 * 无需管理员权限，需 App 用户认证。
 */
import {
  Controller,
  Get,
  Post,
  UseGuards,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { SubscriptionService } from '../services/subscription.service';
import { QuotaService } from '../services/quota.service';
import {
  ApiResponse,
  ResponseWrapper,
} from '../../../../common/types/response.type';
import { I18nService } from '../../../../core/i18n/i18n.service';
import { RevenueCatSyncService } from '../services/revenuecat-sync.service';

@ApiTags('订阅 - 计划查询')
@Controller('app/subscription')
export class SubscriptionPlansController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly quotaService: QuotaService,
    private readonly revenueCatSyncService: RevenueCatSyncService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 获取可用订阅计划列表（仅返回激活状态的计划）
   * GET /api/app/subscription/plans
   */
  @Get('plans')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取可用订阅计划列表' })
  async getActivePlans(): Promise<ApiResponse> {
    const plans = await this.subscriptionService.getActivePlans();

    const list = plans.map((p: any) => this.serializePlanForClient(p));

    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchPlansSuccess'),
      data: { list },
    };
  }

  /**
   * 获取当前用户订阅状态。
   * GET /api/app/subscription/status
   */
  @Get('status')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户订阅状态' })
  async getSubscriptionStatus(@Req() req: any): Promise<ApiResponse> {
    const summary = await this.subscriptionService.getUserSummary(req.user.id);
    return ResponseWrapper.success(
      this.serializeSubscriptionStatus(summary),
      'OK',
    );
  }

  /**
   * 获取当前用户的配额使用状态
   * GET /api/app/subscription/quota-status
   *
   * 返回所有计次功能的已用/上限/剩余/重置时间
   */
  @Get('quota-status')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取用户配额使用状态' })
  async getQuotaStatus(@Req() req: any): Promise<ApiResponse> {
    const user = req.user;
    const [quotas, summary] = await Promise.all([
      this.quotaService.getAllQuotaStatus(user.id),
      this.subscriptionService.getUserSummary(user.id),
    ]);
    const expiresAt = summary.expiresAt ? new Date(summary.expiresAt) : null;
    const serializedExpiresAt =
      expiresAt && !Number.isNaN(expiresAt.getTime())
        ? expiresAt.toISOString()
        : null;

    return {
      success: true,
      code: HttpStatus.OK,
      message: 'OK',
      data: {
        ...this.serializeSubscriptionStatus(summary, serializedExpiresAt),
        quotas,
      },
    };
  }

  /**
   * 客户端主动刷新当前用户订阅状态。
   * 购买成功、App 前台恢复、RevenueCat 本地状态与后端不一致时调用。
   */
  @Post('refresh')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '刷新当前用户订阅状态' })
  async refreshSubscription(@Req() req: any): Promise<ApiResponse> {
    const result = await this.revenueCatSyncService.triggerSyncForUser(
      req.user.id,
      'client_trigger',
    );
    const summary = await this.subscriptionService.getUserSummary(req.user.id);
    return ResponseWrapper.success(
      {
        sync: result,
        status: this.serializeSubscriptionStatus(summary),
      },
      '订阅状态已刷新',
    );
  }

  /**
   * 恢复购买后的服务端同步入口。
   * Flutter 先调用 RevenueCat restorePurchases，再调用本接口收敛后端状态。
   */
  @Post('restore')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '恢复购买后刷新订阅状态' })
  async restoreSubscription(@Req() req: any): Promise<ApiResponse> {
    return this.refreshSubscription(req);
  }

  private serializeSubscriptionStatus(
    summary: Awaited<ReturnType<SubscriptionService['getUserSummary']>>,
    serializedExpiresAt?: string | null,
  ) {
    const expiresAt =
      serializedExpiresAt !== undefined
        ? serializedExpiresAt
        : summary.expiresAt
          ? new Date(summary.expiresAt).toISOString()
          : null;
    const hasAccess = summary.tier !== 'free' && !!summary.subscriptionId;
    return {
      tier: summary.tier,
      status: summary.status,
      accessState: hasAccess ? 'has_access' : 'no_access',
      autoRenew: summary.autoRenew,
      willRenew: summary.autoRenew,
      expiresAt,
      subscriptionId: summary.subscriptionId,
      planName: summary.planName,
      entitlements: summary.entitlements,
      entitlementSource: summary.entitlementSource,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  private serializePlanForClient(plan: any) {
    const storeProducts = Array.isArray(plan.storeProducts)
      ? plan.storeProducts
      : [];

    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      tier: plan.tier,
      billingCycle: plan.billingCycle,
      priceCents: plan.priceCents,
      currency: plan.currency,
      entitlements: plan.entitlements,
      storeProducts,
      purchaseOptions: this.buildPurchaseOptions(plan, storeProducts),
      clientDisplay: this.buildClientDisplay(plan),
      sortOrder: plan.sortOrder,
      isActive: plan.isActive,
    };
  }

  private buildPurchaseOptions(plan: any, storeProducts: any[]) {
    return storeProducts
      .filter((item) => item?.isActive !== false)
      .map((item) => {
        const store = item?.store?.toString() ?? null;
        const platform =
          store === 'app_store'
            ? 'ios'
            : store === 'play_store'
              ? 'android'
              : 'external';

        return {
          provider: item?.provider?.toString() ?? '',
          store,
          platform,
          productId: item?.productId?.toString() ?? '',
          environment: item?.environment?.toString() ?? 'production',
          billingCycle:
            item?.billingCycle?.toString() ?? plan?.billingCycle?.toString(),
          offeringId: item?.offeringId?.toString() ?? null,
          packageId: item?.packageId?.toString() ?? null,
          isActive: item?.isActive !== false,
        };
      })
      .filter((item) => item.provider && item.productId);
  }

  private buildClientDisplay(plan: any) {
    const billingCycle = plan?.billingCycle?.toString() ?? 'monthly';
    const tier = plan?.tier?.toString() ?? 'free';
    const name = plan?.name?.toString() ?? 'Plan';

    const cycleLabel =
      billingCycle === 'monthly'
        ? 'month'
        : billingCycle === 'yearly'
          ? 'year'
          : billingCycle === 'quarterly'
            ? 'quarter'
            : billingCycle === 'lifetime'
              ? 'lifetime'
              : billingCycle;

    const title =
      billingCycle === 'monthly'
        ? `${name} Monthly`
        : billingCycle === 'yearly'
          ? `${name} Yearly`
          : billingCycle === 'quarterly'
            ? `${name} Quarterly`
            : billingCycle === 'lifetime'
              ? `${name} Lifetime`
              : name;

    const badge =
      tier === 'premium'
        ? 'Premium'
        : billingCycle === 'yearly'
          ? 'Best value'
          : null;

    return {
      title,
      subtitle: plan?.description?.toString() || `${name} access billed per ${cycleLabel}.`,
      badge,
      ctaLabel: `Subscribe ${name}`,
      priceSuffix: billingCycle === 'lifetime' ? '' : `/${cycleLabel}`,
    };
  }
}
