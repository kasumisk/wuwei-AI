/**
 * EnrichmentNowService
 *
 * 单条食物立即补全（同步执行，不走队列）。
 * 拆分自 food-enrichment.service.ts。
 */

import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FoodProvenanceRepository } from '../../../../modules/food/repositories';
import {
  snakeToCamel,
  type EnrichableField,
  JSON_ARRAY_FIELDS,
} from '../constants/enrichable-fields';
import {
  ENRICHMENT_STAGES,
  type StageEnrichmentResult,
  type MultiStageEnrichmentResult,
} from '../constants/enrichment-stages';
import {
  COMPLETENESS_PARTIAL_THRESHOLD,
  COMPLETENESS_COMPLETE_THRESHOLD,
  CONFIDENCE_STAGING_THRESHOLD,
} from '../constants/nutrient-ranges';
import {
  type EnrichmentResult,
  type CompletenessScore,
} from '../constants/enrichment.types';
import {
  EnrichmentCompletenessService,
  COMPLETENESS_SOURCE_FIELDS,
} from './enrichment-completeness.service';
import { EnrichmentStagingService } from './enrichment-staging.service';
import { EnrichmentStageService } from './enrichment-stage.service';
import { EnrichmentApplyService } from './enrichment-apply.service';

@Injectable()
export class EnrichmentNowService {
  private readonly logger = new Logger(EnrichmentNowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provenanceRepo: FoodProvenanceRepository,
    private readonly completenessService: EnrichmentCompletenessService,
    @Inject(forwardRef(() => EnrichmentStagingService))
    private readonly stagingService: EnrichmentStagingService,
    private readonly stageService: EnrichmentStageService,
    private readonly applyService: EnrichmentApplyService,
  ) {}

  /**
   * 单条食物立即补全（同步执行，不走队列）
   */
  async enrichFoodNow(
    foodId: string,
    apiKey: string,
    options: {
      stages?: number[];
      fields?: EnrichableField[];
      staged?: boolean;
    } = {},
  ): Promise<{
    success: boolean;
    foodId: string;
    foodName: string;
    stageResults: StageEnrichmentResult[];
    totalEnriched: number;
    totalFailed: number;
    completeness: CompletenessScore;
    enrichmentStatus: string;
  }> {
    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
    if (!food) {
      throw new Error(`食物 ${foodId} 不存在`);
    }

    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY 未配置，无法执行 AI 补全');
    }

    this.logger.log(`[enrichFoodNow] 开始补全 "${food.name}" (${foodId})`);

    // 确定需要补全的阶段
    let targetStages = options.stages;
    if (!targetStages || targetStages.length === 0) {
      targetStages = ENRICHMENT_STAGES.filter((stage) => {
        const stageFields = options.fields
          ? stage.fields.filter((f) => (options.fields as string[]).includes(f))
          : stage.fields;
        if (stageFields.length === 0) return false;

        return stageFields.some((field) => {
          const value = (food as any)[snakeToCamel(field)];
          if (value === null || value === undefined) return true;
          if (
            (JSON_ARRAY_FIELDS as readonly string[]).includes(field) &&
            Array.isArray(value) &&
            value.length === 0
          )
            return true;
          return false;
        });
      }).map((s) => s.stage);
    }

    if (targetStages.length === 0) {
      const completeness = this.completenessService.computeCompletenessScore(
        food,
        await this.getSuccessSourcePresence(foodId),
      );
      return {
        success: true,
        foodId,
        foodName: food.name,
        stageResults: [],
        totalEnriched: 0,
        totalFailed: 0,
        completeness,
        enrichmentStatus: 'completed',
      };
    }

    const multiResult = await this.stageService.enrichFoodByStage(
      foodId,
      targetStages,
      options.fields,
    );
    if (!multiResult) {
      const completeness = this.completenessService.computeCompletenessScore(
        food,
        await this.getSuccessSourcePresence(foodId),
      );
      return {
        success: false,
        foodId,
        foodName: food.name,
        stageResults: [],
        totalEnriched: 0,
        totalFailed: 0,
        completeness,
        enrichmentStatus: food.enrichmentStatus || 'failed',
      };
    }

    // 处理每个阶段的结果
    const staged = options.staged ?? false;
    let totalFailed = 0;

    // 将所有阶段结果合并为一个 EnrichmentResult，只写一条汇总 change_log
    const mergedFields: Record<string, any> = {};
    const mergedFieldConfidence: Record<string, number> = {};
    let anyStaged = false;

    for (const sr of multiResult.stages) {
      if (!sr.result) {
        totalFailed += sr.failedFields.length;
        continue;
      }
      if (sr.result.confidence < CONFIDENCE_STAGING_THRESHOLD) {
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
        if (!(k in mergedFieldConfidence)) {
          mergedFieldConfidence[k] = v;
        }
      }
      totalFailed += sr.failedFields.length;
    }

    const mergedResult: EnrichmentResult = {
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

    const shouldStage = staged || anyStaged;
    let totalEnriched = 0;

    if (Object.keys(mergedFields).length > 0) {
      if (shouldStage) {
        await this.stagingService.stageEnrichment(
          foodId,
          mergedResult,
          'foods',
          undefined,
          undefined,
          'ai_enrichment_now',
        );
        totalEnriched = multiResult.stages.reduce(
          (sum, sr) => sum + sr.enrichedFields.length,
          0,
        );
      } else {
        const applied = await this.applyService.applyEnrichment(
          foodId,
          mergedResult,
          'ai_enrichment_now',
        );
        totalEnriched = applied.updated.length;
      }
    }

    const updatedFood = await this.prisma.food.findUnique({
      where: { id: foodId },
    });
    const completeness = this.completenessService.computeCompletenessScore(
      updatedFood || food,
      await this.getSuccessSourcePresence(foodId),
    );

    let enrichmentStatus: string;
    if (totalEnriched === 0 && totalFailed > 0) {
      enrichmentStatus = 'failed';
    } else if (shouldStage) {
      enrichmentStatus = 'staged';
    } else {
      enrichmentStatus =
        completeness.score >= COMPLETENESS_COMPLETE_THRESHOLD
          ? 'completed'
          : completeness.score >= COMPLETENESS_PARTIAL_THRESHOLD
            ? 'partial'
            : 'pending';
    }

    if (shouldStage || (totalEnriched === 0 && totalFailed > 0)) {
      await this.prisma.food.update({
        where: { id: foodId },
        data: {
          enrichmentStatus: enrichmentStatus,
          lastEnrichedAt: new Date(),
        },
      });
    }

    const allFailedFields = multiResult.stages.flatMap((sr) => sr.failedFields);
    if (allFailedFields.length > 0) {
      await this.stageService.persistFailedFields(
        foodId,
        allFailedFields,
        multiResult.stages,
      );
    }

    this.logger.log(
      `[enrichFoodNow] "${food.name}" 补全完成: ${totalEnriched} 字段成功, ${totalFailed} 字段失败, 完整度 ${completeness.score}%`,
    );

    return {
      success: true,
      foodId,
      foodName: food.name,
      stageResults: multiResult.stages,
      totalEnriched,
      totalFailed,
      completeness,
      enrichmentStatus,
    };
  }

  private async getSuccessSourcePresence(
    foodId: string,
  ): Promise<Record<string, boolean>> {
    const allFields = ENRICHMENT_STAGES.flatMap(
      (stage) => stage.fields as readonly string[],
    );
    const trackedFields = allFields.filter((field) =>
      COMPLETENESS_SOURCE_FIELDS.has(field),
    );
    return this.provenanceRepo.hasSuccessfulSources(foodId, trackedFields);
  }
}
