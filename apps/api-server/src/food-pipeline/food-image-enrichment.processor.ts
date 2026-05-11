/**
 * FoodImageEnrichmentProcessor
 *
 * BullMQ Worker：消费 food-image-generation 队列，
 * 调用 FoodImageEnrichmentService 执行图片生成全流程。
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  QUEUE_NAMES,
  QUEUE_DEFAULT_OPTIONS,
  DeadLetterService,
  TaskHandlerRegistry,
  processorAsHandler,
} from '../core/queue';
import {
  FoodImageEnrichmentService,
  ImageEnrichmentJobPayload,
  ImageEnrichmentResult,
} from './services/image-enrichment/food-image-enrichment.service';

@Processor(QUEUE_NAMES.FOOD_IMAGE_GENERATION, {
  concurrency: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_IMAGE_GENERATION].concurrency,
})
export class FoodImageEnrichmentProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(FoodImageEnrichmentProcessor.name);

  constructor(
    private readonly imageEnrichment: FoodImageEnrichmentService,
    private readonly deadLetterService: DeadLetterService,
    private readonly registry: TaskHandlerRegistry,
  ) {
    super();
  }

  onModuleInit(): void {
    this.registry.register(
      QUEUE_NAMES.FOOD_IMAGE_GENERATION,
      '*',
      processorAsHandler(this),
    );
  }

  async process(job: Job<ImageEnrichmentJobPayload>): Promise<ImageEnrichmentResult> {
    const { foodId, foodName } = job.data;
    const maxAttempts =
      job.opts?.attempts ??
      QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_IMAGE_GENERATION].maxRetries + 1;

    this.logger.log(`[job=${job.id}] 开始: foodId=${foodId} name="${foodName}" attempt=${job.attemptsMade + 1}/${maxAttempts}`);

    try {
      const result = await this.imageEnrichment.enrich(job.data);
      if (result.skipped) {
        this.logger.log(`[job=${job.id}] 跳过: foodId=${foodId} reason=${result.skipReason}`);
      } else {
        this.logger.log(`[job=${job.id}] 完成: foodId=${foodId} score=${result.qualityScore}`);
      }
      return result; // BullMQ 存入 job.returnvalue
    } catch (err) {
      this.logger.error(
        `[job=${job.id}] 失败 (attempt ${job.attemptsMade + 1}/${maxAttempts}): ${(err as Error).message}`,
      );
      throw err; // 交还 BullMQ 决定重试
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ImageEnrichmentJobPayload>, error: Error): Promise<void> {
    const maxAttempts =
      job.opts?.attempts ??
      QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_IMAGE_GENERATION].maxRetries + 1;

    if (job.attemptsMade >= maxAttempts) {
      this.logger.error(`[job=${job.id}] 最终失败，写入 DLQ: foodId=${job.data.foodId}`);
      await this.deadLetterService.storeFailedJob(
        QUEUE_NAMES.FOOD_IMAGE_GENERATION,
        job.id ?? 'unknown',
        job.data,
        error.message,
        job.attemptsMade,
      );
    }
  }
}
