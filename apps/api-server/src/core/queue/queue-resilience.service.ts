/**
 * V6.5 Phase 2B — 队列弹性服务
 *
 * 职责：
 * - 提供带降级能力的任务提交方法 safeEnqueue()
 * - 当 Redis 不可用（BullMQ 队列无法连接）时，返回 { mode: 'sync' }
 *   调用方根据返回值决定是否同步处理任务
 * - 通过 Prometheus 指标追踪降级次数
 *
 * 使用方式：
 * 各业务 Service 在向队列提交 job 时，使用 safeEnqueue() 替代直接 queue.add()：
 *
 *   const result = await this.resilience.safeEnqueue(queue, 'jobName', data);
 *   if (result.mode === 'sync') {
 *     // fallback: 同步处理
 *     await this.processDirectly(data);
 *   }
 */
import { Injectable, Logger } from '@nestjs/common';
import { Queue, JobsOptions } from 'bullmq';
import { MetricsService } from '../metrics/metrics.service';

/** safeEnqueue 返回值 */
export interface EnqueueResult {
  /** 'queued' = 成功入队；'sync' = 降级为同步 */
  mode: 'queued' | 'sync';
  /** 仅当 mode='queued' 时有值 */
  jobId?: string;
}

@Injectable()
export class QueueResilienceService {
  private readonly logger = new Logger(QueueResilienceService.name);

  constructor(private readonly metricsService: MetricsService) {}

  /**
   * 带降级的任务提交
   *
   * Redis 不可用时 fallback 到同步处理（返回 mode='sync'，调用方自行处理）
   *
   * @param queue BullMQ Queue 实例
   * @param jobName job 名称
   * @param data 任务数据
   * @param opts BullMQ JobsOptions（可选）
   * @returns EnqueueResult
   */
  async safeEnqueue<T>(
    queue: Queue,
    jobName: string,
    data: T,
    opts?: JobsOptions,
  ): Promise<EnqueueResult> {
    try {
      const job = await queue.add(jobName, data, opts);
      return { mode: 'queued', jobId: job.id ?? undefined };
    } catch (err) {
      this.logger.warn(
        `队列提交失败（${queue.name}），降级为同步处理: ${(err as Error).message}`,
      );
      this.metricsService.incrementQueueFallback(queue.name);
      return { mode: 'sync' };
    }
  }
}
