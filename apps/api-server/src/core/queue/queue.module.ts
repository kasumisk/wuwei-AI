/**
 * V6 Phase 1.3 — BullMQ 队列基础设施模块
 *
 * 基于 @nestjs/bullmq + Redis 7 提供异步任务队列能力。
 * 复用现有 Redis 连接配置（REDIS_URL / REDIS_HOST / REDIS_PORT / REDIS_PASSWORD / REDIS_DB）。
 *
 * 注册方式:
 * - QueueModule 在 AppModule 中全局注册，提供 BullMQ 连接和公共队列
 * - 各业务模块通过 BullModule.registerQueue() 注册自己的队列
 * - Processor 在各业务模块内部定义
 *
 * V6.5 Phase 2A: 新增 DeadLetterService（DLQ），存储永久失败的 job
 */
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from './queue.constants';
import { DeadLetterService } from './dead-letter.service';
import { QueueResilienceService } from './queue-resilience.service';

@Global()
@Module({
  imports: [
    // 全局 BullMQ 连接配置 — 复用现有 Redis 实例
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        const host = config.get<string>('REDIS_HOST', 'localhost');
        const port = parseInt(config.get<string>('REDIS_PORT', '6379'), 10);
        const password = config.get<string>('REDIS_PASSWORD') || undefined;
        const db = parseInt(config.get<string>('REDIS_DB', '0'), 10);

        // 如果有 REDIS_URL，解析为 IORedis 连接参数
        if (redisUrl) {
          try {
            const url = new URL(redisUrl);
            return {
              connection: {
                host: url.hostname,
                port: parseInt(url.port, 10) || 6379,
                password: url.password || password,
                db: parseInt(url.pathname?.slice(1) || '0', 10) || db,
                maxRetriesPerRequest: null, // BullMQ 要求此项为 null
              },
            };
          } catch {
            // URL 解析失败，回退到 host/port 配置
          }
        }

        return {
          connection: {
            host,
            port,
            password,
            db,
            maxRetriesPerRequest: null, // BullMQ 要求此项为 null
          },
        };
      },
    }),

    // 注册公共队列 — 各业务模块的 Processor 在各自模块内定义
    // V6.2: 移除僵尸队列 profile-update（事件驱动+Cron 已替代）
    //        移除僵尸队列 feedback-process（同步处理已替代）
    //        保留 export 队列（Phase 3 实现 Processor）
    BullModule.registerQueue(
      { name: QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE },
      { name: QUEUE_NAMES.FOOD_ANALYSIS },
      { name: QUEUE_NAMES.NOTIFICATION },
      { name: QUEUE_NAMES.EXPORT },
      { name: QUEUE_NAMES.RECIPE_GENERATION },
      { name: QUEUE_NAMES.EMBEDDING_GENERATION },
    ),
  ],
  providers: [
    // V6.5 Phase 2A: DLQ 服务
    DeadLetterService,
    // V6.5 Phase 2B: 队列弹性服务（降级）
    QueueResilienceService,
  ],
  exports: [BullModule, DeadLetterService, QueueResilienceService],
})
export class QueueModule {}
