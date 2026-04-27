/**
 * V6.1 — App 端订阅计划查询
 *
 * 提供 GET /app/subscription/plans 端点，供前端/小程序获取当前可用的订阅计划列表。
 * 无需管理员权限，需 App 用户认证。
 */
import { Controller, Get, UseGuards, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { SubscriptionService } from '../services/subscription.service';
import { QuotaService } from '../services/quota.service';
import { ApiResponse } from '../../../../common/types/response.type';
import { I18nService } from '../../../../core/i18n/i18n.service';

@ApiTags('订阅 - 计划查询')
@Controller('app/subscription')
export class SubscriptionPlansController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly quotaService: QuotaService,
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

    return {
      success: true,
      code: HttpStatus.OK,
      message: 'OK',
      data: {
        tier: summary.tier,
        quotas,
      },
    };
  }
}
