import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { DecisionModule } from '../decision/decision.module';
// 控制器和服务
import { AnalyticsController } from './admin/analytics.controller';
import { AnalyticsService } from './admin/analytics.service';
import { ConversionFunnelController } from './admin/conversion-funnel.controller';
import { ConversionFunnelService } from './admin/conversion-funnel.service';

@Module({
  imports: [AuthModule, RbacModule, DecisionModule],
  controllers: [AnalyticsController, ConversionFunnelController],
  providers: [AnalyticsService, ConversionFunnelService],
  exports: [AnalyticsService, ConversionFunnelService],
})
export class AnalyticsModule {}
