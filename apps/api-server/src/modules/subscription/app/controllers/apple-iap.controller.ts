/**
 * V6 Phase 2.15 — Apple IAP 控制器
 *
 * 提供两个端点:
 * 1. POST /app/subscription/apple/verify — 客户端购买验证（需认证）
 * 2. POST /app/subscription/apple/webhook — Apple S2S 通知接收（无需认证）
 */
import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import { AppleIapService } from '../payment/apple-iap.service';
import {
  ResponseWrapper,
  ApiResponse,
} from '../../../../common/types/response.type';

@ApiTags('订阅 - Apple IAP')
@Controller('app/subscription/apple')
export class AppleIapController {
  private readonly logger = new Logger(AppleIapController.name);

  constructor(private readonly appleIapService: AppleIapService) {}

  /**
   * 客户端 IAP 购买验证
   *
   * iOS 客户端完成 StoreKit 2 购买后，调用此接口验证交易并激活订阅。
   */
  @Post('verify')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '验证 Apple IAP 购买' })
  async verifyPurchase(
    @CurrentAppUser() user: AppUserPayload,
    @Body() body: { transactionId: string; productId: string },
  ): Promise<ApiResponse> {
    const result = await this.appleIapService.verifyAndProcessPurchase(
      user.id,
      body.transactionId,
      body.productId,
    );

    if (!result.valid) {
      return ResponseWrapper.error(result.error ?? '购买验证失败', 400);
    }

    return ResponseWrapper.success(
      {
        transactionId: result.transaction?.transactionId,
        productId: result.transaction?.productId,
        expiresDate: result.transaction?.expiresDate
          ? new Date(result.transaction.expiresDate).toISOString()
          : null,
      },
      '购买验证成功，订阅已激活',
    );
  }

  /**
   * Apple Server-to-Server 通知 V2 Webhook
   *
   * Apple 推送订阅状态变化通知到此端点。
   * 无需认证（Apple 使用 JWS 签名确保数据完整性）。
   *
   * Apple 要求:
   * - 返回 200 表示成功接收
   * - 非 200 时 Apple 会重试
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apple S2S 通知 Webhook（Apple 调用）' })
  async handleWebhook(
    @Body() body: { signedPayload: string },
  ): Promise<{ status: string }> {
    try {
      await this.appleIapService.handleNotification(body.signedPayload);
      return { status: 'ok' };
    } catch (error) {
      this.logger.error(
        'Apple Webhook 处理失败',
        error instanceof Error ? error.stack : String(error),
      );
      // 仍返回 200 避免 Apple 频繁重试（已记录错误日志）
      return { status: 'error_logged' };
    }
  }
}
