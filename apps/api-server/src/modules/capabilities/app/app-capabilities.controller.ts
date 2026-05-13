import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../core/decorators/public.decorator';
import {
  ResponseWrapper,
  type ApiResponse,
} from '../../../common/types/response.type';
import { RegionStrategyService } from '../../../core/region';
import { GetAppCapabilitiesQueryDto } from './dto/app-capabilities.dto';
import type { RegionCapabilityProfile } from '../../../core/region';
import { AppAuthProviderRegistry } from '../../auth/app/providers/app-auth-provider.registry';
import { BillingProviderRegistry } from '../../subscription/app/providers/billing-provider.registry';

@ApiTags('App 能力配置')
@Controller('app/capabilities')
export class AppCapabilitiesController {
  constructor(
    private readonly regionStrategy: RegionStrategyService,
    private readonly authProviderRegistry: AppAuthProviderRegistry,
    private readonly billingProviderRegistry: BillingProviderRegistry,
  ) {}

  /**
   * GET /api/app/capabilities
   */
  @Public()
  @Get()
  @ApiOperation({ summary: '获取当前区域可用登录、支付、AI 与合规能力' })
  getCapabilities(
    @Query() query: GetAppCapabilitiesQueryDto,
  ): ApiResponse<RegionCapabilityProfile> {
    const profile = this.regionStrategy.resolveCapabilities(query);

    return ResponseWrapper.success(
      {
        ...profile,
        authMethods: this.regionStrategy.hasCapabilityOverride(
          profile.region,
          'authMethods',
        )
          ? profile.authMethods
          : this.authProviderRegistry.getMethodsForRegion(profile.region),
        billingMethods: this.regionStrategy.hasCapabilityOverride(
          profile.region,
          'billingMethods',
        )
          ? profile.billingMethods
          : this.billingProviderRegistry.getMethodsForRegion(profile.region),
      },
      '获取能力配置成功',
    );
  }
}
