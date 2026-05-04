/**
 * V6 Phase 1.3 — BullMQ 队列基础设施模块
 *
 * 基于 @nestjs/bullmq + Redis 7 提供异步任务队列能力。
 * 复用现有 Redis 连接配置（QUEUE_REDIS_URL → fallback REDIS_URL / REDIS_HOST...）。
 *
 * 注册方式:
 * - QueueModule 在 AppModule 中全局注册，提供 BullMQ 连接和公共队列
 * - 各业务模块通过 BullModule.registerQueue() 注册自己的队列
 * - Processor 在各业务模块内部定义
 *
 * V6.5 Phase 2A: 新增 DeadLetterService（DLQ），存储永久失败的 job
 */
import { Global, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from './queue.constants';
import { DeadLetterService } from './dead-letter.service';
import { QueueResilienceService } from './queue-resilience.service';
import { QueueProducer } from './queue-producer.service';
import { CloudTasksClient } from './cloud-tasks.client';
import { TaskHandlerRegistry } from './task-handler.registry';
import { InternalTaskController } from './internal-task.controller';
import { InternalTaskGuard } from './internal-task.guard';
import { resolveRedisOptions } from '../redis/redis-options';

/**
 * V7: 新增 QueueProducer + CloudTasksClient。
 * - QueueProducer 是业务侧统一入队入口，根据 QUEUE_BACKEND env 路由到 BullMQ 或 Cloud Tasks。
 * - CloudTasksClient 仅当任意 QUEUE_BACKEND_* === 'tasks' 时才实例化，避免测试环境
 *   构造时检查 GCP env 而崩溃。
 */
const cloudTasksProvider: Provider = {
  provide: CloudTasksClient,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const enabled = isCloudTasksEnabled(config);
    if (!enabled) return null;
    return new CloudTasksClient(config);
  },
};

function isCloudTasksEnabled(config: ConfigService): boolean {
  const def = (config.get<string>('QUEUE_BACKEND_DEFAULT', 'bullmq') ?? 'bullmq').toLowerCase();
  if (def === 'tasks') return true;
  for (const name of Object.values(QUEUE_NAMES)) {
    const k = `QUEUE_BACKEND_${name.toUpperCase().replace(/-/g, '_')}`;
    const v = (config.get<string>(k) ?? '').toLowerCase();
    if (v === 'tasks') return true;
  }
  return false;
}

@Global()
@Module({
  imports: [
    // 全局 BullMQ 连接配置 — 通过 resolveRedisOptions(config, 'QUEUE') 解析
    // 优先级：QUEUE_REDIS_URL → QUEUE_REDIS_HOST → REDIS_URL → REDIS_HOST
    // 生产 QUEUE_BACKEND_DEFAULT=tasks 时 BullMQ 不会被使用；测试/本地仍走此连接
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const opts = resolveRedisOptions(config, 'QUEUE');
        if (!opts) {
          // 没有任何 Redis 配置：BullMQ 仍会尝试连默认 localhost:6379；测试环境通常 OK
          // 生产 tasks 模式下 worker 不会消费，连不上也不影响主流程
          return {
            connection: {
              host: 'localhost',
              port: 6379,
              maxRetriesPerRequest: null,
            },
          };
        }
        return {
          connection: {
            host: opts.host,
            port: opts.port,
            password: opts.password,
            username: opts.username,
            db: opts.db,
            maxRetriesPerRequest: null, // BullMQ 要求此项为 null
            ...(opts.tls ? { tls: {} } : {}),
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
      { name: QUEUE_NAMES.FOOD_ENRICHMENT },
      { name: QUEUE_NAMES.FOOD_USDA_IMPORT },
      { name: QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE },
    ),
  ],
  controllers: [
    // V7: Cloud Tasks HTTP target；测试环境也挂载（Guard 自动放行）便于 curl 调试
    InternalTaskController,
  ],
  providers: [
    // V6.5 Phase 2A: DLQ 服务
    DeadLetterService,
    // V6.5 Phase 2B: 队列弹性服务（降级）
    QueueResilienceService,
    // V7: Cloud Tasks 客户端（仅生产、且任一队列切到 tasks 时才实例化；否则为 null）
    cloudTasksProvider,
    // V7: 统一入队抽象（业务侧只依赖此服务）
    QueueProducer,
    // V7: Task handler 注册中心 + Internal endpoint guard
    TaskHandlerRegistry,
    InternalTaskGuard,
  ],
  exports: [
    BullModule,
    DeadLetterService,
    QueueResilienceService,
    QueueProducer,
    CloudTasksClient,
    TaskHandlerRegistry,
  ],
})
export class QueueModule {}
