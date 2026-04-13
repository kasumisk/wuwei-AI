/**
 * V6 Phase 2.16 — 微信支付控制器
 *
 * 提供三个端点:
 * 1. POST /app/subscription/wechat/create-order — 创建支付订单（需认证）
 * 2. POST /app/subscription/wechat/webhook — 微信支付通知回调（无需认证）
 * 3. GET /app/subscription/wechat/query/:orderNo — 主动查询订单状态（需认证）
 */
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import { WechatPayService } from '../payment/wechat-pay.service';
import {
  ResponseWrapper,
  ApiResponse,
} from '../../../../common/types/response.type';
import { WechatPayNotificationBody } from '../payment/wechat-pay.types';

@ApiTags('订阅 - 微信支付')
@Controller('app/subscription/wechat')
export class WechatPayController {
  private readonly logger = new Logger(WechatPayController.name);

  constructor(private readonly wechatPayService: WechatPayService) {}

  /**
   * 创建微信支付订单
   *
   * 客户端调用此接口获取唤起微信支付所需的参数。
   */
  @Post('create-order')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建微信支付订单' })
  async createOrder(
    @CurrentAppUser() user: AppUserPayload,
    @Body() body: { planId: string },
  ): Promise<ApiResponse> {
    const params = await this.wechatPayService.createOrder(
      user.id,
      body.planId,
    );
    return ResponseWrapper.success(params, '订单创建成功');
  }

  /**
   * 微信支付通知回调
   *
   * 微信支付在交易状态变化时推送通知到此端点。
   * 无需认证（微信通过签名确保数据完整性）。
   *
   * 微信要求:
   * - 返回 200 + { code: 'SUCCESS' } 表示成功
   * - 返回其他状态码时微信会重试
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信支付通知回调（微信调用）' })
  async handleWebhook(
    @Body() body: WechatPayNotificationBody,
    @Headers() headers: Record<string, string>,
  ): Promise<{ code: string; message: string }> {
    try {
      await this.wechatPayService.handleNotification(body, headers);
      return { code: 'SUCCESS', message: '成功' };
    } catch (error) {
      this.logger.error(
        '微信支付通知处理失败',
        error instanceof Error ? error.stack : String(error),
      );
      // 返回 SUCCESS 避免微信频繁重试（已记录错误日志）
      return { code: 'SUCCESS', message: '已接收' };
    }
  }

  /**
   * 主动查询订单状态（用于客户端轮询或掉单恢复）
   */
  @Get('query/:orderNo')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '查询微信支付订单状态' })
  async queryOrder(@Param('orderNo') orderNo: string): Promise<ApiResponse> {
    const result = await this.wechatPayService.queryOrder(orderNo);
    if (!result) {
      return ResponseWrapper.error('订单查询失败', 404);
    }
    return ResponseWrapper.success({
      orderNo: result.out_trade_no,
      transactionId: result.transaction_id,
      tradeState: result.trade_state,
      tradeStateDesc: result.trade_state_desc,
      amount: result.amount,
    });
  }
}
