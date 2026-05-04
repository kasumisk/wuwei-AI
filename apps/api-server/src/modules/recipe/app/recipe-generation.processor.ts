/**
 * V6.3 P2-7: AI 菜谱批量生成 Processor（BullMQ Worker）
 *
 * 异步处理菜谱生成 job：
 * 1. 消费 recipe-generation 队列中的批次任务
 * 2. 调用 RecipeGenerationService.callLLM() 生成菜谱
 * 3. 调用 RecipeManagementService.createBatch() 批量入库
 * 4. 日志记录成功/失败
 *
 * 重试策略：exponential 退避 5s，最多 2 次重试
 * 并发控制：2 个并发 worker
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
} from '../../../core/queue';
import {
  RecipeGenerationService,
  RecipeGenerationJobData,
} from './recipe-generation.service';
import { RecipeManagementService } from '../admin/recipe-management.service';

@Processor(QUEUE_NAMES.RECIPE_GENERATION, {
  concurrency: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.RECIPE_GENERATION].concurrency,
})
export class RecipeGenerationProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(RecipeGenerationProcessor.name);

  constructor(
    private readonly recipeGenerationService: RecipeGenerationService,
    private readonly recipeManagementService: RecipeManagementService,
    // V6.5 Phase 2A: DLQ 服务
    private readonly deadLetterService: DeadLetterService,
    private readonly registry: TaskHandlerRegistry,
  ) {
    super();
  }

  onModuleInit(): void {
    this.registry.register(
      QUEUE_NAMES.RECIPE_GENERATION,
      '*',
      processorAsHandler(this),
    );
  }

  /**
   * 处理菜谱生成批次任务
   * 由 BullMQ Worker 自动调用
   */
  async process(job: Job<RecipeGenerationJobData>): Promise<void> {
    const { request, requestId, batchIndex, batchSize } = job.data;

    this.logger.log(
      `开始处理菜谱生成任务: requestId=${requestId}, batch=${batchIndex + 1}/${batchSize}, ` +
        `cuisine=${request.cuisine}, count=${request.count}, jobId=${job.id}`,
    );

    try {
      // 1. 调用 LLM 生成菜谱 DTO
      const recipes = await this.recipeGenerationService.callLLM(request);

      if (recipes.length === 0) {
        this.logger.warn(
          `菜谱生成 LLM 返回空结果: requestId=${requestId}, batch=${batchIndex + 1}, jobId=${job.id}`,
        );
        return;
      }

      // 2. 批量入库
      const result = await this.recipeManagementService.createBatch(recipes);

      this.logger.log(
        `菜谱生成任务完成: requestId=${requestId}, batch=${batchIndex + 1}/${batchSize}, ` +
          `created=${result.created}, errors=${result.errors.length}, jobId=${job.id}`,
      );
    } catch (err) {
      const errorMsg = (err as Error).message;
      this.logger.error(
        `菜谱生成任务失败: requestId=${requestId}, batch=${batchIndex + 1}, ` +
          `jobId=${job.id}, error=${errorMsg}`,
      );

      // 重新抛出让 BullMQ 进行重试判断
      throw err;
    }
  }

  /**
   * V6.5 Phase 2A: BullMQ failed 事件钩子
   * 当 job 重试耗尽（最终失败）时，存入 DLQ
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<RecipeGenerationJobData>,
    error: Error,
  ): Promise<void> {
    const maxAttempts =
      job.opts?.attempts ??
      QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.RECIPE_GENERATION].maxRetries + 1;
    if (job.attemptsMade >= maxAttempts) {
      await this.deadLetterService.storeFailedJob(
        QUEUE_NAMES.RECIPE_GENERATION,
        job.id ?? 'unknown',
        job.data,
        error.message,
        job.attemptsMade,
      );
    }
  }
}
