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

    const list = plans.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      tier: p.tier,
      billingCycle: p.billingCycle,
      priceCents: p.priceCents,
        currency: p.currency,
        entitlements: p.entitlements,
        appleProductId: p.appleProductId,
        googleProductId: p.googleProductId,
        wechatProductId: p.wechatProductId,
        sortOrder: p.sortOrder,
        isActive: p.isActive,
    }));

    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchPlansSuccess'),
      data: { list },
    };
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
        tier: summary.tier,
        status:
          summary.subscriptionId == null
            ? 'free'
            : summary.autoRenew
              ? 'active'
              : 'cancelled',
        accessState:
          summary.tier === 'free' && !summary.subscriptionId
            ? 'no_access'
            : 'has_access',
        autoRenew: summary.autoRenew,
        willRenew: summary.autoRenew,
        expiresAt: serializedExpiresAt,
        subscriptionId: summary.subscriptionId,
        planName: summary.planName,
        lastSyncedAt: new Date().toISOString(),
        quotas,
      },
    };
  }

  /**
   * 触发当前用户的订阅同步。
   *
   * 当前提供最小骨架：
   * - 为客户端购买成功 / restore 成功后提供统一入口
   * - 后续接入 RevenueCat subscriber API 和异步 job 队列
   */
  @Post('sync-trigger')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '触发当前用户订阅同步' })
  async triggerSubscriptionSync(@Req() req: any): Promise<ApiResponse> {
    const result = await this.revenueCatSyncService.triggerSyncForUser(
      req.user.id,
      'client_trigger',
    );
    return ResponseWrapper.success(result, '订阅同步已触发');
  }
}
