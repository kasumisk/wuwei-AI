import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  DeadLetterService,
  QUEUE_DEFAULT_OPTIONS,
  QUEUE_NAMES,
  TaskHandlerRegistry,
  processorAsHandler,
} from '../core/queue';
import {
  FoodImportMode,
  FoodPipelineOrchestratorService,
} from './services/food-pipeline-orchestrator.service';

export type UsdaImportJobData =
  | {
      mode: 'keyword';
      query: string;
      maxItems?: number;
      importMode?: FoodImportMode;
    }
  | {
      mode: 'preset';
      presetKey: string;
      maxItemsPerQuery?: number;
      importMode?: FoodImportMode;
    }
  | {
      mode: 'category';
      foodCategory: string;
      pageSize?: number;
      maxPages?: number;
      importMode?: FoodImportMode;
    };

@Processor(QUEUE_NAMES.FOOD_USDA_IMPORT, {
  concurrency: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_USDA_IMPORT].concurrency,
})
export class FoodUsdaImportProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(FoodUsdaImportProcessor.name);

  constructor(
    private readonly orchestrator: FoodPipelineOrchestratorService,
    private readonly deadLetterService: DeadLetterService,
    private readonly registry: TaskHandlerRegistry,
  ) {
    super();
  }

  /** V7: 同时把 process() 注册到 Cloud Tasks HTTP dispatcher */
  onModuleInit(): void {
    this.registry.register(
      QUEUE_NAMES.FOOD_USDA_IMPORT,
      '*',
      processorAsHandler(this),
    );
  }

  async process(job: Job<UsdaImportJobData>) {
    this.logger.log(
      `开始 USDA 导入任务: jobId=${job.id}, mode=${job.data.mode}`,
    );

    if (job.data.mode === 'keyword') {
      return this.orchestrator.importFromUsda(
        job.data.query,
        job.data.maxItems ?? 100,
        job.data.importMode ?? 'conservative',
      );
    }

    if (job.data.mode === 'preset') {
      return this.orchestrator.importFromUsdaPreset(
        job.data.presetKey,
        job.data.maxItemsPerQuery ?? 50,
        job.data.importMode ?? 'conservative',
      );
    }

    return this.orchestrator.importFromUsdaCategory({
      foodCategory: job.data.foodCategory,
      pageSize: job.data.pageSize,
      maxPages: job.data.maxPages,
      importMode: job.data.importMode,
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<UsdaImportJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      await this.deadLetterService.storeFailedJob(
        QUEUE_NAMES.FOOD_USDA_IMPORT,
        String(job.id ?? 'unknown'),
        job.data,
        error.message,
        job.attemptsMade,
      );
    }
  }
}
