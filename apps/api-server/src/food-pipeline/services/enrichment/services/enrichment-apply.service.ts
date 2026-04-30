/**
 * EnrichmentApplyService
 *
 * 拆分自 food-enrichment.service.ts，负责将 AI 补全结果写入数据库：
 *  - applyEnrichment            — 直接写入 foods 主表
 *  - applyTranslationEnrichment — 写入 food_translations 关联表
 *  - applyRegionalEnrichment    — 写入 food_regional_info 关联表
 *  - rollbackEnrichment         — 回退单条补全记录
 *  - batchRollbackEnrichment    — 批量回退补全记录
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FoodProvenanceRepository } from '../../../../modules/food/repositories';
import {
  upsertFoodSplitTables,
  HEALTH_ASSESSMENT_FIELDS,
  NUTRITION_DETAIL_FIELDS,
  PORTION_GUIDE_FIELDS,
  TAXONOMY_FIELDS,
} from '../../../../modules/food/food-split.helper';

import {
  snakeToCamel,
  ENRICHABLE_FIELDS,
  type EnrichableField,
  JSON_ARRAY_FIELDS,
  JSON_OBJECT_FIELDS,
  AI_OVERRIDABLE_FIELDS,
} from '../constants/enrichable-fields';
import {
  buildFoodRegionalWhere,
  normalizeFoodAvailability,
  parseFoodRegionScope,
} from '../../../../common/utils/food-regional-info.util';
import {
  COMPLETENESS_PARTIAL_THRESHOLD,
  COMPLETENESS_COMPLETE_THRESHOLD,
} from '../constants/nutrient-ranges';
import { type EnrichmentResult } from '../constants/enrichment.types';
import { EnrichmentCompletenessService } from './enrichment-completeness.service';

/**
 * 所有拆分表字段的 camelCase 集合（foods 主表 Prisma model 中不存在这些字段）。
 * 写入 tx.food.update() 前必须过滤掉此集合中的字段，交由 upsertFoodSplitTables 处理。
 */
const SPLIT_TABLE_FIELDS: ReadonlySet<string> = new Set([
  ...NUTRITION_DETAIL_FIELDS,
  ...HEALTH_ASSESSMENT_FIELDS,
  ...TAXONOMY_FIELDS,
  ...PORTION_GUIDE_FIELDS,
]);

const NON_NULLABLE_MAIN_TABLE_ROLLBACK_DEFAULTS: Readonly<
  Record<string, unknown>
> = {
  commonalityScore: 0,
  popularity: 0,
  ingredientList: [],
};

@Injectable()
export class EnrichmentApplyService {
  private readonly logger = new Logger(EnrichmentApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provenanceRepo: FoodProvenanceRepository,
    private readonly completenessService: EnrichmentCompletenessService,
  ) {}

  private computeCompletenessScore(
    food: any,
    successSourcePresence: Record<string, boolean>,
  ) {
    return this.completenessService.computeCompletenessScore(
      food,
      successSourcePresence,
    );
  }

  private async getSuccessSourcePresence(
    foodId: string,
    fields: string[],
  ): Promise<Record<string, boolean>> {
    return this.provenanceRepo.hasSuccessfulSources(foodId, fields);
  }

  private async rollbackTranslationEnrichment(
    log: { id: string; foodId: string },
    changes: Record<string, any>,
    operator: string,
  ): Promise<{ rolledBack: boolean; detail: string }> {
    const summary =
      changes.summary && typeof changes.summary === 'object'
        ? changes.summary
        : {};
    const locales = Object.entries(summary).filter(
      ([locale, item]) =>
        typeof locale === 'string' &&
        locale.length > 0 &&
        item &&
        typeof item === 'object',
    );

    if (locales.length === 0) {
      return { rolledBack: false, detail: '该翻译记录无可回退的语言变更' };
    }

    const rollbackDetails: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const [locale, item] of locales) {
        const fields = Array.isArray((item as any).fields)
          ? (item as any).fields.filter(
              (field: unknown): field is string =>
                typeof field === 'string' && field.length > 0,
            )
          : [];

        if (fields.length === 0) continue;

        const translation = await tx.foodTranslations.findFirst({
          where: { foodId: log.foodId, locale },
        });
        if (!translation) continue;

        if (fields.includes('name')) {
          const loggedName = (item as any).values?.name;
          if (
            typeof loggedName === 'string' &&
            translation.name === loggedName
          ) {
            await tx.foodTranslations.delete({ where: { id: translation.id } });
            rollbackDetails.push(`${locale}: deleted`);
          }
          continue;
        }

        const rollbackData = Object.fromEntries(
          fields.map((field) => [field, null]),
        );
        await tx.foodTranslations.update({
          where: { id: translation.id },
          data: rollbackData,
        });
        rollbackDetails.push(`${locale}: ${fields.join(', ')}`);
      }

      if (rollbackDetails.length === 0) return;

      await tx.foodChangeLogs.update({
        where: { id: log.id },
        data: { action: 'ai_enrichment_rolled_back' },
      });

      const food = await tx.food.findUnique({ where: { id: log.foodId } });
      await tx.foodChangeLogs.create({
        data: {
          foodId: log.foodId,
          version: food?.dataVersion ?? 1,
          action: 'ai_enrichment_rollback',
          changes: {
            rolledBackLogId: log.id,
            target: 'food_translations',
            rolledBackLocales: rollbackDetails,
          },
          reason: `回退 ${rollbackDetails.length} 条翻译补全记录`,
          operator,
        },
      });
    });

    if (rollbackDetails.length === 0) {
      return { rolledBack: false, detail: '该翻译记录无可回退的字段' };
    }

    return {
      rolledBack: true,
      detail: `已回退 ${rollbackDetails.length} 条翻译记录: [${rollbackDetails.join('; ')}]`,
    };
  }

  private async rollbackRegionalEnrichment(
    log: { id: string; foodId: string },
    changes: Record<string, any>,
    operator: string,
  ): Promise<{ rolledBack: boolean; detail: string }> {
    const region = typeof changes.region === 'string' ? changes.region : '';
    const fields = Array.isArray(changes.fields)
      ? changes.fields.filter(
          (field: unknown): field is string =>
            typeof field === 'string' && field.length > 0,
        )
      : [];

    if (!region || fields.length === 0) {
      return { rolledBack: false, detail: '该地区信息记录无可回退的字段' };
    }

    const existing = await this.prisma.foodRegionalInfo.findFirst({
      where: { foodId: log.foodId, ...buildFoodRegionalWhere(region) },
    });
    if (!existing) {
      return { rolledBack: false, detail: '该地区信息记录不存在或已被删除' };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.foodRegionalInfo.update({
        where: { id: existing.id },
        data: Object.fromEntries(
          fields.map((field) => {
            const normalized = snakeToCamel(field);
            if (normalized === 'availability') return [normalized, 'UNKNOWN'];
            if (normalized === 'localPopularity') return [normalized, 0];
            if (
              normalized === 'confidence' ||
              normalized === 'seasonalityConfidence'
            ) {
              return [normalized, 0];
            }
            return [normalized, null];
          }),
        ),
      });

      await tx.foodChangeLogs.update({
        where: { id: log.id },
        data: { action: 'ai_enrichment_rolled_back' },
      });

      const food = await tx.food.findUnique({ where: { id: log.foodId } });
      await tx.foodChangeLogs.create({
        data: {
          foodId: log.foodId,
          version: food?.dataVersion ?? 1,
          action: 'ai_enrichment_rollback',
          changes: {
            rolledBackLogId: log.id,
            target: 'food_regional_info',
            region,
            rolledBackFields: fields,
          },
          reason: `回退 ${region} 地区信息 ${fields.length} 个字段`,
          operator,
        },
      });
    });

    return {
      rolledBack: true,
      detail: `已回退 ${region} 地区信息 ${fields.length} 个字段: [${fields.join(', ')}]`,
    };
  }

  async applyEnrichment(
    foodId: string,
    result: EnrichmentResult,
    operator = 'ai_enrichment',
  ): Promise<{ updated: EnrichableField[]; skipped: EnrichableField[] }> {
    const food = await this.prisma.food.findUnique({ where: { id: foodId } });
    if (!food) throw new Error(`Food ${foodId} not found`);

    const updates: Record<string, any> = {};
    const updated: EnrichableField[] = [];
    const skipped: EnrichableField[] = [];

    for (const field of ENRICHABLE_FIELDS) {
      const aiValue = result[field];
      if (aiValue === undefined || aiValue === null) continue;

      // Prisma schema 使用 camelCase 字段名（@map 到 snake_case DB 列），需转换查找
      const existing = (food as any)[snakeToCamel(field)];
      if (existing !== null && existing !== undefined) {
        // V8.8: AI_OVERRIDABLE_FIELDS 白名单字段即使已有值也允许 AI 覆盖
        if (AI_OVERRIDABLE_FIELDS.includes(field)) {
          // 直接落入下方赋值逻辑，不跳过
        } else if (
          (JSON_ARRAY_FIELDS as readonly string[]).includes(field) &&
          Array.isArray(existing) &&
          existing.length > 0
        ) {
          skipped.push(field);
          continue;
        } else if (
          (JSON_OBJECT_FIELDS as readonly string[]).includes(field) &&
          typeof existing === 'object' &&
          Object.keys(existing).length > 0
        ) {
          skipped.push(field);
          continue;
        } else if (
          !(JSON_ARRAY_FIELDS as readonly string[]).includes(field) &&
          !(JSON_OBJECT_FIELDS as readonly string[]).includes(field)
        ) {
          skipped.push(field);
          continue;
        }
      }

      updates[field] = aiValue;
      updated.push(field);
    }

    if (Object.keys(updates).length === 0) return { updated: [], skipped };

    const aiFieldConf = result.fieldConfidence ?? {};

    // V8.0: 使用 Prisma 交互式事务保证 foods.update + changelog.create 原子性
    const newVersion = (food.dataVersion || 1) + 1;

    // 预计算补全后的完整度
    const prismaUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      prismaUpdates[snakeToCamel(k)] = v;
    }
    const mergedFood = { ...food, ...prismaUpdates };
    const successSourcePresence = {
      ...(await this.getSuccessSourcePresence(
        foodId,
        Object.keys(prismaUpdates),
      )),
      ...Object.fromEntries(updated.map((field) => [field, true])),
    };
    const completeness = this.computeCompletenessScore(
      mergedFood,
      successSourcePresence,
    );
    const enrichmentStatus =
      completeness.score >= COMPLETENESS_COMPLETE_THRESHOLD
        ? 'completed'
        : completeness.score >= COMPLETENESS_PARTIAL_THRESHOLD
          ? 'partial'
          : 'pending';

    // 只将主表字段传入 tx.food.update；拆分表字段由 upsertFoodSplitTables 处理
    const mainUpdates = Object.fromEntries(
      Object.entries(prismaUpdates).filter(([k]) => !SPLIT_TABLE_FIELDS.has(k)),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.food.update({
        where: { id: foodId },
        data: {
          ...mainUpdates,
          confidence: Math.min(
            food.confidence?.toNumber() ?? 1,
            result.confidence,
          ) as any,
          dataVersion: newVersion,
          dataCompleteness: completeness.score,
          enrichmentStatus: enrichmentStatus,
          lastEnrichedAt: new Date(),
        },
      });

      // ARB-2026-04: 同步写入拆分表
      await upsertFoodSplitTables(tx, foodId, prismaUpdates);

      await tx.foodChangeLogs.create({
        data: {
          foodId: foodId,
          version: newVersion,
          action: 'ai_enrichment',
          changes: {
            enrichedFields: updated,
            confidence: result.confidence,
            fieldConfidence: Object.fromEntries(
              updated.map((field) => [
                field,
                aiFieldConf[field] ?? result.confidence,
              ]),
            ),
            values: updates,
            reasoning: result.reasoning ?? null,
          },
          reason: `AI 自动补全 ${updated.length} 个字段`,
          operator,
        },
      });
    });

    for (const field of updated) {
      await this.provenanceRepo.recordSuccess({
        foodId,
        fieldName: field,
        source: operator,
        confidence: aiFieldConf[field] ?? result.confidence,
        rawValue: updates[field] as Prisma.InputJsonValue,
      });
      await this.provenanceRepo.clearFailuresForField(foodId, field);
    }

    this.logger.log(
      `Applied enrichment "${food.name}": [${updated.join(', ')}] completeness=${completeness.score}%`,
    );
    return { updated, skipped };
  }

  // ─── 写入翻译关联表（批量模式，所有 locale 汇总成单条 changelog）────────

  /**
   * 批量写入多个 locale 的翻译补全结果，所有 locale 在单次事务内完成，
   * 最终只写入一条汇总 changelog（而非每 locale 一条）。
   *
   * @param foodId   食物 ID
   * @param results  locale → AI 补全结果的映射（已包含 confidence / reasoning）
   * @param operator 操作人标识
   */
  async applyTranslationEnrichment(
    foodId: string,
    results: Record<string, Record<string, any>>,
    operator = 'ai_enrichment',
  ): Promise<{
    localesSummary: Record<
      string,
      { action: 'created' | 'updated' | 'skipped'; fields: string[] }
    >;
  }> {
    const allowedTranslationFields = new Set([
      'name',
      'aliases',
      'description',
    ]);

    // 预取所有已有翻译记录
    const locales = Object.keys(results);
    const existingList = await this.prisma.foodTranslations.findMany({
      where: { foodId, locale: { in: locales } },
    });
    const existingMap = new Map(existingList.map((r) => [r.locale, r]));

    // 为每个 locale 计算待写字段
    type LocaleOp = {
      locale: string;
      existing: (typeof existingList)[number] | undefined;
      updates: Record<string, any>;
      confidence: number;
      reasoning: string | undefined;
      action: 'created' | 'updated' | 'skipped';
    };

    const ops: LocaleOp[] = [];

    for (const locale of locales) {
      const result = results[locale];
      const { confidence, reasoning, ...fields } = result;
      const existing = existingMap.get(locale);
      const updates: Record<string, any> = {};

      for (const [k, v] of Object.entries(fields)) {
        const prismaField = k;
        if (!allowedTranslationFields.has(prismaField)) continue;
        if (v === null || v === undefined) continue;
        if (existing && (existing as any)[prismaField]) continue; // 不覆盖已有
        updates[prismaField] = v;
      }

      if (Object.keys(updates).length > 0) {
        if (!existing?.source) updates.source = 'ai';
        if (!existing?.quality) {
          updates.quality =
            typeof confidence === 'number'
              ? Math.max(0, Math.min(1, confidence))
              : 0.5;
        }
        if (!existing?.reviewStatus) updates.reviewStatus = 'AI_GENERATED';
      }

      ops.push({
        locale,
        existing,
        updates,
        confidence: typeof confidence === 'number' ? confidence : 0.5,
        reasoning: typeof reasoning === 'string' ? reasoning : undefined,
        action:
          Object.keys(updates).length === 0
            ? 'skipped'
            : existing
              ? 'updated'
              : 'created',
      });
    }

    const activeOps = ops.filter((op) => op.action !== 'skipped');

    if (activeOps.length > 0) {
      // 汇总所有 locale 的字段变更，用于 changelog
      const changesSummary: Record<
        string,
        {
          fields: string[];
          values: Record<string, any>;
          confidence: number;
          reasoning?: string;
        }
      > = {};
      for (const op of activeOps) {
        changesSummary[op.locale] = {
          fields: Object.keys(op.updates),
          values: op.updates,
          confidence: op.confidence,
          reasoning: op.reasoning,
        };
      }

      await this.prisma.$transaction(async (tx) => {
        // 批量写入各 locale 翻译
        for (const op of activeOps) {
          if (!op.existing) {
            await tx.foodTranslations.create({
              data: { foodId, locale: op.locale, ...(op.updates as any) },
            });
          } else {
            await tx.foodTranslations.update({
              where: { id: op.existing.id },
              data: op.updates as any,
            });
          }
        }

        // 汇总所有 locale 写一条 changelog
        const food = await tx.food.findUnique({ where: { id: foodId } });
        if (food) {
          const totalFields = activeOps.reduce(
            (sum, op) => sum + Object.keys(op.updates).length,
            0,
          );
          await tx.foodChangeLogs.create({
            data: {
              foodId,
              version: food.dataVersion ?? 1,
              action: 'ai_enrichment',
              changes: {
                target: 'food_translations',
                locales: activeOps.map((op) => op.locale),
                summary: changesSummary,
              },
              reason: `AI 补全 ${activeOps.length} 个语言翻译，共 ${totalFields} 个字段`,
              operator,
            },
          });
        }
      });
    }

    const localesSummary: Record<
      string,
      { action: 'created' | 'updated' | 'skipped'; fields: string[] }
    > = {};
    for (const op of ops) {
      localesSummary[op.locale] = {
        action: op.action,
        fields: Object.keys(op.updates),
      };
    }

    return { localesSummary };
  }

  // ─── 写入地区信息关联表（直接模式）───────────────────────────────────

  async applyRegionalEnrichment(
    foodId: string,
    region: string,
    result: Record<string, any>,
    operator = 'ai_enrichment',
  ): Promise<{ action: 'created' | 'updated'; fields: string[] }> {
    const res = await this.applyRegionalEnrichments(
      foodId,
      { [region]: result },
      operator,
    );
    const summary = res.regionsSummary[region];
    if (!summary || summary.action === 'skipped') {
      return { action: 'updated', fields: [] };
    }
    return { action: summary.action, fields: summary.fields };
  }

  async applyRegionalEnrichments(
    foodId: string,
    results: Record<string, Record<string, any>>,
    operator = 'ai_enrichment',
  ): Promise<{
    regionsSummary: Record<
      string,
      { action: 'created' | 'updated' | 'skipped'; fields: string[] }
    >;
  }> {
    type RegionOp = {
      region: string;
      scope: ReturnType<typeof parseFoodRegionScope>;
      existing: Awaited<
        ReturnType<typeof this.prisma.foodRegionalInfo.findFirst>
      >;
      updates: Record<string, any>;
      confidence: number;
      reasoning: string | undefined;
      action: 'created' | 'updated' | 'skipped';
    };

    const ops: RegionOp[] = [];

    for (const [region, result] of Object.entries(results)) {
      const scope = parseFoodRegionScope(region);
      const existing = await this.prisma.foodRegionalInfo.findFirst({
        where: { foodId: foodId, ...scope },
      });

      const { confidence, reasoning, ...fields } = result;
      const updates: Record<string, any> = {};

      for (const [k, v] of Object.entries(fields)) {
        if (v === null || v === undefined) continue;

        const field = snakeToCamel(k);
        const value = this.normalizeRegionalFieldValue(field, v);
        if (value === undefined) continue;

        if (
          existing &&
          (existing as any)[field] !== null &&
          (existing as any)[field] !== undefined &&
          (field !== 'availability' || (existing as any)[field] !== 'UNKNOWN')
        )
          continue;
        updates[field] = value;
      }

      if (typeof confidence === 'number' && !existing?.confidence) {
        updates.confidence = Math.max(0, Math.min(1, confidence));
      }
      if (
        updates.priceMin !== undefined &&
        updates.priceMax !== undefined &&
        Number(updates.priceMin) > Number(updates.priceMax)
      ) {
        const min = updates.priceMax;
        updates.priceMax = updates.priceMin;
        updates.priceMin = min;
      }
      if (!existing?.source && !updates.source) {
        updates.source = 'AI';
      }

      ops.push({
        region,
        scope,
        existing,
        updates,
        confidence: typeof confidence === 'number' ? confidence : 0.5,
        reasoning: typeof reasoning === 'string' ? reasoning : undefined,
        action:
          Object.keys(updates).length === 0
            ? 'skipped'
            : existing
              ? 'updated'
              : 'created',
      });
    }

    const activeOps = ops.filter((op) => op.action !== 'skipped');

    if (activeOps.length > 0) {
      const changesSummary: Record<
        string,
        {
          fields: string[];
          values: Record<string, any>;
          confidence: number;
          reasoning?: string;
        }
      > = {};
      for (const op of activeOps) {
        changesSummary[op.region] = {
          fields: Object.keys(op.updates),
          values: op.updates,
          confidence: op.confidence,
          reasoning: op.reasoning,
        };
      }

      await this.prisma.$transaction(async (tx) => {
        for (const op of activeOps) {
          if (!op.existing) {
            await tx.foodRegionalInfo.create({
              data: { foodId, ...op.scope, ...(op.updates as any) },
            });
          } else {
            await tx.foodRegionalInfo.update({
              where: { id: op.existing.id },
              data: op.updates as any,
            });
          }
        }

        const food = await tx.food.findUnique({ where: { id: foodId } });
        if (food) {
          const totalFields = activeOps.reduce(
            (sum, op) => sum + Object.keys(op.updates).length,
            0,
          );
          await tx.foodChangeLogs.create({
            data: {
              foodId,
              version: food.dataVersion ?? 1,
              action: 'ai_enrichment',
              changes: {
                target: 'food_regional_info',
                regions: activeOps.map((op) => op.region),
                summary: changesSummary,
              },
              reason: `AI 补全 ${activeOps.length} 个地区信息，共 ${totalFields} 个字段`,
              operator,
            },
          });
        }
      });
    }

    const regionsSummary: Record<
      string,
      { action: 'created' | 'updated' | 'skipped'; fields: string[] }
    > = {};
    for (const op of ops) {
      regionsSummary[op.region] = {
        action: op.action,
        fields: Object.keys(op.updates),
      };
    }

    return { regionsSummary };
  }

  private normalizeRegionalFieldValue(field: string, value: unknown) {
    if (field === 'availability') {
      return normalizeFoodAvailability(value);
    }

    if (
      field === 'confidence' ||
      field === 'seasonalityConfidence' ||
      field === 'priceMin' ||
      field === 'priceMax'
    ) {
      const num = Number(value);
      if (Number.isNaN(num)) return undefined;
      if (field === 'confidence' || field === 'seasonalityConfidence') {
        return Math.max(0, Math.min(1, num));
      }
      return Math.max(0, Math.round(num * 100) / 100);
    }

    if (field === 'localPopularity') {
      const num = Number(value);
      if (Number.isNaN(num)) return undefined;
      return Math.max(0, Math.min(100, Math.round(num)));
    }

    if (field === 'currencyCode' && typeof value === 'string') {
      const normalized = value.trim().toUpperCase();
      return /^[A-Z]{3}$/.test(normalized) ? normalized : undefined;
    }

    if (field === 'priceUnit' && typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return ['per_kg', 'per_serving', 'per_piece'].includes(normalized)
        ? normalized
        : undefined;
    }

    if (field === 'monthWeights' && Array.isArray(value)) {
      if (value.length !== 12) return undefined;
      const weights = value.map(Number);
      if (weights.some((item) => Number.isNaN(item) || item < 0 || item > 1)) {
        return undefined;
      }
      return weights.map((item) => Math.round(item * 100) / 100);
    }

    return value;
  }

  /**
   * 回退单条补全记录：
   * 1. 根据 change_log 中记录的 enrichedFields 列表，把对应字段重置为 null
   * 2. 清理 provenance success 中对应条目
   * 3. 重算 data_completeness / enrichment_status
   * 4. 写入一条 ai_enrichment_rollback 日志
   * 5. 将原 change_log 标记为 ai_enrichment_rolled_back
   */
  async rollbackEnrichment(
    logId: string,
    operator = 'admin',
  ): Promise<{ rolledBack: boolean; detail: string }> {
    const log = await this.prisma.foodChangeLogs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`日志 ${logId} 不存在`);

    // 仅允许回退"已入库"和"已审核通过"的记录
    if (
      log.action !== 'ai_enrichment' &&
      log.action !== 'ai_enrichment_approved'
    ) {
      throw new Error(
        `日志 ${logId} 的操作类型为 ${log.action}，无法回退（仅支持 ai_enrichment / ai_enrichment_approved）`,
      );
    }

    const changes = log.changes as Record<string, any>;
    const target = changes.target ?? 'foods';

    if (target === 'food_translations') {
      return this.rollbackTranslationEnrichment(log, changes, operator);
    }

    if (target === 'food_regional_info') {
      return this.rollbackRegionalEnrichment(log, changes, operator);
    }

    // 从 change_log 中提取当时补全的字段列表
    const enrichedFields: string[] = changes.enrichedFields ?? [];
    if (enrichedFields.length === 0) {
      // 如果是 approved 记录，可能字段在 proposedValues 里
      const proposed = changes.proposedValues ?? {};
      const {
        confidence: _confidence,
        reasoning: _reasoning,
        fieldConfidence: _fieldConfidence,
        ...fields
      } = proposed;
      enrichedFields.push(
        ...Object.keys(fields).filter((k) => fields[k] != null),
      );
    }

    if (enrichedFields.length === 0) {
      return { rolledBack: false, detail: '该记录无可回退的字段' };
    }

    const food = await this.prisma.food.findUnique({
      where: { id: log.foodId },
    });
    if (!food) throw new Error(`食物 ${log.foodId} 不存在`);

    // 构建回退 updates：将补全的字段设为 null
    const rollbackUpdates: Record<string, any> = {};
    const rollbackUpdatesCamel: Record<string, any> = {};
    for (const field of enrichedFields) {
      rollbackUpdates[field] = null; // snake_case，用于 mergedFood 完整度计算
      const camelField = snakeToCamel(field);
      rollbackUpdatesCamel[camelField] =
        NON_NULLABLE_MAIN_TABLE_ROLLBACK_DEFAULTS[camelField] ?? null; // camelCase，用于 Prisma update
    }

    // 重算完整度
    const mergedFood = { ...food, ...rollbackUpdatesCamel };
    const existingSuccessMap = await this.getSuccessSourcePresence(
      log.foodId,
      enrichedFields,
    );
    for (const field of enrichedFields) {
      delete existingSuccessMap[field];
    }
    const completeness = this.computeCompletenessScore(
      mergedFood,
      existingSuccessMap,
    );
    const enrichmentStatus =
      completeness.score >= COMPLETENESS_COMPLETE_THRESHOLD
        ? 'completed'
        : completeness.score >= COMPLETENESS_PARTIAL_THRESHOLD
          ? 'partial'
          : 'pending';

    const newVersion = (food.dataVersion || 1) + 1;

    await this.prisma.$transaction(async (tx) => {
      // 重置字段值，只将主表字段传入 food.update
      const mainRollbackUpdates = Object.fromEntries(
        Object.entries(rollbackUpdatesCamel).filter(
          ([k]) => !SPLIT_TABLE_FIELDS.has(k),
        ),
      );
      await tx.food.update({
        where: { id: log.foodId },
        data: {
          ...mainRollbackUpdates,
          dataVersion: newVersion,
          dataCompleteness: completeness.score,
          enrichmentStatus: enrichmentStatus,
          lastEnrichedAt: food.lastEnrichedAt, // 保持不变
        },
      });

      // 同步回退拆分表（将拆分表字段置 null）
      await upsertFoodSplitTables(tx, log.foodId, rollbackUpdatesCamel);

      // 将原日志标记为已回退（保留审计痕迹，不删除）
      await tx.foodChangeLogs.update({
        where: { id: logId },
        data: { action: 'ai_enrichment_rolled_back' },
      });

      // 写入回退操作的审计日志
      await tx.foodChangeLogs.create({
        data: {
          foodId: log.foodId,
          version: newVersion,
          action: 'ai_enrichment_rollback',
          changes: {
            rolledBackLogId: logId,
            rolledBackFields: enrichedFields,
            completenessAfter: completeness.score,
          },
          reason: `回退 ${enrichedFields.length} 个 AI 补全字段`,
          operator,
        },
      });
    });

    for (const field of enrichedFields) {
      await this.provenanceRepo.clearSuccessesForField(log.foodId, field);
      await this.provenanceRepo.clearFailuresForField(log.foodId, field);
    }

    const detail = `已回退 ${enrichedFields.length} 个字段: [${enrichedFields.join(', ')}]，完整度 ${completeness.score}%`;
    this.logger.log(
      `Rollback enrichment "${food.name}" logId=${logId}: ${detail}`,
    );

    return { rolledBack: true, detail };
  }

  /**
   * 批量回退补全记录
   */
  async batchRollbackEnrichment(
    logIds: string[],
    operator = 'admin',
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const logId of logIds) {
      try {
        await this.rollbackEnrichment(logId, operator);
        success++;
      } catch (e) {
        failed++;
        errors.push(`${logId}: ${(e as Error).message}`);
      }
    }

    return { success, failed, errors };
  }
}
