/**
 * V6.1 — App 端订阅计划查询
 *
 * 提供 GET /app/subscription/plans 端点，供前端/小程序获取当前可用的订阅计划列表。
 * 无需管理员权限，需 App 用户认证。
 */
import { Controller, Get, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { SubscriptionService } from './subscription.service';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('订阅 - 计划查询')
@Controller('app/subscription')
export class SubscriptionPlansController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

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

    // 转换 snake_case → camelCase 供前端消费
    const list = plans.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      tier: p.tier,
      billingCycle: p.billing_cycle ?? p.billingCycle,
      priceCents: p.price_cents ?? p.priceCents,
      currency: p.currency,
      entitlements: p.entitlements,
      appleProductId: p.apple_product_id ?? p.appleProductId,
      wechatProductId: p.wechat_product_id ?? p.wechatProductId,
      sortOrder: p.sort_order ?? p.sortOrder,
      isActive: p.is_active ?? p.isActive,
    }));

    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取订阅计划成功',
      data: { list },
    };
  }
}
