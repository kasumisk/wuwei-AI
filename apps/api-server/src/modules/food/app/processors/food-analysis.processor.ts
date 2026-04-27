/**
 * V6 Phase 1.4 — AI 图片分析队列处理器
 *
 * 将原本在请求线程中同步阻塞的 AI 分析（30s timeout）迁移到 BullMQ Worker 异步执行。
 *
 * 工作流程：
 * 1. 控制器收到上传请求 → 生成 requestId → 向 food-analysis 队列 enqueue job
 * 2. 本 Processor 消费 job → 调用 AnalyzeService.processAnalysis() 执行实际 AI 调用
 * 3. 结果写入 Redis 缓存（key: food_analysis:{requestId}）
 * 4. 客户端通过 GET /api/app/food/analyze/:requestId 轮询获取结果
 *
 * 重试策略：指数退避，最多 2 次重试（见 queue.constants.ts）
 * 并发控制：3 个并发 worker（避免 AI API 并发过高）
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  QUEUE_NAMES,
  QUEUE_DEFAULT_OPTIONS,
  DeadLetterService,
} from '../../../../core/queue';
import { AnalyzeService } from '../services/analyze.service';
import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import {
  DomainEvents,
  AnalysisFailedEvent,
} from '../../../../core/events/domain-events';

/** 队列任务数据结构 */
export interface FoodAnalysisJobData {
  requestId: string;
  imageUrl: string;
  mealType?: string;
  userId?: string;
  locale?: Locale;
}

@Processor(QUEUE_NAMES.FOOD_ANALYSIS, {
  concurrency: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ANALYSIS].concurrency,
})
export class FoodAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(FoodAnalysisProcessor.name);

  constructor(
    private readonly analyzeService: AnalyzeService,
    // V6.1 Phase 2.6: 域事件发射（分析失败）
    private readonly eventEmitter: EventEmitter2,
    // V6.5 Phase 2A: DLQ 服务
    private readonly deadLetterService: DeadLetterService,
  ) {
    super();
  }

  /**
   * 处理 AI 图片分析任务
   * 由 BullMQ Worker 自动调用
   */
  async process(job: Job<FoodAnalysisJobData>): Promise<void> {
    const { requestId, imageUrl, mealType, userId, locale } = job.data;
    this.logger.log(
      `开始处理 AI 分析任务: requestId=${requestId}, jobId=${job.id}`,
    );

    try {
      // 调用实际的 AI 分析逻辑（原 analyzeImage 的核心部分）
      await this.analyzeService.processAnalysis(
        requestId,
        imageUrl,
        mealType,
        userId,
        locale,
      );

      this.logger.log(
        `AI 分析任务完成: requestId=${requestId}, jobId=${job.id}`,
      );
    } catch (err) {
      this.logger.error(
        `AI 分析任务失败: requestId=${requestId}, jobId=${job.id}, error=${(err as Error).message}`,
      );
      // 将错误状态写入缓存，让客户端轮询时知道失败了
      await this.analyzeService.cacheAnalysisError(
        requestId,
        (err as Error).message,
      );

      // V6.1 Phase 2.6: 发射分析失败事件
      if (userId) {
        this.eventEmitter.emit(
          DomainEvents.ANALYSIS_FAILED,
          new AnalysisFailedEvent(
            userId,
            requestId,
            'image',
            (err as Error).message,
          ),
        );
      }

      // 重新抛出让 BullMQ 进行重试判断
      throw err;
    }
  }

  /**
   * V6.5 Phase 2A: BullMQ failed 事件钩子
   * 当 job 重试耗尽（最终失败）时，存入 DLQ
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<FoodAnalysisJobData>, error: Error): Promise<void> {
    const maxAttempts =
      job.opts?.attempts ??
      QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ANALYSIS].maxRetries + 1;
    if (job.attemptsMade >= maxAttempts) {
      await this.deadLetterService.storeFailedJob(
        QUEUE_NAMES.FOOD_ANALYSIS,
        job.id ?? 'unknown',
        job.data,
        error.message,
        job.attemptsMade,
      );
    }
  }
}
