/**
 * V8.2 Food Enrichment Processor（BullMQ Worker）
 *
 * 消费 food-enrichment 队列任务：
 *  - target=foods:        补全主表字段（5阶段分阶段模式）
 *  - target=translations: 补全翻译关联表
 *  - target=regional:     补全地区信息关联表
 *
 * V7.9 新增：
 *  - stages 参数：指定 1-5 阶段编号，走分阶段补全流程（enrichFoodByStage）
 *  - 分阶段结果各阶段独立入库/staging，前阶段结果作为后阶段上下文
 *
 * V8.2 变更：
 *  - 无 stages 参数时默认走全部5阶段补全（不再使用旧版整体补全）
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
      stages,
    } = job.data;

    this.logger.log(
      `开始补全任务: foodId=${foodId}, target=${target}, staged=${staged}` +
        `${stages ? `, stages=[${stages.join(',')}]` : ''}` +
        `, jobId=${job.id}`,
    );

    try {
      if (target === 'translations') {
        await this.processTranslation(foodId, locale ?? 'en-US', staged);
      } else if (target === 'regional') {
        await this.processRegional(foodId, region ?? 'CN', staged);
      } else if (stages && stages.length > 0) {
        // V7.9: 分阶段补全模式
        await this.processFoodsByStage(foodId, stages, staged);
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

  // ─── V7.9: 分阶段补全（核心新增）──────────────────────────────────────

  private async processFoodsByStage(
    foodId: string,
    stages: number[],
    staged: boolean,
  ): Promise<void> {
    const multiResult = await this.enrichmentService.enrichFoodByStage(
      foodId,
      stages,
    );
    if (!multiResult) {
      this.logger.warn(
        `分阶段补全无结果（无缺失字段或全部失败）: foodId=${foodId}`,
      );
      return;
    }

    // 逐阶段入库
    for (const stageResult of multiResult.stages) {
      if (!stageResult.result || stageResult.enrichedFields.length === 0) {
        continue;
      }

      const shouldStage = this.enrichmentService.shouldStage(
        stageResult.result,
        staged,
      );

      if (shouldStage) {
        const logId = await this.enrichmentService.stageEnrichment(
          foodId,
          stageResult.result,
          'foods',
          undefined,
          undefined,
          `ai_enrichment_worker_stage${stageResult.stage}`,
        );
        this.logger.log(
          `Staged（阶段${stageResult.stage}/${stageResult.stageName}）` +
            `foodId=${foodId}, logId=${logId}, ` +
            `confidence=${stageResult.result.confidence}, ` +
            `fallback=${stageResult.usedFallback}`,
        );
      } else {
        const { updated, skipped } =
          await this.enrichmentService.applyEnrichment(
            foodId,
            stageResult.result,
            `ai_enrichment_worker_stage${stageResult.stage}`,
          );
        this.logger.log(
          `直接入库（阶段${stageResult.stage}/${stageResult.stageName}）` +
            `foodId=${foodId}, updated=[${updated.join(',')}], ` +
            `skipped=[${skipped.join(',')}], ` +
            `fallback=${stageResult.usedFallback}`,
        );
      }
    }

    this.logger.log(
      `分阶段补全完成: foodId=${foodId}, ` +
        `总补全=${multiResult.totalEnriched}, ` +
        `总失败=${multiResult.totalFailed}, ` +
        `综合置信度=${multiResult.overallConfidence}`,
    );
  }

  // ─── 主表补全（无 stages 参数时默认走全部5阶段）─────────────────────

  private async processFoods(foodId: string, staged: boolean): Promise<void> {
    // V8.2: 旧版 enrichFood() 已移除，统一走分阶段补全流程
    await this.processFoodsByStage(foodId, [1, 2, 3, 4, 5], staged);
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

      // V8.3: 最终失败时更新 foods.enrichment_status 为 'failed'
      try {
        await this.enrichmentService.markEnrichmentFailed(
          job.data.foodId,
          error.message,
        );
      } catch (e) {
        this.logger.error(
          `标记食物补全失败状态异常: foodId=${job.data.foodId}, ${(e as Error).message}`,
        );
      }
    }
  }
}
