/**
 * V6.5 Phase 2A — Dead Letter Queue 服务
 *
 * 职责：
 * - 将 BullMQ 永久失败的 job（重试耗尽）存入 dead_letter_jobs 表
 * - 提供查询接口供 Admin 查看失败原因
 * - 支持重放 DLQ 中的 job（重新入队）
 * - 支持标记 job 为已丢弃（discarded）
 *
 * 使用方式：
 * 各 Processor 在 job 最终失败时调用 storeFailedJob()，
 * 或通过全局 QueueEvents 监听 'failed' 事件自动触发。
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { QUEUE_NAMES, QueueName } from './queue.constants';

/** DLQ 条目状态 */
export type DlqStatus = 'pending' | 'retried' | 'discarded';

/** DLQ 查询过滤条件 */
export interface DlqQueryFilter {
  queueName?: string;
  status?: DlqStatus;
  limit?: number;
  offset?: number;
}

/** DLQ 条目（返回给 Admin） */
export interface DlqEntry {
  id: string;
  queueName: string;
  jobId: string;
  jobData: any;
  errorMessage: string;
  attemptsMade: number;
  status: string;
  failedAt: Date;
  retriedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  /** 队列名 → Queue 实例映射（用于重放） */
  private readonly queueMap = new Map<string, Queue>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
    @InjectQueue(QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE)
    private readonly precomputeQueue: Queue,
    @InjectQueue(QUEUE_NAMES.FOOD_ANALYSIS)
    private readonly foodAnalysisQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION)
    private readonly notificationQueue: Queue,
    @InjectQueue(QUEUE_NAMES.EXPORT)
    private readonly exportQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RECIPE_GENERATION)
    private readonly recipeGenerationQueue: Queue,
  ) {
    // 注册所有队列实例
    this.queueMap.set(
      QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE,
      this.precomputeQueue,
    );
    this.queueMap.set(QUEUE_NAMES.FOOD_ANALYSIS, this.foodAnalysisQueue);
    this.queueMap.set(QUEUE_NAMES.NOTIFICATION, this.notificationQueue);
    this.queueMap.set(QUEUE_NAMES.EXPORT, this.exportQueue);
    this.queueMap.set(
      QUEUE_NAMES.RECIPE_GENERATION,
      this.recipeGenerationQueue,
    );
  }

  /**
   * 将永久失败的 job 存入 DLQ
   *
   * @param queueName 队列名称
   * @param jobId BullMQ job ID
   * @param jobData 原始任务数据
   * @param error 最终错误信息
   * @param attemptsMade 已尝试次数
   */
  async storeFailedJob(
    queueName: string,
    jobId: string,
    jobData: any,
    error: string,
    attemptsMade: number,
  ): Promise<void> {
    try {
      await this.prisma.dead_letter_jobs.create({
        data: {
          queue_name: queueName,
          job_id: jobId,
          job_data: jobData ?? {},
          error_message: error,
          attempts_made: attemptsMade,
          status: 'pending',
          failed_at: new Date(),
        },
      });

      this.metricsService.queueJobsFailed.inc({ queue: queueName });
      this.logger.warn(
        `Job 进入 DLQ: queue=${queueName}, jobId=${jobId}, attempts=${attemptsMade}, error=${error.slice(0, 200)}`,
      );
    } catch (err) {
      // DLQ 存储本身不能再抛异常，只记录日志
      this.logger.error(
        `DLQ 存储失败: queue=${queueName}, jobId=${jobId}, error=${(err as Error).message}`,
      );
    }
  }

  /**
   * 查询 DLQ 条目（Admin 接口用）
   */
  async queryFailedJobs(filter: DlqQueryFilter = {}): Promise<{
    items: DlqEntry[];
    total: number;
  }> {
    const where: any = {};
    if (filter.queueName) where.queue_name = filter.queueName;
    if (filter.status) where.status = filter.status;

    const limit = Math.min(filter.limit ?? 20, 100);
    const offset = filter.offset ?? 0;

    const [items, total] = await Promise.all([
      this.prisma.dead_letter_jobs.findMany({
        where,
        orderBy: { failed_at: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.dead_letter_jobs.count({ where }),
    ]);

    return {
      items: items.map((row) => ({
        id: row.id,
        queueName: row.queue_name,
        jobId: row.job_id,
        jobData: row.job_data,
        errorMessage: row.error_message,
        attemptsMade: row.attempts_made,
        status: row.status,
        failedAt: row.failed_at,
        retriedAt: row.retried_at,
        createdAt: row.created_at,
      })),
      total,
    };
  }

  /**
   * 重放 DLQ 中的 job（重新入队）
   *
   * @param dlqId DLQ 条目 ID
   * @throws 如果条目不存在、已处理或队列不存在
   */
  async replayJob(dlqId: string): Promise<{ mode: 'queued'; jobId?: string }> {
    const dlqJob = await this.prisma.dead_letter_jobs.findUnique({
      where: { id: dlqId },
    });

    if (!dlqJob) {
      throw new Error(`DLQ 条目不存在: ${dlqId}`);
    }
    if (dlqJob.status !== 'pending') {
      throw new Error(`DLQ 条目已处理: ${dlqId}, status=${dlqJob.status}`);
    }

    const queue = this.queueMap.get(dlqJob.queue_name);
    if (!queue) {
      throw new Error(`未知队列: ${dlqJob.queue_name}`);
    }

    const job = await queue.add('dlq-replay', dlqJob.job_data as any);

    await this.prisma.dead_letter_jobs.update({
      where: { id: dlqId },
      data: { status: 'retried', retried_at: new Date() },
    });

    this.logger.log(
      `DLQ 重放成功: dlqId=${dlqId}, queue=${dlqJob.queue_name}, newJobId=${job.id}`,
    );

    return { mode: 'queued', jobId: job.id ?? undefined };
  }

  /**
   * 标记 DLQ 条目为已丢弃（不再重试）
   */
  async discardJob(dlqId: string): Promise<void> {
    await this.prisma.dead_letter_jobs.update({
      where: { id: dlqId },
      data: { status: 'discarded' },
    });

    this.logger.log(`DLQ 条目已丢弃: ${dlqId}`);
  }

  /**
   * 获取 DLQ 统计摘要（按队列分组）
   */
  async getSummary(): Promise<
    { queueName: string; pendingCount: number; totalCount: number }[]
  > {
    const results = await this.prisma.$queryRaw<
      { queue_name: string; status: string; count: bigint }[]
    >`
      SELECT queue_name, status, COUNT(*) as count
      FROM dead_letter_jobs
      GROUP BY queue_name, status
      ORDER BY queue_name
    `;

    // 按队列聚合
    const map = new Map<string, { pending: number; total: number }>();
    for (const row of results) {
      const entry = map.get(row.queue_name) ?? { pending: 0, total: 0 };
      const count = Number(row.count);
      entry.total += count;
      if (row.status === 'pending') entry.pending += count;
      map.set(row.queue_name, entry);
    }

    return Array.from(map.entries()).map(([queueName, stats]) => ({
      queueName,
      pendingCount: stats.pending,
      totalCount: stats.total,
    }));
  }
}
