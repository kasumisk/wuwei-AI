/**
 * QueueProducer — 统一任务入队抽象。
 *
 * 设计目的：
 *   业务侧只看到 enqueue(queueName, jobName, payload, opts)；底层根据 env
 *   QUEUE_BACKEND_DEFAULT / QUEUE_BACKEND_<QUEUE_NAME> 决定：
 *     - "bullmq": 走 @InjectQueue 的 Queue.add（默认；测试环境/双轨期）
 *     - "tasks":  走 Cloud Tasks createHttpTask，HTTP target 指向 InternalTaskController
 *
 * 测试环境（dev/staging）默认全部 bullmq，不依赖任何 GCP 资源；
 * 生产环境逐个队列切到 tasks。
 *
 * 失败语义：
 *   - bullmq 路径继承原 QueueResilienceService 的 sync fallback 能力，
 *     Redis 不可用时返回 { mode: 'sync' }，调用方决定是否同步处理。
 *   - tasks 路径不做 sync fallback；Cloud Tasks 失败由调用方按业务决策
 *     （Webhook 直接返回 5xx 触发上游重试；前端触发可降级同步）。
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { ModuleRef } from '@nestjs/core';
import { CloudTasksClient } from './cloud-tasks.client';
import { MetricsService } from '../metrics/metrics.service';
import { QUEUE_NAMES, QueueName } from './queue.constants';

export type QueueBackend = 'bullmq' | 'tasks';

export interface EnqueueOptions extends JobsOptions {
  /**
   * Cloud Tasks 后端使用：建议传 jobId / 业务幂等键，等价 BullMQ 的 jobId。
   * BullMQ 后端：直接映射到 JobsOptions.jobId（保持原行为）。
   */
  jobId?: string;
  /**
   * Cloud Tasks 后端使用：单次 dispatch deadline（秒）。默认 600。
   * 不影响 BullMQ。
   */
  dispatchDeadlineSeconds?: number;
}

export interface EnqueueResult {
  /** 'queued' = 入队成功；'sync' = BullMQ 降级为同步；'tasks' = Cloud Tasks 创建成功 */
  mode: 'queued' | 'sync' | 'tasks';
  /** BullMQ 模式下为 job.id；Tasks 模式下为 task name；sync 时为空 */
  jobId?: string;
}

export interface BulkJob<T = unknown> {
  name: string;
  data: T;
  opts?: EnqueueOptions;
}

@Injectable()
export class QueueProducer {
  private readonly logger = new Logger(QueueProducer.name);
  /** queueName → Queue 实例的懒解析缓存（避免每次 get 都打到 ModuleRef） */
  private readonly queueCache = new Map<string, Queue | null>();

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly moduleRef: ModuleRef,
    /**
     * Cloud Tasks 仅生产环境注入；测试环境若未设 QUEUE_BACKEND=tasks，
     * 即使该类不存在也不会被调用（Optional + 运行时检查）。
     */
    @Optional() @Inject(CloudTasksClient)
    private readonly cloudTasks?: CloudTasksClient,
  ) {}

  /**
   * 单条入队。
   * @param queueName Cloud Tasks queue 名 / BullMQ Queue 名（同名）
   * @param jobName   job 类型名（BullMQ 原生支持；Cloud Tasks 编码进 URL path）
   * @param data      payload，必须 JSON-serializable
   */
  async enqueue<T>(
    queueName: QueueName,
    jobName: string,
    data: T,
    opts: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    const backend = this.resolveBackend(queueName);
    if (backend === 'tasks') return this.enqueueViaCloudTasks(queueName, jobName, data, opts);
    return this.enqueueViaBullMQ(queueName, jobName, data, opts);
  }

  /**
   * 批量入队。Cloud Tasks 没有原生 bulk API，逐条发送（并行）。
   * tasks 后端：用 Promise.allSettled 确保部分失败时已成功项不丢，
   * 失败项以 { mode: 'sync' } 返回（调用方可据此补偿或告警）。
   * bullmq 后端：走 addBulk，整体失败降级为 sync。
   */
  async enqueueBulk<T>(queueName: QueueName, jobs: BulkJob<T>[]): Promise<EnqueueResult[]> {
    const backend = this.resolveBackend(queueName);
    if (backend === 'tasks') {
      const results = await Promise.allSettled(
        jobs.map((j) => this.enqueueViaCloudTasks(queueName, j.name, j.data, j.opts ?? {})),
      );
      return results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        this.logger.warn(
          `enqueueBulk Cloud Tasks partial failure: queue=${queueName} job=${jobs[i].name}: ${(r.reason as Error).message}`,
        );
        return { mode: 'sync' };
      });
    }
    return this.enqueueBulkViaBullMQ(queueName, jobs);
  }

  // ─── BullMQ 路径 ───────────────────────────────────────────────────────

  private async enqueueViaBullMQ<T>(
    queueName: QueueName,
    jobName: string,
    data: T,
    opts: EnqueueOptions,
  ): Promise<EnqueueResult> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      this.logger.warn(
        `QueueProducer: BullMQ queue "${queueName}" not registered; sync fallback`,
      );
      this.metrics.incrementQueueFallback(queueName);
      return { mode: 'sync' };
    }
    try {
      const job = await queue.add(jobName, data as any, this.toBullOpts(opts));
      return { mode: 'queued', jobId: job.id ?? undefined };
    } catch (err) {
      this.logger.warn(
        `BullMQ enqueue failed (queue=${queueName}); sync fallback: ${(err as Error).message}`,
      );
      this.metrics.incrementQueueFallback(queueName);
      return { mode: 'sync' };
    }
  }

  private async enqueueBulkViaBullMQ<T>(
    queueName: QueueName,
    jobs: BulkJob<T>[],
  ): Promise<EnqueueResult[]> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      this.logger.warn(
        `QueueProducer.bulk: BullMQ queue "${queueName}" not registered; sync fallback`,
      );
      this.metrics.incrementQueueFallback(queueName);
      return jobs.map(() => ({ mode: 'sync' }));
    }
    try {
      const added = await queue.addBulk(
        jobs.map((j) => ({
          name: j.name,
          data: j.data as any,
          opts: this.toBullOpts(j.opts ?? {}),
        })),
      );
      return added.map((job) => ({ mode: 'queued', jobId: job.id ?? undefined }));
    } catch (err) {
      this.logger.warn(
        `BullMQ enqueueBulk failed (queue=${queueName}); sync fallback: ${(err as Error).message}`,
      );
      this.metrics.incrementQueueFallback(queueName);
      return jobs.map(() => ({ mode: 'sync' }));
    }
  }

  /** 把我们的 EnqueueOptions 转成 BullMQ JobsOptions（去掉 Cloud Tasks 专属字段） */
  private toBullOpts(opts: EnqueueOptions): JobsOptions {
    const { dispatchDeadlineSeconds: _ignored, ...rest } = opts;
    return rest;
  }

  private getQueue(queueName: string): Queue | null {
    if (this.queueCache.has(queueName)) return this.queueCache.get(queueName) ?? null;
    let queue: Queue | null = null;
    try {
      queue = this.moduleRef.get<Queue>(getQueueToken(queueName), { strict: false });
    } catch {
      queue = null;
    }
    this.queueCache.set(queueName, queue);
    return queue;
  }

  // ─── Cloud Tasks 路径 ─────────────────────────────────────────────────

  private async enqueueViaCloudTasks<T>(
    queueName: QueueName,
    jobName: string,
    data: T,
    opts: EnqueueOptions,
  ): Promise<EnqueueResult> {
    if (!this.cloudTasks) {
      throw new Error(
        `QueueProducer: backend=tasks but CloudTasksClient not provided. ` +
          `Check QueueModule providers and ensure GCP env are set in production.`,
      );
    }

    // BullMQ payload 直接用 data；Cloud Tasks 需要 jobName 才能在 handler 端分发到正确的 processor 方法。
    const body = { jobName, data };
    const internalToken = this.config.get<string>('CLOUD_TASKS_INTERNAL_TOKEN') ?? '';
    const taskName = await this.cloudTasks.createHttpTask({
      queueName,
      payload: body,
      taskId: opts.jobId,
      scheduleDelaySeconds: typeof opts.delay === 'number' ? Math.ceil(opts.delay / 1000) : undefined,
      dispatchDeadlineSeconds: opts.dispatchDeadlineSeconds ?? 600,
      // 路由到 /internal/tasks/{queueName}/{jobName}
      pathOverride: `/${queueName}/${jobName}`,
      // Guard 双重鉴权：OIDC token（由 Cloud Tasks 自动附带） + 共享 secret header
      headers: { 'X-Internal-Token': internalToken },
    });
    return { mode: 'tasks', jobId: taskName || undefined };
  }

  // ─── backend 解析 ─────────────────────────────────────────────────────

  /**
   * 解析 backend：
   *   QUEUE_BACKEND_<UPPER_SNAKE>  > QUEUE_BACKEND_DEFAULT  > 'bullmq'
   * 例：QUEUE_BACKEND_FOOD_ANALYSIS=tasks 单独把 food-analysis 切走，其他保持。
   */
  private resolveBackend(queueName: QueueName): QueueBackend {
    const envKey = `QUEUE_BACKEND_${queueName.toUpperCase().replace(/-/g, '_')}`;
    const perQueue = this.config.get<string>(envKey);
    const fallback = this.config.get<string>('QUEUE_BACKEND_DEFAULT', 'bullmq');
    const value = (perQueue ?? fallback).toLowerCase();
    if (value === 'tasks') return 'tasks';
    return 'bullmq';
  }
}

/** 暴露给单测/工具：列出所有受管队列名 */
export const ALL_QUEUE_NAMES: QueueName[] = Object.values(QUEUE_NAMES);
