import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { QUEUE_NAMES } from '../core/queue/queue.constants';

/**
 * V6.6 Phase 1-D: 注册关键队列供健康检查使用
 * 仅注册用于检查 Worker 活性，不创建新 Processor
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE },
      { name: QUEUE_NAMES.FOOD_ANALYSIS },
      { name: QUEUE_NAMES.NOTIFICATION },
    ),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
