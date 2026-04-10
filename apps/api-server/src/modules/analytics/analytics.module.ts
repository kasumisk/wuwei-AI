import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// 实体
import { UsageRecord } from '../provider/entities/usage-record.entity';
import { Client } from '../client/entities/client.entity';
import { AppUser } from '../user/entities/app-user.entity';
import { FoodAnalysisRecord } from '../food/entities/food-analysis-record.entity';
import { SubscriptionTriggerLog } from '../subscription/entities/subscription-trigger-log.entity';
import { PaymentRecord } from '../subscription/entities/payment-record.entity';
import { Subscription } from '../subscription/entities/subscription.entity';
// 控制器和服务
import { AnalyticsController } from './admin/analytics.controller';
import { AnalyticsService } from './admin/analytics.service';
import { ConversionFunnelController } from './admin/conversion-funnel.controller';
import { ConversionFunnelService } from './admin/conversion-funnel.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UsageRecord,
      Client,
      AppUser,
      FoodAnalysisRecord,
      SubscriptionTriggerLog,
      PaymentRecord,
      Subscription,
    ]),
  ],
  controllers: [AnalyticsController, ConversionFunnelController],
  providers: [AnalyticsService, ConversionFunnelService],
  exports: [AnalyticsService, ConversionFunnelService],
})
export class AnalyticsModule {}
