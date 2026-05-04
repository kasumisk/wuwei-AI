import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  DeadLetterService,
  QUEUE_DEFAULT_OPTIONS,
  QUEUE_NAMES,
  TaskHandlerRegistry,
  processorAsHandler,
} from '../../../core/queue';
import { SubscriptionManagementService } from './subscription-management.service';

type SubscriptionMaintenanceJobData =
  | {
      action: 'rebuild_entitlements';
      requestedBy: 'admin';
      reason?: string;
    }
  | {
      action: 'resync_subscription';
      subscriptionId: string;
      requestedBy: 'admin';
      reason?: string;
    };

@Processor(QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE, {
  concurrency:
    QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE].concurrency,
})
export class SubscriptionMaintenanceProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(SubscriptionMaintenanceProcessor.name);

  constructor(
    private readonly subscriptionManagementService: SubscriptionManagementService,
    private readonly deadLetterService: DeadLetterService,
    private readonly registry: TaskHandlerRegistry,
  ) {
    super();
  }

  onModuleInit(): void {
    this.registry.register(
      QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE,
      '*',
      processorAsHandler(this),
    );
  }

  async process(job: Job<SubscriptionMaintenanceJobData>) {
    this.logger.log(
      `开始处理订阅维护任务: action=${job.data.action}, jobId=${job.id}`,
    );

    if (job.data.action === 'rebuild_entitlements') {
      return this.subscriptionManagementService.performRebuildUserEntitlements();
    }

    return this.subscriptionManagementService.performResyncSubscription(
      job.data.subscriptionId,
      { reason: job.data.reason },
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<SubscriptionMaintenanceJobData>,
    error: Error,
  ): Promise<void> {
    const maxAttempts =
      job.opts?.attempts ??
      QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE].maxRetries +
        1;

    if (job.attemptsMade >= maxAttempts) {
      await this.deadLetterService.storeFailedJob(
        QUEUE_NAMES.SUBSCRIPTION_MAINTENANCE,
        String(job.id ?? 'unknown'),
        job.data,
        error.message,
        job.attemptsMade,
      );
    }
  }
}
