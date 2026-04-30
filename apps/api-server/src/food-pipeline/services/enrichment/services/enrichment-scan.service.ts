/**
 * EnrichmentScanService
 *
 * 负责扫描缺失字段统计和查询需要补全的食物列表。
 * 拆分自 food-enrichment.service.ts。
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  ENRICHABLE_FIELDS,
  type EnrichableField,
  JSON_ARRAY_FIELDS,
  AI_OVERRIDABLE_FIELDS,
} from '../constants/enrichable-fields';
import { type MissingFieldStats } from '../constants/enrichment.types';
import {
  buildMissingFieldSqlCondition,
  getFoodSplitFromSql,
  getFieldSqlRef,
  getFieldSelectSql,
} from '../helpers/enrichment-sql.helper';
import { parseFoodRegionScope } from '../../../../common/utils/food-regional-info.util';
import { localesToFoodRegions } from '../../../../common/utils/locale-region.util';

@Injectable()
export class EnrichmentScanService {
  constructor(private readonly prisma: PrismaService) {}

  async scanMissingFields(): Promise<MissingFieldStats> {
    const total = await this.prisma.food.count();

    // V8.0: 字段名来自 ENRICHABLE_FIELDS 常量白名单，使用 Prisma.raw 安全构建
    const selectParts = ENRICHABLE_FIELDS.map(
      (field) =>
        `COUNT(*) FILTER (WHERE ${buildMissingFieldSqlCondition(field)})::text AS "${field}"`,
    );

    const result = await this.prisma.$queryRaw<Record<string, string>[]>(
      Prisma.sql`SELECT ${Prisma.raw(selectParts.join(', '))} ${Prisma.raw(getFoodSplitFromSql())}`,
    );

    const fieldCounts: Record<string, number> = {};
    if (result[0]) {
      for (const field of ENRICHABLE_FIELDS) {
        fieldCounts[field] = parseInt(result[0][field] ?? '0', 10);
      }
    }

    // 翻译缺失：没有任何翻译记录的食物数
    const translationsResult = await this.prisma.$queryRaw<[{ count: string }]>(
      Prisma.sql`SELECT COUNT(*)::text AS count FROM foods f
       WHERE NOT EXISTS (SELECT 1 FROM food_translations ft WHERE ft.food_id = f.id)`,
    );
    const translationsMissing = parseInt(
      translationsResult[0]?.count ?? '0',
      10,
    );

    // 地区信息缺失：没有任何 regional_info 的食物数
    const regionalResult = await this.prisma.$queryRaw<[{ count: string }]>(
      Prisma.sql`SELECT COUNT(*)::text AS count FROM foods f
       WHERE NOT EXISTS (SELECT 1 FROM food_regional_info fri WHERE fri.food_id = f.id)`,
    );
    const regionalMissing = parseInt(regionalResult[0]?.count ?? '0', 10);

    return {
      total,
      fields: fieldCounts as Record<EnrichableField, number>,
      translationsMissing,
      regionalMissing,
    };
  }

  async getFoodsNeedingEnrichment(
    fields: EnrichableField[],
    limit = 50,
    offset = 0,
    /** V8.0: 仅选取完整度 <= maxCompleteness 的食物 */
    maxCompleteness?: number,
    /** V8.1: 按分类筛选 */
    category?: string,
    /** V8.1: 按数据来源筛选 */
    primarySource?: string,
  ): Promise<{ id: string; name: string; missingFields: EnrichableField[] }[]> {
    if (fields.length === 0) return [];

    // 字段名来自 ENRICHABLE_FIELDS/阶段字段白名单，使用 Prisma.raw 安全构建。
    const nullConditions = fields
      .map((f) => buildMissingFieldSqlCondition(f))
      .join(' OR ');

    // 对允许 AI 覆盖的默认值字段，改用 provenance success 作为"是否真实补全"的依据。
    const overridableFields = fields.filter((f) =>
      AI_OVERRIDABLE_FIELDS.includes(f),
    );
    const overridableCondition =
      overridableFields.length > 0
        ? ' OR ' +
          overridableFields
            .map(
              (f) =>
                `(${getFieldSqlRef(f)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM food_field_provenance p WHERE p.food_id = foods.id AND p.field_name = '${f}' AND p.status = 'success' AND p.source IN ('ai_enrichment', 'ai_enrichment_now', 'ai_enrichment_worker', 'batch_enrichment', 'manual', 'rule_inferred')))`,
            )
            .join(' OR ')
        : '';

    // V8.0: 可选完整度上限筛选
    const completenessCondition =
      maxCompleteness !== undefined && maxCompleteness !== null
        ? ` AND (data_completeness IS NULL OR data_completeness <= ${Number(maxCompleteness)})`
        : '';

    // V8.7 FIX: 排除已完整补全（enriched/completed）、部分补全（partial）和待审核（staged）的食物，避免重复入队
    // 实际写入值: applyEnrichment 写 'completed'/'partial', enrichFoodNow staged 写 'staged'
    // 旧版部分食物可能残留 'enriched' 状态，一并排除
    const statusExcludeCondition = ` AND (enrichment_status IS NULL OR enrichment_status NOT IN ('enriched', 'completed', 'staged'))`;

    // V8.2: 同时选取请求字段的实际值，用于计算 per-food 真正缺失字段
    const fieldSelectParts = fields.map((f) => getFieldSelectSql(f)).join(', ');

    // V8.8: 优先入队完全未补全（data_completeness IS NULL）的食物，其次按完整度升序
    //       同完整度时按 created_at ASC（最老的优先），确保没补全过的食物最先被处理
    //       overridableCondition 扩展了 WHERE 条件，使 food_form 有默认值的食物也能进入队列
    const rows = await this.prisma.$queryRaw<Record<string, any>[]>(
      Prisma.sql`SELECT foods.id, foods.name, ${Prisma.raw(fieldSelectParts)} ${Prisma.raw(getFoodSplitFromSql())} WHERE (${Prisma.raw(nullConditions + overridableCondition)})${Prisma.raw(completenessCondition)}${Prisma.raw(statusExcludeCondition)}${category ? Prisma.sql` AND foods.category = ${category}` : Prisma.empty}${primarySource ? Prisma.sql` AND foods.primary_source = ${primarySource}` : Prisma.empty} ORDER BY foods.data_completeness ASC NULLS FIRST, foods.created_at ASC LIMIT ${limit} OFFSET ${offset}`,
    );

    // V8.2: 计算每个食物实际缺失的字段（而非返回全部请求字段）
    // V8.8: AI_OVERRIDABLE_FIELDS 中的字段，即使有值也视为"需要补全"（AI 可纠正）
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      missingFields: fields.filter((f) => {
        const value = row[f];
        if (value === null || value === undefined) return true;
        if (
          (JSON_ARRAY_FIELDS as readonly string[]).includes(f) &&
          Array.isArray(value) &&
          value.length === 0
        )
          return true;
        // V8.8: overridable 字段始终加入 missingFields，确保 AI 有机会纠正默认值
        if (AI_OVERRIDABLE_FIELDS.includes(f)) return true;
        return false;
      }),
    }));
  }

  /**
   * 查询缺少翻译或地区信息的食物列表
   * 使用 Prisma 参数化查询，消除原 controller 中的 SQL 注入风险
   */
  async getFoodsNeedingRelatedEnrichment(
    target: 'translations' | 'regional',
    limit: number,
    offset: number,
    locales?: string[],
    region?: string | string[],
  ): Promise<{ id: string; name: string; missingFields: EnrichableField[] }[]> {
    let rows: { id: string; name: string }[];

    // V8.8: 优先未补全（data_completeness IS NULL）的食物，其次按完整度升序
    if (target === 'translations') {
      const targetLocales = (locales ?? []).filter(Boolean);
      if (targetLocales.length > 0) {
        const localeConditions = Prisma.join(
          targetLocales.map(
            (targetLocale) => Prisma.sql`NOT EXISTS (
              SELECT 1 FROM food_translations ft WHERE ft.food_id = foods.id AND ft.locale = ${targetLocale}
            )`,
          ),
          ' OR ',
        );
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE (${localeConditions})
          ORDER BY data_completeness ASC NULLS FIRST, created_at ASC LIMIT ${limit} OFFSET ${offset}`,
        );
      } else {
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE NOT EXISTS (
            SELECT 1 FROM food_translations ft WHERE ft.food_id = foods.id
          ) ORDER BY data_completeness ASC NULLS FIRST, created_at ASC LIMIT ${limit} OFFSET ${offset}`,
        );
      }
    } else {
      const regions = [
        ...new Set(
          (Array.isArray(region) ? region : region ? [region] : [])
            .concat(localesToFoodRegions(locales))
            .filter(Boolean),
        ),
      ];
      if (regions.length > 0) {
        const missingRegionConditions = Prisma.join(
          regions.map((targetRegion) => {
            const scope = parseFoodRegionScope(targetRegion);
            return Prisma.sql`NOT EXISTS (
              SELECT 1 FROM food_regional_info fri
              WHERE fri.food_id = foods.id
                AND fri.country_code = ${scope.countryCode}
                AND fri.region_code IS NOT DISTINCT FROM ${scope.regionCode}
                AND fri.city_code IS NOT DISTINCT FROM ${scope.cityCode}
            )`;
          }),
          ' OR ',
        );
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE (${missingRegionConditions})
          ORDER BY data_completeness ASC NULLS FIRST, created_at ASC LIMIT ${limit} OFFSET ${offset}`,
        );
      } else {
        rows = await this.prisma.$queryRaw<{ id: string; name: string }[]>(
          Prisma.sql`SELECT id, name FROM foods WHERE NOT EXISTS (
            SELECT 1 FROM food_regional_info fri WHERE fri.food_id = foods.id
          ) ORDER BY data_completeness ASC NULLS FIRST, created_at ASC LIMIT ${limit} OFFSET ${offset}`,
        );
      }
    }

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      missingFields: [],
    }));
  }
}
