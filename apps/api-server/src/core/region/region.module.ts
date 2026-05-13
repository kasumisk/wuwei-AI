import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { RegionAiModelRoutingService } from './region-ai-model-routing.service';
import { RegionStrategyAdminService } from './region-strategy-admin.service';
import { RegionStrategyService } from './region-strategy.service';

@Global()
@Module({
  imports: [RedisModule],
  providers: [
    RegionStrategyService,
    RegionStrategyAdminService,
    RegionAiModelRoutingService,
  ],
  exports: [
    RegionStrategyService,
    RegionStrategyAdminService,
    RegionAiModelRoutingService,
  ],
})
export class RegionModule {}
