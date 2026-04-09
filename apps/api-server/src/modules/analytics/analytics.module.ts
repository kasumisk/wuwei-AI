import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// 实体
import { UsageRecord } from '../provider/entities/usage-record.entity';
import { Client } from '../client/entities/client.entity';
// 控制器和服务
import { AnalyticsController } from './admin/analytics.controller';
import { AnalyticsService } from './admin/analytics.service';

@Module({
  imports: [TypeOrmModule.forFeature([UsageRecord, Client])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
