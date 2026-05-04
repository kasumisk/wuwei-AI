/**
 * V6 Phase 1.3 — 队列模块导出
 * V6.5 Phase 2A: 新增 DeadLetterService 导出
 * V6.5 Phase 2B: 新增 QueueResilienceService 导出
 * V7: 新增 QueueProducer + CloudTasksClient 导出
 */
export * from './queue.constants';
export * from './queue.module';
export * from './dead-letter.service';
// QueueResilienceService 与 QueueProducer 都导出 EnqueueResult 类型；
// 显式重命名避免歧义，QueueResilience 的版本被旧业务引用时仍可访问。
export {
  QueueResilienceService,
  type EnqueueResult as ResilienceEnqueueResult,
} from './queue-resilience.service';
export * from './queue-producer.service';
export * from './cloud-tasks.client';
export * from './task-handler.registry';
export * from './internal-task.controller';
export * from './internal-task.guard';
