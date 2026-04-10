import { Module } from '@nestjs/common';
// 控制器和服务
import { AnalyticsController } from './admin/analytics.controller';
import { AnalyticsService } from './admin/analytics.service';
import { ConversionFunnelController } from './admin/conversion-funnel.controller';
import { ConversionFunnelService } from './admin/conversion-funnel.service';

@Module({
  controllers: [AnalyticsController, ConversionFunnelController],
  providers: [AnalyticsService, ConversionFunnelService],
  exports: [AnalyticsService, ConversionFunnelService],
})
export class AnalyticsModule {}
