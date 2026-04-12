/**
 * V6.6 Food Enrichment Processor（BullMQ Worker）
 *
 * 消费 food-enrichment 队列任务：
 *  - target=foods:        补全主表字段
 *  - target=translations: 补全翻译关联表
 *  - target=regional:     补全地区信息关联表
 *
 * staged=true 时 AI 结果先写入 change_logs 待人工审核（action=ai_enrichment_staged），
 * staged=false 或 confidence >= 0.7 时直接入库。
 */

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  QUEUE_NAMES,
  QUEUE_DEFAULT_OPTIONS,
  DeadLetterService,
} from '../core/queue';
import {
  FoodEnrichmentService,
  type EnrichmentJobData,
} from './services/food-enrichment.service';

@Processor(QUEUE_NAMES.FOOD_ENRICHMENT, {
  concurrency: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].concurrency,
})
export class FoodEnrichmentProcessor extends WorkerHost {
  private readonly logger = new Logger(FoodEnrichmentProcessor.name);

  constructor(
    private readonly enrichmentService: FoodEnrichmentService,
    private readonly deadLetterService: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<EnrichmentJobData>): Promise<void> {
    const {
      foodId,
      target = 'foods',
      staged = false,
      locale,
      region,
    } = job.data;

    this.logger.log(
      `开始补全任务: foodId=${foodId}, target=${target}, staged=${staged}, jobId=${job.id}`,
    );

    try {
      if (target === 'translations') {
        await this.processTranslation(foodId, locale ?? 'en-US', staged);
      } else if (target === 'regional') {
        await this.processRegional(foodId, region ?? 'CN', staged);
      } else {
        await this.processFoods(foodId, staged);
      }
    } catch (err) {
      this.logger.error(
        `补全任务失败: foodId=${foodId}, target=${target}, jobId=${job.id}, error=${(err as Error).message}`,
      );
      throw err;
    }
  }

  // ─── 主表补全 ──────────────────────────────────────────────────────────

  private async processFoods(foodId: string, staged: boolean): Promise<void> {
    const result = await this.enrichmentService.enrichFood(foodId);
    if (!result) {
      this.logger.warn(`无补全结果（无缺失字段或 AI 失败）: foodId=${foodId}`);
      return;
    }

    const shouldStage = this.enrichmentService.shouldStage(result, staged);

    if (shouldStage) {
      const logId = await this.enrichmentService.stageEnrichment(
        foodId,
        result,
        'foods',
        undefined,
        undefined,
        'ai_enrichment_worker',
      );
      this.logger.log(
        `Staged（foods）foodId=${foodId}, logId=${logId}, confidence=${result.confidence}`,
      );
    } else {
      const { updated, skipped } = await this.enrichmentService.applyEnrichment(
        foodId,
        result,
        'ai_enrichment_worker',
      );
      this.logger.log(
        `直接入库（foods）foodId=${foodId}, updated=[${updated.join(',')}], skipped=[${skipped.join(',')}]`,
      );
    }
  }

  // ─── 翻译补全 ──────────────────────────────────────────────────────────

  private async processTranslation(
    foodId: string,
    locale: string,
    staged: boolean,
  ): Promise<void> {
    const result = await this.enrichmentService.enrichTranslation(
      foodId,
      locale,
    );
    if (!result) {
      this.logger.warn(`无翻译补全结果: foodId=${foodId}, locale=${locale}`);
      return;
    }

    const shouldStage = this.enrichmentService.shouldStage(
      result as any,
      staged,
    );

    if (shouldStage) {
      const logId = await this.enrichmentService.stageEnrichment(
        foodId,
        result as any,
        'translations',
        locale,
        undefined,
        'ai_enrichment_worker',
      );
      this.logger.log(
        `Staged（translations/${locale}）foodId=${foodId}, logId=${logId}`,
      );
    } else {
      const res = await this.enrichmentService.applyTranslationEnrichment(
        foodId,
        locale,
        result,
        'ai_enrichment_worker',
      );
      this.logger.log(
        `直接入库（translations/${locale}）foodId=${foodId}, ${res.action} fields=[${res.fields.join(',')}]`,
      );
    }
  }

  // ─── 地区信息补全 ──────────────────────────────────────────────────────

  private async processRegional(
    foodId: string,
    region: string,
    staged: boolean,
  ): Promise<void> {
    const result = await this.enrichmentService.enrichRegional(foodId, region);
    if (!result) {
      this.logger.warn(
        `无地区信息补全结果: foodId=${foodId}, region=${region}`,
      );
      return;
    }

    const shouldStage = this.enrichmentService.shouldStage(
      result as any,
      staged,
    );

    if (shouldStage) {
      const logId = await this.enrichmentService.stageEnrichment(
        foodId,
        result as any,
        'regional',
        undefined,
        region,
        'ai_enrichment_worker',
      );
      this.logger.log(
        `Staged（regional/${region}）foodId=${foodId}, logId=${logId}`,
      );
    } else {
      const res = await this.enrichmentService.applyRegionalEnrichment(
        foodId,
        region,
        result,
        'ai_enrichment_worker',
      );
      this.logger.log(
        `直接入库（regional/${region}）foodId=${foodId}, ${res.action} fields=[${res.fields.join(',')}]`,
      );
    }
  }

  // ─── DLQ ──────────────────────────────────────────────────────────────

  @OnWorkerEvent('failed')
  async onFailed(job: Job<EnrichmentJobData>, error: Error): Promise<void> {
    const maxAttempts =
      job.opts?.attempts ??
      QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].maxRetries + 1;
    if (job.attemptsMade >= maxAttempts) {
      await this.deadLetterService.storeFailedJob(
        QUEUE_NAMES.FOOD_ENRICHMENT,
        job.id ?? 'unknown',
        job.data,
        error.message,
        job.attemptsMade,
      );
    }
  }
}
