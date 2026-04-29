/**
 * V8.7 Food Enrichment Processor（BullMQ Worker）
 *
 * 消费 food-enrichment 队列任务：
 *  - target=foods:        补全主表字段（5阶段分阶段模式）
 *  - target=translations: 补全翻译关联表
 *  - target=regional:     补全地区信息关联表
 *
 * V7.9 新增：
 *  - stages 参数：指定 1-5 阶段编号，走分阶段补全流程（enrichFoodByStage）
 *
 * V8.2 变更：
 *  - 无 stages 参数时默认走全部5阶段补全（不再使用旧版整体补全）
 *
 * V8.7 变更（FIX）：
 *  - processFoodsByStage 改为将所有阶段结果合并后一次性写入（一条 change_log），
 *    彻底解决"每阶段写一条导致单食物多条历史记录"问题。
 *    与 enrichFoodNow / batchEnrichByStage 逻辑保持一致。
 *  - 补全完成后显式更新 enrichment_status（依据最终 data_completeness）。
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
      locales,
      region,
      stages,
      fields,
      mode,
    } = job.data;

    this.logger.log(
      `开始补全任务: foodId=${foodId}, target=${target}, staged=${staged}` +
        `${stages ? `, stages=[${stages.join(',')}]` : ''}` +
        `${mode ? `, mode=${mode}` : ''}` +
        `, jobId=${job.id}`,
    );

    try {
      if (target === 'translations') {
        await this.processTranslation(foodId, locales ?? ['en-US'], staged);
      } else if (target === 'regional') {
        await this.processRegional(foodId, region ?? 'CN', staged);
      } else if (mode === 'direct_fields') {
        // V2.1: direct_fields 模式 — 跳过阶段路由，直接对指定 fields 发起一次性补全
        await this.processDirectFields(foodId, fields, staged);
      } else if (stages && stages.length > 0) {
        // V7.9: 分阶段补全模式，透传 fields 作为 fieldFilter
        await this.processFoodsByStage(foodId, stages, staged, fields);
      } else {
        await this.processFoods(foodId, staged, fields);
      }
    } catch (err) {
      this.logger.error(
        `补全任务失败: foodId=${foodId}, target=${target}, jobId=${job.id}, error=${(err as Error).message}`,
      );
      throw err;
    }
  }

  // ─── V2.1: 直接字段补全（跳过阶段路由）──────────────────────────────

  /**
   * V2.1: 直接对指定 fields 发起一次性 AI 补全，不走 5 阶段流程。
   * 用于 re-enqueue 场景（字段已明确指定）。
   */
  private async processDirectFields(
    foodId: string,
    fields: EnrichmentJobData['fields'],
    staged: boolean,
  ): Promise<void> {
    if (!fields || fields.length === 0) {
      this.logger.warn(
        `processDirectFields: fields 为空，跳过 foodId=${foodId}`,
      );
      return;
    }

    const result = await this.enrichmentService.enrichFieldsDirect(
      foodId,
      fields,
      staged,
      'ai_enrichment_worker',
    );

    if (!result) {
      this.logger.warn(
        `processDirectFields: 补全无结果 foodId=${foodId}, fields=[${fields.join(',')}]`,
      );
      return;
    }

    this.logger.log(
      `processDirectFields 完成: foodId=${foodId}, updated=[${result.updated.join(',')}], skipped=[${result.skipped.join(',')}]`,
    );
  }

  // ─── V7.9/V8.7: 分阶段补全（V8.7: 合并后单次写入）──────────────────────

  /**
   * V8.7 FIX: 将所有阶段结果合并后一次性调用 applyEnrichment 或 stageEnrichment，
   * 每个食物只产生一条 change_log，彻底解决"每阶段写一条"的历史记录重复问题。
   * FIX: 接收 fieldFilter 并透传到 enrichFoodByStage，使 /enqueue 的 fields 参数生效。
   */
  private async processFoodsByStage(
    foodId: string,
    stages: number[],
    staged: boolean,
    fieldFilter?: EnrichmentJobData['fields'],
  ): Promise<void> {
    const multiResult = await this.enrichmentService.enrichFoodByStage(
      foodId,
      stages,
      fieldFilter,
    );
    if (!multiResult) {
      this.logger.warn(
        `分阶段补全无结果（无缺失字段或全部失败）: foodId=${foodId}`,
      );
      return;
    }

    // ── 将所有阶段结果合并为一个 merged result ──────────────────────────
    const mergedFields: Record<string, any> = {};
    const mergedFieldConfidence: Record<string, number> = {};
    let anyStaged = false;

    for (const sr of multiResult.stages) {
      if (!sr.result) continue;
      // 若任一阶段置信度低于阈值，则整体进 staged
      if (this.enrichmentService.shouldStage(sr.result, staged)) {
        anyStaged = true;
      }
      for (const [k, v] of Object.entries(sr.result)) {
        if (k === 'confidence' || k === 'reasoning' || k === 'fieldConfidence')
          continue;
        if (v !== null && v !== undefined && !(k in mergedFields)) {
          mergedFields[k] = v;
        }
      }
      const fc = sr.result.fieldConfidence ?? {};
      for (const [k, v] of Object.entries(fc)) {
        if (!(k in mergedFieldConfidence)) mergedFieldConfidence[k] = v;
      }
    }

    if (Object.keys(mergedFields).length === 0) {
      this.logger.log(
        `分阶段补全无新字段: foodId=${foodId}, 总失败=${multiResult.totalFailed}`,
      );
      return;
    }

    const mergedResult = {
      ...mergedFields,
      confidence: multiResult.overallConfidence,
      reasoning:
        multiResult.stages
          .map((s) => s.result?.reasoning)
          .filter(Boolean)
          .join(' | ') || undefined,
      fieldConfidence:
        Object.keys(mergedFieldConfidence).length > 0
          ? mergedFieldConfidence
          : undefined,
    };

    // ── 一次性写入（一条 change_log）────────────────────────────────────
    if (anyStaged) {
      const logId = await this.enrichmentService.stageEnrichment(
        foodId,
        mergedResult,
        'foods',
        undefined,
        undefined,
        'ai_enrichment_worker',
      );
      this.logger.log(
        `Staged（合并全阶段）foodId=${foodId}, logId=${logId}, ` +
          `confidence=${multiResult.overallConfidence}, ` +
          `mergedFields=${Object.keys(mergedFields).length}`,
      );
    } else {
      const { updated, skipped } = await this.enrichmentService.applyEnrichment(
        foodId,
        mergedResult,
        'ai_enrichment_worker',
      );
      this.logger.log(
        `直接入库（合并全阶段）foodId=${foodId}, ` +
          `updated=[${updated.join(',')}], skipped=[${skipped.join(',')}]`,
      );
    }

    this.logger.log(
      `分阶段补全完成: foodId=${foodId}, ` +
        `总补全=${multiResult.totalEnriched}, ` +
        `总失败=${multiResult.totalFailed}, ` +
        `综合置信度=${multiResult.overallConfidence}`,
    );
  }

  // ─── 主表补全（无 stages 参数时默认走全部5阶段）─────────────────────

  private async processFoods(
    foodId: string,
    staged: boolean,
    fieldFilter?: EnrichmentJobData['fields'],
  ): Promise<void> {
    // V8.2: 旧版 enrichFood() 已移除，统一走分阶段补全流程
    await this.processFoodsByStage(
      foodId,
      [1, 2, 3, 4, 5],
      staged,
      fieldFilter,
    );
  }

  // ─── 翻译补全 ──────────────────────────────────────────────────────────

  private async processTranslation(
    foodId: string,
    locales: string[],
    staged: boolean,
  ): Promise<void> {
    const normalizedLocales = [...new Set(locales.filter(Boolean))];
    if (normalizedLocales.length === 0) {
      this.logger.warn(`无翻译补全目标语言: foodId=${foodId}`);
      return;
    }

    const results = await this.enrichmentService.enrichTranslations(
      foodId,
      normalizedLocales,
    );

    for (const locale of normalizedLocales) {
      const result = results[locale];
      if (!result) {
        this.logger.warn(`无翻译补全结果: foodId=${foodId}, locale=${locale}`);
        continue;
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
          [locale],
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
    // V8.4 修复：job.opts?.attempts 在手动重入队或旧任务中可能为 undefined。
    // BullMQ 默认 attempts=1；若显式设置则使用设置值。
    // 当 attemptsMade >= 该值时说明不会再重试，标记最终失败。
    const maxAttempts = job.opts?.attempts ?? 1;
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
