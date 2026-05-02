import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  snakeToCamel,
  ENRICHABLE_FIELDS,
  type EnrichmentTarget,
} from '../constants/enrichable-fields';
import { ENRICHMENT_STAGES } from '../constants/enrichment-stages';
import {
  NUTRIENT_RANGES,
  COMPLETENESS_PARTIAL_THRESHOLD,
  COMPLETENESS_COMPLETE_THRESHOLD,
} from '../constants/nutrient-ranges';
import {
  ENRICHMENT_FIELD_LABELS,
  ENRICHMENT_FIELD_UNITS,
} from '../../../../modules/food/food.types';
import {
  getFieldSqlRef,
  getFoodSplitFromSql,
  buildPresentFieldSqlCondition,
} from '../helpers/enrichment-sql.helper';
import {
  type EnrichmentResult,
  type StagedEnrichment,
} from '../constants/enrichment.types';
import {
  EnrichmentCompletenessService,
  COMPLETENESS_SOURCE_FIELDS,
} from './enrichment-completeness.service';
import { FoodProvenanceRepository } from '../../../../modules/food/repositories';

/**
 * Minimal interface describing the apply-methods that EnrichmentStagingService
 * needs from FoodEnrichmentService. Using an interface + forwardRef avoids
 * importing the concrete class (which would create a compile-time circular dep).
 */
export interface IEnrichmentApplyService {
  applyEnrichment(
    foodId: string,
    result: EnrichmentResult,
    operator?: string,
  ): Promise<{ updated: string[]; skipped: string[] }>;
  applyTranslationEnrichment(
    foodId: string,
    results: Record<string, Record<string, any>>,
    operator?: string,
  ): Promise<{
    localesSummary: Record<
      string,
      { action: 'created' | 'updated' | 'skipped'; fields: string[] }
    >;
  }>;
  applyRegionalEnrichment(
    foodId: string,
    region: string,
    proposed: EnrichmentResult,
    operator?: string,
  ): Promise<{ action: string; fields: string[] }>;
}

/** Injection token used for the forwardRef IEnrichmentApplyService */
export const ENRICHMENT_APPLY_SERVICE = 'ENRICHMENT_APPLY_SERVICE';

@Injectable()
export class EnrichmentStagingService {
  private readonly logger = new Logger(EnrichmentStagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly completenessService: EnrichmentCompletenessService,
    private readonly provenanceRepo: FoodProvenanceRepository,
    @Inject(ENRICHMENT_APPLY_SERVICE)
    private readonly applyService: IEnrichmentApplyService,
  ) {}

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async getSuccessSourcePresence(
    foodId: string,
    fields: string[],
  ): Promise<Record<string, boolean>> {
    const trackedFields = fields.filter((field) =>
      COMPLETENESS_SOURCE_FIELDS.has(field),
    );
    return this.provenanceRepo.hasSuccessfulSources(foodId, trackedFields);
  }

  private computeCompletenessScore(
    food: any,
    successSourcePresence: Record<string, boolean>,
  ) {
    return this.completenessService.computeCompletenessScore(
      food,
      successSourcePresence,
    );
  }

  private async getCategoryAverage(
    fields: string[],
    category: string,
    subCategory: string | null,
  ): Promise<Record<string, number> | null> {
    if (!category) return null;

    const countResult = subCategory
      ? await this.prisma.$queryRaw<[{ count: string }]>(
          Prisma.sql`SELECT COUNT(*)::text AS count FROM foods WHERE category = ${category} AND sub_category = ${subCategory}`,
        )
      : await this.prisma.$queryRaw<[{ count: string }]>(
          Prisma.sql`SELECT COUNT(*)::text AS count FROM foods WHERE category = ${category}`,
        );
    const count = parseInt(countResult[0]?.count ?? '0', 10);
    if (count < 3) return null;

    const validFields = fields.filter((f) =>
      ENRICHABLE_FIELDS.includes(f as any),
    );
    if (validFields.length === 0) return null;

    const selectParts = validFields
      .map((f) => `ROUND(AVG(${getFieldSqlRef(f)})::numeric, 2) AS "${f}"`)
      .join(', ');
    const notNullParts = validFields
      .map((f) => buildPresentFieldSqlCondition(f))
      .join(' AND ');

    const result = subCategory
      ? await this.prisma.$queryRaw<Record<string, any>[]>(
          Prisma.sql`SELECT ${Prisma.raw(selectParts)} ${Prisma.raw(getFoodSplitFromSql())} WHERE foods.category = ${category} AND foods.sub_category = ${subCategory} AND ${Prisma.raw(notNullParts)}`,
        )
      : await this.prisma.$queryRaw<Record<string, any>[]>(
          Prisma.sql`SELECT ${Prisma.raw(selectParts)} ${Prisma.raw(getFoodSplitFromSql())} WHERE foods.category = ${category} AND ${Prisma.raw(notNullParts)}`,
        );

    if (!result[0]) return null;

    const avgData: Record<string, number> = {};
    let hasValue = false;
    for (const field of validFields) {
      const val = result[0][field];
      if (val !== null && val !== undefined) {
        avgData[field] = parseFloat(val);
        hasValue = true;
      }
    }

    return hasValue ? avgData : null;
  }

  private normalizeTranslationLocales(changes: Record<string, any>): string[] {
    const locales = Array.isArray(changes.locales)
      ? changes.locales.filter(
          (locale): locale is string =>
            typeof locale === 'string' && locale.length > 0,
        )
      : [];
    if (locales.length > 0) return [...new Set(locales)];
    return [];
  }

  private getTranslationProposedValues(
    changes: Record<string, any>,
    proposed: EnrichmentResult,
    locale: string,
  ): EnrichmentResult {
    const localized = changes.proposedValuesByLocale?.[locale];
    if (
      localized &&
      typeof localized === 'object' &&
      !Array.isArray(localized)
    ) {
      return localized as EnrichmentResult;
    }
    return proposed;
  }

  // ─── stageEnrichment ──────────────────────────────────────────────────────

  async stageEnrichment(
    foodId: string,
    result: EnrichmentResult,
    target: EnrichmentTarget = 'foods',
    locales?: string[],
    region?: string,
    operator = 'ai_enrichment',
  ): Promise<string> {
    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
    if (!food) throw new Error(`Food ${foodId} not found`);

    const normalizedLocales = [...new Set((locales ?? []).filter(Boolean))];

    const changesPayload = {
      target,
      locales: normalizedLocales.length > 0 ? normalizedLocales : null,
      region: region ?? null,
      proposedValues: result,
      confidence: result.confidence,
      reasoning: result.reasoning ?? null,
    };

    // V8.4: 防重 — 若该食物已存在未审核的 staged 记录，则覆盖而非新建
    const andConditions: Prisma.FoodChangeLogsWhereInput[] = [
      { changes: { path: ['target'], equals: target } },
    ];
    if (normalizedLocales.length > 0) {
      andConditions.push({
        changes: { path: ['locales'], equals: normalizedLocales },
      });
    }
    if (region)
      andConditions.push({ changes: { path: ['region'], equals: region } });

    const existingStagedWhere: Prisma.FoodChangeLogsWhereInput = {
      foodId,
      action: 'ai_enrichment_staged',
      AND: andConditions,
    };

    const existingStaged = await this.prisma.foodChangeLogs.findFirst({
      where: existingStagedWhere,
      orderBy: { createdAt: 'desc' },
    });

    let logId: string;
    if (existingStaged) {
      await this.prisma.foodChangeLogs.update({
        where: { id: existingStaged.id },
        data: {
          version: food.dataVersion ?? 1,
          changes: changesPayload,
          reason: `AI 暂存补全（${target}${normalizedLocales.length > 0 ? '/' + normalizedLocales.join(',') : ''}${region ? '/' + region : ''}），待人工审核`,
          operator,
          createdAt: new Date(),
        },
      });
      logId = existingStaged.id;
      this.logger.log(
        `Updated existing staged enrichment for "${food.name}" (${target}), logId=${logId}, confidence=${result.confidence}`,
      );
    } else {
      const log = await this.prisma.foodChangeLogs.create({
        data: {
          foodId: foodId,
          version: food.dataVersion ?? 1,
          action: 'ai_enrichment_staged',
          changes: changesPayload,
          reason: `AI 暂存补全（${target}${normalizedLocales.length > 0 ? '/' + normalizedLocales.join(',') : ''}${region ? '/' + region : ''}），待人工审核`,
          operator,
        },
      });
      logId = log.id;
      this.logger.log(
        `Staged enrichment for "${food.name}" (${target}), logId=${logId}, confidence=${result.confidence}`,
      );
    }

    return logId;
  }

  // ─── getStagedEnrichments ─────────────────────────────────────────────────

  async getStagedEnrichments(params: {
    page?: number;
    pageSize?: number;
    foodId?: string;
    target?: EnrichmentTarget;
  }): Promise<{
    list: StagedEnrichment[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 20;
    const { foodId, target } = params;
    const skip = (page - 1) * pageSize;

    const where: any = { action: 'ai_enrichment_staged' };
    if (foodId) where.foodId = foodId;
    if (target) where.changes = { path: ['target'], equals: target };

    const [rawList, total] = await Promise.all([
      this.prisma.foodChangeLogs.findMany({
        where,
        orderBy: { version: 'desc' },
        skip,
        take: pageSize,
        include: { foods: { select: { name: true } } },
      }),
      this.prisma.foodChangeLogs.count({ where }),
    ]);

    // V8.3: 批量获取关联食物的当前值，用于 diff 对比
    const foodIds = [...new Set(rawList.map((log) => log.foodId))];
    const foods =
      foodIds.length > 0
        ? await this.prisma.food.findMany({
            where: { id: { in: foodIds } },
          })
        : [];
    const foodMap = new Map(foods.map((f) => [f.id, f]));

    const list: StagedEnrichment[] = rawList.map((log) => {
      const changes = log.changes as Record<string, any>;
      const proposed = changes?.proposedValues ?? {};
      const food = foodMap.get(log.foodId);

      let currentValues: Record<string, any> | undefined;
      if (food && typeof proposed === 'object') {
        currentValues = {};
        for (const key of Object.keys(proposed)) {
          if (
            key === 'confidence' ||
            key === 'reasoning' ||
            key === 'field_confidence'
          )
            continue;
          const camelKey = snakeToCamel(key);
          currentValues[key] = (food as any)[camelKey] ?? null;
        }
      }

      return {
        id: log.id,
        foodId: log.foodId,
        foodName: (log as any).foods?.name ?? undefined,
        action: log.action,
        changes,
        reason: log.reason,
        operator: log.operator,
        version: log.version,
        createdAt: log.createdAt,
        currentValues,
      };
    });

    return { list, total, page, pageSize };
  }

  // ─── getEnrichmentPreview ─────────────────────────────────────────────────

  async getEnrichmentPreview(logId: string): Promise<{
    food: {
      id: string;
      name: string;
      nameZh: string | null;
      category: string | null;
      subCategory: string | null;
    };
    staged: {
      logId: string;
      changes: Record<string, any>;
      confidence: number;
      target: string;
      stage: number | null;
      createdAt: Date;
    };
    diff: Array<{
      field: string;
      label: string;
      currentValue: any;
      suggestedValue: any;
      unit: string;
      validRange: { min: number; max: number } | null;
      isNew: boolean;
      isModified: boolean;
      confidenceLevel: 'high' | 'medium' | 'low';
      fieldConfidence: number;
    }>;
    categoryAverage: Record<string, number> | null;
  }> {
    const log = await this.prisma.foodChangeLogs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`Staged log ${logId} not found`);
    if (log.action !== 'ai_enrichment_staged') {
      throw new Error(`Log ${logId} is not a staged enrichment`);
    }

    const food = await this.prisma.food.findUnique({
      where: { id: log.foodId },
      include: {
        foodTranslations: {
          where: { locale: 'zh-CN' },
          take: 1,
          select: { name: true },
        },
      },
    });
    if (!food) throw new Error(`Food ${log.foodId} not found`);

    const nameZh = (food as any).foodTranslations?.[0]?.name ?? null;

    const changes = log.changes as Record<string, any>;
    const proposedValues = changes.proposedValues ?? {};
    const target = changes.target ?? 'foods';
    const stage = changes.stage ?? null;

    const diff: Array<{
      field: string;
      label: string;
      currentValue: any;
      suggestedValue: any;
      unit: string;
      validRange: { min: number; max: number } | null;
      isNew: boolean;
      isModified: boolean;
      confidenceLevel: 'high' | 'medium' | 'low';
      fieldConfidence: number;
    }> = [];

    const fieldConfidenceMap: Record<string, number> =
      proposedValues.fieldConfidence ?? {};
    const overallConfidence: number = changes.confidence ?? 0;

    for (const [field, suggestedValue] of Object.entries(proposedValues)) {
      if (
        field === 'confidence' ||
        field === 'reasoning' ||
        field === 'field_confidence'
      )
        continue;
      const camelField = snakeToCamel(field);
      const currentValue = (food as any)[camelField] ?? null;
      const isNew = currentValue === null || currentValue === undefined;
      const isModified = !isNew && currentValue !== suggestedValue;
      const fc = fieldConfidenceMap[field] ?? overallConfidence;
      const confidenceLevel: 'high' | 'medium' | 'low' =
        fc >= 0.8 ? 'high' : fc >= 0.5 ? 'medium' : 'low';

      diff.push({
        field,
        label: ENRICHMENT_FIELD_LABELS[camelField] ?? field,
        currentValue,
        suggestedValue,
        unit: ENRICHMENT_FIELD_UNITS[camelField] ?? '',
        validRange: NUTRIENT_RANGES[camelField] ?? null,
        isNew,
        isModified,
        confidenceLevel,
        fieldConfidence: Math.round(fc * 100) / 100,
      });
    }

    const numericFields = diff
      .filter((d) => NUTRIENT_RANGES[snakeToCamel(d.field)])
      .map((d) => d.field);
    let categoryAverage: Record<string, number> | null = null;
    if (numericFields.length > 0 && food.category) {
      categoryAverage = await this.getCategoryAverage(
        numericFields,
        food.category,
        food.subCategory ?? null,
      );
    }

    return {
      food: {
        id: food.id,
        name: food.name,
        nameZh,
        category: food.category ?? null,
        subCategory: food.subCategory ?? null,
      },
      staged: {
        logId: log.id,
        changes: proposedValues,
        confidence: changes.confidence ?? 0,
        target,
        stage,
        createdAt: log.createdAt,
      },
      diff,
      categoryAverage,
    };
  }

  // ─── getBatchEnrichmentPreview ────────────────────────────────────────────

  async getBatchEnrichmentPreview(logIds: string[]): Promise<{
    results: Array<{
      logId: string;
      success: boolean;
      data?: Awaited<ReturnType<typeof this.getEnrichmentPreview>>;
      error?: string;
    }>;
    summary: {
      total: number;
      success: number;
      failed: number;
      avgConfidence: number;
    };
  }> {
    const MAX_BATCH_SIZE = 50;
    const ids = logIds.slice(0, MAX_BATCH_SIZE);

    const results = await Promise.allSettled(
      ids.map(async (logId) => {
        const data = await this.getEnrichmentPreview(logId);
        return { logId, success: true as const, data };
      }),
    );

    const items = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        logId: ids[i],
        success: false as const,
        error: (r.reason as Error).message,
      };
    });

    const successItems = items.filter((it) => it.success && it.data);
    const confidences = successItems.map(
      (it) => (it as any).data.staged.confidence as number,
    );
    const avgConfidence =
      confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;

    return {
      results: items,
      summary: {
        total: ids.length,
        success: successItems.length,
        failed: ids.length - successItems.length,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
      },
    };
  }

  // ─── approveStaged ────────────────────────────────────────────────────────

  async approveStaged(
    logId: string,
    operator = 'admin',
    /** V8.0: 可选，只入库指定的字段（字段级选择性入库） */
    selectedFields?: string[],
  ): Promise<{ applied: boolean; detail: string }> {
    const log = await this.prisma.foodChangeLogs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`Staged log ${logId} not found`);
    if (log.action !== 'ai_enrichment_staged') {
      throw new Error(`Log ${logId} is not a staged enrichment`);
    }

    const changes = log.changes as Record<string, any>;
    const target: EnrichmentTarget = changes.target ?? 'foods';
    const proposed: EnrichmentResult = changes.proposedValues ?? {};

    // V8.0: 如果指定了 selectedFields，只保留选中的字段
    let filteredProposed = proposed;
    if (selectedFields && selectedFields.length > 0 && target === 'foods') {
      const filteredData: EnrichmentResult = {
        confidence: proposed.confidence,
        reasoning: proposed.reasoning,
        fieldConfidence: proposed.fieldConfidence,
      };
      for (const field of selectedFields) {
        if (proposed[field] !== undefined) {
          filteredData[field] = proposed[field];
        }
      }
      filteredProposed = filteredData;
    }

    let detail = '';

    if (target === 'foods') {
      const { updated, skipped } = await this.applyService.applyEnrichment(
        log.foodId,
        filteredProposed,
        operator,
      );
      detail = `updated=[${updated.join(',')}], skipped=[${skipped.join(',')}]`;
      if (selectedFields) {
        detail += `, selectedFields=[${selectedFields.join(',')}]`;
      }
    } else if (target === 'translations') {
      const targetLocales = this.normalizeTranslationLocales(changes);
      if (targetLocales.length === 0) {
        throw new Error(`Staged log ${logId} missing translation locale`);
      }
      const localeResults: Record<string, Record<string, any>> = {};
      for (const locale of targetLocales) {
        localeResults[locale] = this.getTranslationProposedValues(
          changes,
          proposed,
          locale,
        );
      }
      const res = await this.applyService.applyTranslationEnrichment(
        log.foodId,
        localeResults,
        operator,
      );
      detail = Object.entries(res.localesSummary)
        .map(([l, s]) => `${l}:${s.action}[${s.fields.join(',')}]`)
        .join('; ');
    } else if (target === 'regional' && changes.region) {
      const res = await this.applyService.applyRegionalEnrichment(
        log.foodId,
        changes.region,
        proposed,
        operator,
      );
      detail = `${res.action} fields=[${res.fields.join(',')}]`;
    }

    // 将 staged log 标记为已审批
    await this.prisma.foodChangeLogs.update({
      where: { id: logId },
      data: {
        action: 'ai_enrichment_approved',
        reason: `人工审核通过: ${detail}`,
        operator,
      },
    });

    // V8.1: 更新 foods 表的审核者追踪字段
    // V8.2: 审核通过后重新计算并更新 data_completeness 和 enrichment_status
    if (target === 'foods') {
      const updatedFood = await this.prisma.food.findUnique({
        where: { id: log.foodId },
      });
      if (updatedFood) {
        const completeness = this.computeCompletenessScore(
          updatedFood,
          await this.getSuccessSourcePresence(
            log.foodId,
            ENRICHMENT_STAGES.flatMap(
              (stage) => stage.fields as readonly string[],
            ),
          ),
        );
        const enrichmentStatus =
          completeness.score >= COMPLETENESS_COMPLETE_THRESHOLD
            ? 'completed'
            : completeness.score >= COMPLETENESS_PARTIAL_THRESHOLD
              ? 'partial'
              : 'pending';

        await this.prisma.food.update({
          where: { id: log.foodId },
          data: {
            reviewedBy: operator,
            reviewedAt: new Date(),
            dataCompleteness: completeness.score,
            enrichmentStatus: enrichmentStatus,
          },
        });
      }
    }

    return { applied: true, detail };
  }

  // ─── rejectStaged ─────────────────────────────────────────────────────────

  async rejectStaged(
    logId: string,
    reason: string,
    operator = 'admin',
  ): Promise<void> {
    const log = await this.prisma.foodChangeLogs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`Staged log ${logId} not found`);
    if (log.action !== 'ai_enrichment_staged') {
      throw new Error(`Log ${logId} is not a staged enrichment`);
    }

    await this.prisma.foodChangeLogs.update({
      where: { id: logId },
      data: {
        action: 'ai_enrichment_rejected',
        reason: `人工拒绝: ${reason}`,
        operator,
      },
    });

    // V8.3: 更新 foods.enrichment_status 为 'rejected'
    await this.prisma.food.update({
      where: { id: log.foodId },
      data: { enrichmentStatus: 'rejected' },
    });
  }

  // ─── batchApproveStaged ───────────────────────────────────────────────────

  async batchApproveStaged(
    logIds: string[],
    operator = 'admin',
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const logId of logIds) {
      try {
        await this.approveStaged(logId, operator);
        success++;
      } catch (e) {
        failed++;
        errors.push(`${logId}: ${(e as Error).message}`);
      }
    }

    return { success, failed, errors };
  }

  // ─── batchRejectStaged ────────────────────────────────────────────────────

  async batchRejectStaged(
    logIds: string[],
    reason: string,
    operator = 'admin',
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const logId of logIds) {
      try {
        await this.rejectStaged(logId, reason, operator);
        success++;
      } catch (e) {
        failed++;
        errors.push(`${logId}: ${(e as Error).message}`);
      }
    }

    return { success, failed, errors };
  }

  // ─── getEnrichmentHistory ─────────────────────────────────────────────────

  async getEnrichmentHistory(params: {
    foodId?: string;
    action?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    list: StagedEnrichment[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { foodId, action } = params;
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 20;
    const skip = (page - 1) * pageSize;

    const where: any = {
      action: {
        in: action
          ? [action]
          : [
              // FIX: 历史记录不包含 staged（staged 在待审核 tab 展示）
              'ai_enrichment',
              'ai_enrichment_approved',
              'ai_enrichment_rejected',
              'ai_enrichment_rollback',
              'ai_enrichment_rolled_back',
            ],
      },
    };
    if (foodId) where.foodId = foodId;

    const [rawList, total] = await Promise.all([
      this.prisma.foodChangeLogs.findMany({
        where,
        orderBy: { version: 'desc' },
        skip,
        take: pageSize,
        include: { foods: { select: { name: true } } },
      }),
      this.prisma.foodChangeLogs.count({ where }),
    ]);

    const list: StagedEnrichment[] = rawList.map((log) => ({
      id: log.id,
      foodId: log.foodId,
      foodName: (log as any).foods?.name ?? undefined,
      action: log.action,
      changes: log.changes as Record<string, any>,
      reason: log.reason,
      operator: log.operator,
      version: log.version,
      createdAt: log.createdAt,
    }));

    return { list, total, page, pageSize };
  }
}
