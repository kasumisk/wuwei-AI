import { Module } from '@nestjs/common';
import { RegionStrategyAdminController } from './admin/region-strategy-admin.controller';
import { AppCapabilitiesController } from './app/app-capabilities.controller';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [AuthModule, SubscriptionModule],
  controllers: [AppCapabilitiesController, RegionStrategyAdminController],
})
export class CapabilitiesModule {}
