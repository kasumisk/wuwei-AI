import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiResponse,
  ResponseWrapper,
} from '../../../../common/types/response.type';
import { RevenueCatSyncService } from '../services/revenuecat-sync.service';

@ApiTags('订阅 - RevenueCat Webhook')
@Controller('billing/revenuecat')
export class RevenueCatWebhookController {
  constructor(private readonly revenueCatSyncService: RevenueCatSyncService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'RevenueCat Webhook（RevenueCat 调用）' })
  async handleWebhook(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse> {
    this.revenueCatSyncService.assertWebhookAuthorization(authorization);
    const result = await this.revenueCatSyncService.ingestWebhook(body as any);
    return ResponseWrapper.success(result, 'RevenueCat webhook accepted');
  }
}
