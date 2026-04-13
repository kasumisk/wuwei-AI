/**
 * V6.2 Phase 3.10 — ExportProcessor（BullMQ Worker）
 *
 * 异步处理数据导出 job：
 * 1. 消费 export 队列中的任务
 * 2. 调用 ExportService 生成导出数据（CSV）
 * 3. 将结果缓存到 TieredCacheManager 供客户端轮询
 * 4. 发送导出完成通知（可选）
 *
 * 重试策略：fixed 退避，最多 1 次重试（见 queue.constants.ts）
 * 并发控制：2 个并发 worker（导出是低频高消耗操作）
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  QUEUE_NAMES,
  QUEUE_DEFAULT_OPTIONS,
  DeadLetterService,
} from '../../../../core/queue';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../core/cache/tiered-cache-manager';
import {
  ExportService,
  ExportJobData,
  ExportResult,
} from '../services/export.service';

/** 导出任务缓存状态 */
export interface ExportCacheEntry {
  status: 'processing' | 'completed' | 'failed';
  result?: ExportResult;
  error?: string;
  updatedAt: string;
}

@Processor(QUEUE_NAMES.EXPORT, {
  concurrency: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.EXPORT].concurrency,
})
export class ExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportProcessor.name);
  private readonly cache: TieredCacheNamespace<ExportCacheEntry>;

  /** 导出结果缓存 L2 TTL: 1 小时（用户有足够时间下载） */
  private static readonly RESULT_L2_TTL_MS = 60 * 60 * 1000;

  constructor(
    private readonly exportService: ExportService,
    private readonly cacheManager: TieredCacheManager,
    // V6.5 Phase 2A: DLQ 服务
    private readonly deadLetterService: DeadLetterService,
  ) {
    super();
    this.cache = this.cacheManager.createNamespace<ExportCacheEntry>({
      namespace: 'export_result',
      l1MaxEntries: 50,
      l1TtlMs: 10 * 60 * 1000, // 10 min L1
      l2TtlMs: ExportProcessor.RESULT_L2_TTL_MS,
    });
  }

  /**
   * 处理导出任务
   * 由 BullMQ Worker 自动调用
   */
  async process(job: Job<ExportJobData>): Promise<void> {
    const { exportId, userId, format } = job.data;
    this.logger.log(
      `开始处理导出任务: exportId=${exportId}, userId=${userId}, format=${format}, jobId=${job.id}`,
    );

    // 标记为处理中
    await this.cache.set(exportId, {
      status: 'processing',
      updatedAt: new Date().toISOString(),
    });

    try {
      // 调用 ExportService 生成导出数据
      const result = await this.exportService.generateExport(job.data);

      // 缓存导出结果
      await this.cache.set(exportId, {
        status: 'completed',
        result,
        updatedAt: new Date().toISOString(),
      });

      this.logger.log(
        `导出任务完成: exportId=${exportId}, records=${result.recordCount}, jobId=${job.id}`,
      );
    } catch (err) {
      const errorMsg = (err as Error).message;
      this.logger.error(
        `导出任务失败: exportId=${exportId}, jobId=${job.id}, error=${errorMsg}`,
      );

      // 缓存错误状态
      await this.cache.set(exportId, {
        status: 'failed',
        error: errorMsg,
        updatedAt: new Date().toISOString(),
      });

      // 重新抛出让 BullMQ 进行重试判断
      throw err;
    }
  }

  /**
   * V6.5 Phase 2A: BullMQ failed 事件钩子
   * 当 job 重试耗尽（最终失败）时，存入 DLQ
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ExportJobData>, error: Error): Promise<void> {
    const maxAttempts =
      job.opts?.attempts ??
      QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.EXPORT].maxRetries + 1;
    if (job.attemptsMade >= maxAttempts) {
      await this.deadLetterService.storeFailedJob(
        QUEUE_NAMES.EXPORT,
        job.id ?? 'unknown',
        job.data,
        error.message,
        job.attemptsMade,
      );
    }
  }
}
