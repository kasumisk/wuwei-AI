/**
 * EnrichmentCompletenessService
 *
 * 拆分自 food-enrichment.service.ts，负责数据完整度相关的计算与统计：
 *  - computeCompletenessScore  — 单食物完整度评分（加权计算）
 *  - recalculateCompleteness   — 批量重算所有食物的 data_completeness
 *  - getCompletenessById       — 单食物完整度查询
 *  - getCompletenessDistribution — 全库完整度区间分布
 *  - getEnrichmentHistoricalStats — 历史补全统计（基于 DB，不依赖队列快照）
 *  - getEnrichmentProgress     — 全库补全进度统计
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FoodProvenanceRepository } from '../../../../modules/food/repositories';

import {
  snakeToCamel,
  JSON_ARRAY_FIELDS,
  JSON_OBJECT_FIELDS,
} from '../constants/enrichable-fields';
import {
  ENRICHMENT_STAGES,
  type StageEnrichmentResult,
} from '../constants/enrichment-stages';
import {
  COMPLETENESS_PARTIAL_THRESHOLD,
  COMPLETENESS_COMPLETE_THRESHOLD,
} from '../constants/nutrient-ranges';
import {
  type CompletenessScore,
  type EnrichmentProgress,
} from '../constants/enrichment.types';
import {
  buildPresentFieldSqlCondition,
  getFoodSplitFromSql,
} from '../helpers/enrichment-sql.helper';

/**
 * 默认值字段集合：这些字段在 foods 主表中有默认值，
 * 只有在 food_field_provenance 中存在成功记录时，才视为真实补全。
 */
export const COMPLETENESS_SOURCE_FIELDS = new Set<string>([
  'processing_level',
  'commonality_score',
  'available_channels',
]);

@Injectable()
export class EnrichmentCompletenessService {
  private readonly logger = new Logger(EnrichmentCompletenessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provenanceRepo: FoodProvenanceRepository,
  ) {}

  // ─── 内部辅助：获取 provenance 成功标记 ──────────────────────────────────

  private async getSuccessSourcePresence(
    foodId: string,
    fields: string[],
  ): Promise<Record<string, boolean>> {
    const trackedFields = fields.filter((field) =>
      COMPLETENESS_SOURCE_FIELDS.has(field),
    );
    return this.provenanceRepo.hasSuccessfulSources(foodId, trackedFields);
  }

  // ─── V7.9: 数据完整度评分 ─────────────────────────────────────────────

  /**
   * 计算单个食物的数据完整度评分
   * 加权计算：核心营养素(0.35) + 微量营养素(0.25) + 健康属性(0.15) + 使用属性(0.15) + 扩展属性(0.10)
   */
  computeCompletenessScore(
    food: any,
    successSourcePresence: Record<string, boolean> = {},
  ): CompletenessScore {
    const isFieldFilled = (field: string): boolean => {
      // Prisma 返回的 food 对象使用 camelCase 字段名，ENRICHABLE_FIELDS 是 snake_case
      const value = food[snakeToCamel(field)];
      if (value === null || value === undefined) return false;
      if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field))
        return Array.isArray(value) && value.length > 0;
      if ((JSON_OBJECT_FIELDS as readonly string[]).includes(field))
        return typeof value === 'object' && Object.keys(value).length > 0;
      // 默认值字段只有在 provenance success 存在时才视为真实补全
      if (COMPLETENESS_SOURCE_FIELDS.has(field)) {
        return Boolean(successSourcePresence[field]);
      }
      return true;
    };

    const computeGroupScore = (fields: string[]): number => {
      if (fields.length === 0) return 0;
      const filled = fields.filter(isFieldFilled).length;
      return filled / fields.length;
    };

    const coreFields = ENRICHMENT_STAGES[0].fields;
    const microFields = ENRICHMENT_STAGES[1].fields;
    const healthFields = ENRICHMENT_STAGES[2].fields;
    const usageFields = ENRICHMENT_STAGES[3].fields;
    const extendedFields = ENRICHMENT_STAGES[4].fields;

    const coreNutrients = computeGroupScore(coreFields as unknown as string[]);
    const microNutrients = computeGroupScore(
      microFields as unknown as string[],
    );
    const healthAttributes = computeGroupScore(
      healthFields as unknown as string[],
    );
    const usageAttributes = computeGroupScore(
      usageFields as unknown as string[],
    );
    const extendedAttributes = computeGroupScore(
      extendedFields as unknown as string[],
    );

    const score = Math.round(
      (coreNutrients * 0.35 +
        microNutrients * 0.25 +
        healthAttributes * 0.15 +
        usageAttributes * 0.15 +
        extendedAttributes * 0.1) *
        100,
    );

    // 找出缺失的关键字段（核心营养素中缺失的）
    const missingCritical = (coreFields as unknown as string[]).filter(
      (f) => !isFieldFilled(f),
    );

    return {
      score,
      coreNutrients: Math.round(coreNutrients * 100),
      microNutrients: Math.round(microNutrients * 100),
      healthAttributes: Math.round(healthAttributes * 100),
      usageAttributes: Math.round(usageAttributes * 100),
      extendedAttributes: Math.round(extendedAttributes * 100),
      missingCritical,
    };
  }

  // ─── V8.3: 批量重算完整度 ──────────────────────────────────────────────

  /**
   * 批量重新计算所有食物的 data_completeness 和 enrichment_status
   * 用于修复历史数据不一致（如食物已有字段但 data_completeness 仍为0或NULL）
   *
   * 分批处理（每批200条）避免内存溢出，返回处理统计
   */
  async recalculateCompleteness(batchSize = 200): Promise<{
    total: number;
    updated: number;
    errors: number;
    statusChanges: Record<string, number>;
  }> {
    const total = await this.prisma.food.count();
    let updated = 0;
    let errors = 0;
    const statusChanges: Record<string, number> = {};
    let cursor: string | undefined;

    this.logger.log(
      `[recalculateCompleteness] 开始批量重算，共 ${total} 条食物`,
    );

    while (true) {
      const foods = await this.prisma.food.findMany({
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });

      if (foods.length === 0) break;
      cursor = foods[foods.length - 1].id;

      for (const food of foods) {
        try {
          const completeness = this.computeCompletenessScore(
            food,
            await this.getSuccessSourcePresence(
              food.id,
              ENRICHMENT_STAGES.flatMap(
                (stage) => stage.fields as readonly string[],
              ),
            ),
          );
          const oldStatus = food.enrichmentStatus || 'pending';

          // 仅对非 staged/rejected/failed 的食物重新判定状态
          // staged/rejected/failed 是由审核流程或失败逻辑设置的，不应被覆盖
          let newStatus = oldStatus;
          if (!['staged', 'rejected', 'failed'].includes(oldStatus)) {
            newStatus =
              completeness.score >= COMPLETENESS_COMPLETE_THRESHOLD
                ? 'completed'
                : completeness.score >= COMPLETENESS_PARTIAL_THRESHOLD
                  ? 'partial'
                  : 'pending';
          }

          const oldCompleteness = food.dataCompleteness ?? 0;

          // 仅在值有变化时才更新，减少写入
          if (
            oldCompleteness !== completeness.score ||
            oldStatus !== newStatus
          ) {
            await this.prisma.food.update({
              where: { id: food.id },
              data: {
                dataCompleteness: completeness.score,
                enrichmentStatus: newStatus,
              },
            });
            updated++;

            if (oldStatus !== newStatus) {
              const changeKey = `${oldStatus}→${newStatus}`;
              statusChanges[changeKey] = (statusChanges[changeKey] || 0) + 1;
            }
          }
        } catch (e) {
          errors++;
          this.logger.error(
            `[recalculateCompleteness] foodId=${food.id}: ${(e as Error).message}`,
          );
        }
      }
    }

    this.logger.log(
      `[recalculateCompleteness] 完成：total=${total}, updated=${updated}, errors=${errors}`,
    );

    return { total, updated, errors, statusChanges };
  }

  // ─── V8.1: 单食物完整度查询（封装正确性修复）───────────────────────────

  /**
   * 查询单个食物的完整度评分
   * 修复原 controller 中直接访问 prisma 的封装泄漏问题
   */
  async getCompletenessById(foodId: string): Promise<
    | ({
        foodId: string;
        foodName: string;
      } & CompletenessScore)
    | null
  > {
    const food = await this.prisma.food.findUnique({
      where: { id: foodId },
    });
    if (!food) return null;

    const score = this.computeCompletenessScore(food);
    return {
      foodId: food.id,
      foodName: food.name,
      ...score,
    };
  }

  // ─── V8.2: 历史统计（基于数据库，不受队列裁剪影响）──────────────────────

  /**
   * 从 foods 表聚合历史补全统计，不依赖 BullMQ 队列快照
   * 解决 removeOnComplete/removeOnFail 导致的计数不准确问题
   */
  async getEnrichmentHistoricalStats(): Promise<{
    total: number;
    enriched: number;
    pending: number;
    failed: number;
    staged: number;
    rejected: number;
    avgCompleteness: number;
  }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ status: string; cnt: string }>
    >(
      Prisma.sql`SELECT COALESCE(enrichment_status, 'pending') AS status, COUNT(*)::text AS cnt FROM foods GROUP BY 1`,
    );

    const statusMap: Record<string, number> = {};
    for (const r of rows) {
      statusMap[r.status] = parseInt(r.cnt, 10);
    }

    const total = Object.values(statusMap).reduce((a, b) => a + b, 0);
    // V8.3: 修复状态键 — 使用 foods.enrichment_status 实际值
    // 实际值: 'pending' | 'staged' | 'completed' | 'partial' | 'failed' | 'rejected'
    const enriched =
      (statusMap['completed'] ?? 0) + (statusMap['partial'] ?? 0);
    const pending = statusMap['pending'] ?? 0;
    const failed = statusMap['failed'] ?? 0;
    const staged = statusMap['staged'] ?? 0;
    const rejected = statusMap['rejected'] ?? 0;

    const avgRow = await this.prisma.$queryRaw<[{ avg: string }]>(
      // V8.4 修复：只计算已补全（data_completeness > 0）的食物均值，
      // 排除 pending（completeness=0）食物拉低平均分
      Prisma.sql`SELECT COALESCE(AVG(data_completeness), 0)::text AS avg FROM foods WHERE data_completeness IS NOT NULL AND data_completeness > 0`,
    );
    const avgCompleteness = parseFloat(
      parseFloat(avgRow[0]?.avg ?? '0').toFixed(1),
    );

    return {
      total,
      enriched,
      pending,
      failed,
      staged,
      rejected,
      avgCompleteness,
    };
  }

  // ─── V7.9: 补全进度统计（V8.2: 修复完整度计算口径）───────────────────────

  /**
   * 获取全库补全进度统计
   * V8.2: 修复 — fullyEnriched/partiallyEnriched/notEnriched 改用 data_completeness 列
   *        修复 — avgCompleteness 改用 AVG(data_completeness) 而非阶段覆盖率均值
   */
  async getEnrichmentProgress(): Promise<EnrichmentProgress> {
    const totalFoods = await this.prisma.food.count();
    if (totalFoods === 0) {
      return {
        totalFoods: 0,
        fullyEnriched: 0,
        partiallyEnriched: 0,
        notEnriched: 0,
        avgCompleteness: 0,
        stagesCoverage: ENRICHMENT_STAGES.map((s) => ({
          stage: s.stage,
          name: s.name,
          coverageRate: 0,
        })),
      };
    }

    // V8.0: 按阶段计算覆盖率（字段名来自 ENRICHMENT_STAGES 常量白名单，Prisma.raw 安全构建）
    const stagesCoverage: EnrichmentProgress['stagesCoverage'] = [];
    for (const stage of ENRICHMENT_STAGES) {
      const conditions = stage.fields.map((f) =>
        buildPresentFieldSqlCondition(f),
      );
      const allFilledCondition = conditions.join(' AND ');
      const countResult = await this.prisma.$queryRaw<[{ count: string }]>(
        Prisma.sql`SELECT COUNT(*)::text AS count
                   ${Prisma.raw(getFoodSplitFromSql())}
                   WHERE ${Prisma.raw(allFilledCondition)}`,
      );
      const count = parseInt(countResult[0]?.count ?? '0', 10);
      stagesCoverage.push({
        stage: stage.stage,
        name: stage.name,
        coverageRate: Math.round((count / totalFoods) * 100),
      });
    }

    // V8.2: 使用 data_completeness 列计算完整度分布（与 getTaskOverview/getCompletenessDistribution 统一口径）
    // V2.1: 门槛与 COMPLETENESS_PARTIAL/COMPLETE_THRESHOLD 常量一致（30/80）
    const distResult = await this.prisma.$queryRaw<
      Array<{ completeness: string; count: string }>
    >(
      Prisma.sql`SELECT
        CASE
          WHEN COALESCE(data_completeness, 0) >= 80 THEN 'full'
          WHEN COALESCE(data_completeness, 0) >= 30 THEN 'partial'
          ELSE 'none'
        END AS completeness,
        COUNT(*)::text AS count
      FROM foods GROUP BY 1`,
    );

    let fullyEnriched = 0;
    let partiallyEnriched = 0;
    let notEnriched = 0;
    for (const row of distResult) {
      const c = parseInt(row.count, 10);
      if (row.completeness === 'full') fullyEnriched = c;
      else if (row.completeness === 'partial') partiallyEnriched = c;
      else notEnriched = c;
    }

    // V8.2: avgCompleteness 使用 AVG(data_completeness) 而非阶段覆盖率均值
    // V8.4 修复：只计算已补全（data_completeness > 0）的食物均值
    const avgRow = await this.prisma.$queryRaw<[{ avg: string }]>(
      Prisma.sql`SELECT COALESCE(AVG(data_completeness), 0)::text AS avg FROM foods WHERE data_completeness IS NOT NULL AND data_completeness > 0`,
    );
    const avgCompleteness = Math.round(parseFloat(avgRow[0]?.avg ?? '0'));

    // V8.3: 按 enrichment_status 分布（与 getEnrichmentHistoricalStats 一致）
    const statusRows = await this.prisma.$queryRaw<
      Array<{ status: string; cnt: string }>
    >(
      Prisma.sql`SELECT COALESCE(enrichment_status, 'pending') AS status, COUNT(*)::text AS cnt FROM foods GROUP BY 1`,
    );
    const byStatus: Record<string, number> = {};
    for (const r of statusRows) {
      byStatus[r.status] = parseInt(r.cnt, 10);
    }

    return {
      totalFoods,
      fullyEnriched,
      partiallyEnriched,
      notEnriched,
      avgCompleteness,
      stagesCoverage,
      byStatus,
    };
  }

  // ─── V8.0: 全库完整度分布统计 ──────────────────────────────────────────

  /**
   * 按完整度区间（0-20/20-40/40-60/60-80/80-100）统计食物数量
   * 使用持久化的 data_completeness 字段（0-100），NULL 视为 0
   */
  async getCompletenessDistribution(): Promise<{
    total: number;
    distribution: { range: string; min: number; max: number; count: number }[];
    avgCompleteness: number;
  }> {
    const total = await this.prisma.food.count();
    if (total === 0) {
      return {
        total: 0,
        distribution: [
          { range: '0-20', min: 0, max: 20, count: 0 },
          { range: '20-40', min: 20, max: 40, count: 0 },
          { range: '40-60', min: 40, max: 60, count: 0 },
          { range: '60-80', min: 60, max: 80, count: 0 },
          { range: '80-100', min: 80, max: 100, count: 0 },
        ],
        avgCompleteness: 0,
      };
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ bucket: string; cnt: string }>
    >(
      Prisma.sql`SELECT
        CASE
          WHEN COALESCE(data_completeness, 0) < 20 THEN '0-20'
          WHEN COALESCE(data_completeness, 0) < 40 THEN '20-40'
          WHEN COALESCE(data_completeness, 0) < 60 THEN '40-60'
          WHEN COALESCE(data_completeness, 0) < 80 THEN '60-80'
          ELSE '80-100'
        END AS bucket,
        COUNT(*)::text AS cnt
      FROM foods
      GROUP BY 1
      ORDER BY 1`,
    );

    const avgRow = await this.prisma.$queryRaw<[{ avg: string }]>(
      // V8.4 修复：只计算已补全（data_completeness > 0）的食物均值
      Prisma.sql`SELECT COALESCE(AVG(data_completeness), 0)::text AS avg FROM foods WHERE data_completeness IS NOT NULL AND data_completeness > 0`,
    );

    const bucketMap: Record<string, number> = {};
    for (const r of rows) {
      bucketMap[r.bucket] = parseInt(r.cnt, 10);
    }

    const ranges = [
      { range: '0-20', min: 0, max: 20 },
      { range: '20-40', min: 20, max: 40 },
      { range: '40-60', min: 40, max: 60 },
      { range: '60-80', min: 60, max: 80 },
      { range: '80-100', min: 80, max: 100 },
    ];

    return {
      total,
      distribution: ranges.map((r) => ({
        ...r,
        count: bucketMap[r.range] ?? 0,
      })),
      avgCompleteness: parseFloat(parseFloat(avgRow[0]?.avg ?? '0').toFixed(1)),
    };
  }
}
