/**
 * V6.6 Food Enrichment Service
 *
 * 使用 DeepSeek AI 对 foods 及其关联表中缺失字段进行补全。
 *
 * ── 核心约束 ──
 *  1. 只补全 null / undefined / 空数组 字段，不覆盖已有数据
 *  2. 支持 staging 模式：AI 结果先写入 food_change_logs (action=ai_enrichment_staged)
 *     人工审核后通过 approveStaged / rejectStaged 决定是否落库
 *  3. 直接入库模式：AI 结果直接写入 foods（action=ai_enrichment）
 *  4. 支持关联表补全：food_translations（翻译补全）、food_regional_info（地区信息）
 *  5. 所有补全必须携带 confidence，低于阈值自动进入 staged 等待人工确认
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { PrismaService } from '../../core/prisma/prisma.service';

// ─── 可补全字段定义（foods 主表）───────────────────────────────────────────

export const ENRICHABLE_FIELDS = [
  // 营养素（per 100g）
  'protein',
  'fat',
  'carbs',
  'fiber',
  'sugar',
  'added_sugar',
  'natural_sugar',
  'sodium',
  'calcium',
  'iron',
  'potassium',
  'cholesterol',
  'vitamin_a',
  'vitamin_c',
  'vitamin_d',
  'vitamin_e',
  'vitamin_b12',
  'folate',
  'zinc',
  'magnesium',
  'saturated_fat',
  'trans_fat',
  'purine',
  'phosphorus',
  // 属性
  'sub_category',
  'food_group',
  'cuisine',
  'cooking_method',
  'glycemic_index',
  'glycemic_load',
  'fodmap_level',
  'oxalate_level',
  'processing_level',
  // JSON 数组/对象
  'meal_types',
  'allergens',
  'tags',
  'common_portions',
  // 评分
  'quality_score',
  'satiety_score',
  'nutrient_density',
  'commonality_score',
  // 描述
  'standard_serving_desc',
  'main_ingredient',
  'flavor_profile',
] as const;

export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

// 关联表补全目标
export type EnrichmentTarget = 'foods' | 'translations' | 'regional';

// ─── 营养素合理范围（per 100g）────────────────────────────────────────────

export const NUTRIENT_RANGES: Record<string, { min: number; max: number }> = {
  protein: { min: 0, max: 100 },
  fat: { min: 0, max: 100 },
  carbs: { min: 0, max: 100 },
  fiber: { min: 0, max: 80 },
  sugar: { min: 0, max: 100 },
  added_sugar: { min: 0, max: 100 },
  natural_sugar: { min: 0, max: 100 },
  sodium: { min: 0, max: 50000 },
  calcium: { min: 0, max: 2000 },
  iron: { min: 0, max: 100 },
  potassium: { min: 0, max: 10000 },
  cholesterol: { min: 0, max: 2000 },
  vitamin_a: { min: 0, max: 50000 },
  vitamin_c: { min: 0, max: 2000 },
  vitamin_d: { min: 0, max: 1000 },
  vitamin_e: { min: 0, max: 500 },
  vitamin_b12: { min: 0, max: 100 },
  folate: { min: 0, max: 5000 },
  zinc: { min: 0, max: 100 },
  magnesium: { min: 0, max: 1000 },
  saturated_fat: { min: 0, max: 100 },
  trans_fat: { min: 0, max: 10 },
  purine: { min: 0, max: 2000 },
  phosphorus: { min: 0, max: 2000 },
  glycemic_index: { min: 0, max: 100 },
  glycemic_load: { min: 0, max: 50 },
  quality_score: { min: 0, max: 10 },
  satiety_score: { min: 0, max: 10 },
  nutrient_density: { min: 0, max: 100 },
  commonality_score: { min: 0, max: 100 },
  processing_level: { min: 1, max: 4 },
};

// ─── 低置信度阈值：低于此值强制进入 staging ───────────────────────────────

const CONFIDENCE_STAGING_THRESHOLD = 0.7;

// ─── AI 补全结果结构（主表）────────────────────────────────────────────────

export interface EnrichmentResult {
  [key: string]: any;
  confidence: number;
  reasoning?: string;
}

// ─── 缺失字段统计 ─────────────────────────────────────────────────────────

export interface MissingFieldStats {
  total: number;
  fields: Record<EnrichableField, number>;
  translationsMissing: number;
  regionalMissing: number;
}

// ─── 单个补全任务 ─────────────────────────────────────────────────────────

export interface EnrichmentJobData {
  foodId: string;
  fields?: EnrichableField[];
  target?: EnrichmentTarget;
  /** 是否 staging 模式（先暂存，不直接落库）*/
  staged?: boolean;
  /** 目标语言（translations 补全时使用）*/
  locale?: string;
  /** 目标地区（regional 补全时使用）*/
  region?: string;
}

// ─── Staging 记录（从 food_change_logs 读取）──────────────────────────────

export interface StagedEnrichment {
  id: string;
  foodId: string;
  foodName?: string;
  action: string;
  changes: Record<string, any>;
  reason: string | null;
  operator: string | null;
  version: number;
  createdAt: Date;
}

@Injectable()
export class FoodEnrichmentService {
  private readonly logger = new Logger(FoodEnrichmentService.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly maxRetries = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('DEEPSEEK_API_KEY') || '';
    this.client = axios.create({
      baseURL: 'https://api.deepseek.com',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 90000,
    });
  }

  // ─── 扫描缺失字段统计 ──────────────────────────────────────────────────

  async scanMissingFields(): Promise<MissingFieldStats> {
    const total = await this.prisma.foods.count();
    const fieldCounts: Record<string, number> = {};

    for (const field of ENRICHABLE_FIELDS) {
      // JSON 数组字段：NULL 或空数组均视为缺失
      const jsonArrayFields = [
        'meal_types',
        'allergens',
        'tags',
        'common_portions',
      ];
      let sql: string;
      if (jsonArrayFields.includes(field)) {
        sql = `SELECT COUNT(*)::text AS count FROM foods WHERE ${field} IS NULL OR ${field}::text = '[]'`;
      } else if (field === 'flavor_profile') {
        sql = `SELECT COUNT(*)::text AS count FROM foods WHERE ${field} IS NULL`;
      } else {
        sql = `SELECT COUNT(*)::text AS count FROM foods WHERE ${field} IS NULL`;
      }
      const count = await this.prisma.$queryRawUnsafe<[{ count: string }]>(sql);
      fieldCounts[field] = parseInt(count[0]?.count ?? '0', 10);
    }

    // 翻译缺失：没有任何翻译记录的食物数
    const translationsResult = await this.prisma.$queryRawUnsafe<
      [{ count: string }]
    >(
      `SELECT COUNT(*)::text AS count FROM foods f
       WHERE NOT EXISTS (SELECT 1 FROM food_translations ft WHERE ft.food_id = f.id)`,
    );
    const translationsMissing = parseInt(
      translationsResult[0]?.count ?? '0',
      10,
    );

    // 地区信息缺失：没有任何 regional_info 的食物数
    const regionalResult = await this.prisma.$queryRawUnsafe<
      [{ count: string }]
    >(
      `SELECT COUNT(*)::text AS count FROM foods f
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

  // ─── 查询需要补全的食物列表 ────────────────────────────────────────────

  async getFoodsNeedingEnrichment(
    fields: EnrichableField[],
    limit = 50,
    offset = 0,
  ): Promise<{ id: string; name: string; missingFields: EnrichableField[] }[]> {
    if (fields.length === 0) return [];

    const jsonArrayFields = [
      'meal_types',
      'allergens',
      'tags',
      'common_portions',
    ];
    const nullConditions = fields
      .map((f) =>
        jsonArrayFields.includes(f)
          ? `(${f} IS NULL OR ${f}::text = '[]')`
          : `${f} IS NULL`,
      )
      .join(' OR ');

    const rows = await this.prisma.$queryRawUnsafe<
      { id: string; name: string }[]
    >(
      `SELECT id, name FROM foods WHERE ${nullConditions} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      limit,
      offset,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      missingFields: fields,
    }));
  }

  // ─── 核心：AI 补全单个食物（主表字段）────────────────────────────────

  async enrichFood(foodId: string): Promise<EnrichmentResult | null> {
    if (!this.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY not configured');
      return null;
    }

    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) {
      this.logger.warn(`Food ${foodId} not found`);
      return null;
    }

    const jsonArrayFields = [
      'meal_types',
      'allergens',
      'tags',
      'common_portions',
    ];
    const missingFields = ENRICHABLE_FIELDS.filter((field) => {
      const value = (food as any)[field];
      if (value === null || value === undefined) return true;
      if (
        jsonArrayFields.includes(field) &&
        Array.isArray(value) &&
        value.length === 0
      )
        return true;
      return false;
    });

    if (missingFields.length === 0) return null;

    this.logger.log(
      `Enriching "${food.name}": missing ${missingFields.join(', ')}`,
    );

    const prompt = this.buildEnrichmentPrompt(food, missingFields);
    return this.callAI(food.name, prompt, missingFields, 'foods');
  }

  // ─── 翻译补全（food_translations 表）─────────────────────────────────

  async enrichTranslation(
    foodId: string,
    locale: string,
  ): Promise<Record<string, any> | null> {
    if (!this.apiKey) return null;

    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) return null;

    // 检查是否已存在该语言翻译
    const existing = await this.prisma.food_translations.findFirst({
      where: { food_id: foodId, locale },
    });

    const missingTransFields: string[] = [];
    if (!existing) {
      missingTransFields.push('name', 'aliases', 'description', 'serving_desc');
    } else {
      if (!existing.name) missingTransFields.push('name');
      if (!existing.aliases) missingTransFields.push('aliases');
      if (!existing.description) missingTransFields.push('description');
      if (!existing.serving_desc) missingTransFields.push('serving_desc');
    }

    if (missingTransFields.length === 0) return null;

    const localeNames: Record<string, string> = {
      'zh-CN': '简体中文',
      'zh-TW': '繁体中文',
      'en-US': '英语',
      'ja-JP': '日语',
      'ko-KR': '韩语',
    };

    const prompt = `食物信息（中文）：
名称: ${food.name}
别名: ${food.aliases ?? '无'}
分类: ${food.category}
标准份量: ${food.standard_serving_desc ?? `${food.standard_serving_g}g`}

请将以下字段翻译成${localeNames[locale] ?? locale}（locale: ${locale}）：
${missingTransFields.map((f) => `- ${f}`).join('\n')}

返回 JSON：
{
  ${missingTransFields.map((f) => `"${f}": "<${localeNames[locale] ?? locale}内容>"`).join(',\n  ')},
  "confidence": <0.0-1.0>,
  "reasoning": "<说明>"
}`;

    return this.callAI(
      food.name,
      prompt,
      missingTransFields as any,
      'translations',
    );
  }

  // ─── 地区信息补全（food_regional_info 表）────────────────────────────

  async enrichRegional(
    foodId: string,
    region: string,
  ): Promise<Record<string, any> | null> {
    if (!this.apiKey) return null;

    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) return null;

    const existing = await this.prisma.food_regional_info.findFirst({
      where: { food_id: foodId, region },
    });

    const missingFields: string[] = [];
    if (!existing) {
      missingFields.push(
        'local_popularity',
        'local_price_range',
        'availability',
      );
    } else {
      if (!existing.local_price_range) missingFields.push('local_price_range');
      if (!existing.availability) missingFields.push('availability');
    }

    if (missingFields.length === 0) return null;

    const prompt = `食物名称: ${food.name}，地区: ${region}

请估算以下地区属性：
- local_popularity: 0-100，当地受欢迎程度
- local_price_range: cheap/medium/expensive/premium
- availability: common/seasonal/specialty/imported

返回 JSON：
{
  ${missingFields.map((f) => `"${f}": <value>`).join(',\n  ')},
  "confidence": <0.0-1.0>,
  "reasoning": "<说明>"
}`;

    return this.callAI(food.name, prompt, missingFields as any, 'regional');
  }

  // ─── 写入主表（直接模式）──────────────────────────────────────────────

  async applyEnrichment(
    foodId: string,
    result: EnrichmentResult,
    operator = 'ai_enrichment',
  ): Promise<{ updated: EnrichableField[]; skipped: EnrichableField[] }> {
    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) throw new Error(`Food ${foodId} not found`);

    const jsonArrayFields = [
      'meal_types',
      'allergens',
      'tags',
      'common_portions',
    ];
    const updates: Record<string, any> = {};
    const updated: EnrichableField[] = [];
    const skipped: EnrichableField[] = [];

    for (const field of ENRICHABLE_FIELDS) {
      const aiValue = result[field];
      if (aiValue === undefined || aiValue === null) continue;

      const existing = (food as any)[field];
      if (existing !== null && existing !== undefined) {
        if (
          jsonArrayFields.includes(field) &&
          Array.isArray(existing) &&
          existing.length > 0
        ) {
          skipped.push(field);
          continue;
        } else if (!jsonArrayFields.includes(field)) {
          skipped.push(field);
          continue;
        }
      }

      updates[field] = aiValue;
      updated.push(field);
    }

    if (Object.keys(updates).length === 0) return { updated: [], skipped };

    const newVersion = (food.data_version || 1) + 1;
    await this.prisma.foods.update({
      where: { id: foodId },
      data: {
        ...updates,
        confidence: Math.min(
          food.confidence?.toNumber() ?? 1,
          result.confidence,
        ) as any,
        data_version: newVersion,
      },
    });

    await this.prisma.food_change_logs.create({
      data: {
        food_id: foodId,
        version: newVersion,
        action: 'ai_enrichment',
        changes: {
          enrichedFields: updated,
          confidence: result.confidence,
          values: updates,
          reasoning: result.reasoning ?? null,
        },
        reason: `AI 自动补全 ${updated.length} 个字段`,
        operator,
      },
    });

    this.logger.log(
      `Applied enrichment "${food.name}": [${updated.join(', ')}]`,
    );
    return { updated, skipped };
  }

  // ─── 写入翻译关联表（直接模式）────────────────────────────────────────

  async applyTranslationEnrichment(
    foodId: string,
    locale: string,
    result: Record<string, any>,
    operator = 'ai_enrichment',
  ): Promise<{ action: 'created' | 'updated'; fields: string[] }> {
    const existing = await this.prisma.food_translations.findFirst({
      where: { food_id: foodId, locale },
    });

    const { confidence, reasoning, ...fields } = result;
    const updates: Record<string, any> = {};

    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined) continue;
      if (existing && (existing as any)[k]) continue; // 不覆盖已有
      updates[k] = v;
    }

    if (Object.keys(updates).length === 0)
      return { action: 'updated', fields: [] };

    if (!existing) {
      await this.prisma.food_translations.create({
        data: { food_id: foodId, locale, ...(updates as any) },
      });
    } else {
      await this.prisma.food_translations.update({
        where: { id: existing.id },
        data: updates as any,
      });
    }

    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (food) {
      await this.prisma.food_change_logs.create({
        data: {
          food_id: foodId,
          version: food.data_version ?? 1,
          action: 'ai_enrichment',
          changes: {
            target: 'food_translations',
            locale,
            fields: Object.keys(updates),
            values: updates,
            confidence,
            reasoning: reasoning ?? null,
          },
          reason: `AI 补全 ${locale} 翻译`,
          operator,
        },
      });
    }

    return {
      action: existing ? 'updated' : 'created',
      fields: Object.keys(updates),
    };
  }

  // ─── 写入地区信息关联表（直接模式）───────────────────────────────────

  async applyRegionalEnrichment(
    foodId: string,
    region: string,
    result: Record<string, any>,
    operator = 'ai_enrichment',
  ): Promise<{ action: 'created' | 'updated'; fields: string[] }> {
    const existing = await this.prisma.food_regional_info.findFirst({
      where: { food_id: foodId, region },
    });

    const { confidence, reasoning, ...fields } = result;
    const updates: Record<string, any> = {};

    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === undefined) continue;
      if (
        existing &&
        (existing as any)[k] !== null &&
        (existing as any)[k] !== undefined
      )
        continue;
      updates[k] = v;
    }

    if (Object.keys(updates).length === 0)
      return { action: 'updated', fields: [] };

    if (!existing) {
      await this.prisma.food_regional_info.create({
        data: { food_id: foodId, region, ...(updates as any) },
      });
    } else {
      await this.prisma.food_regional_info.update({
        where: { id: existing.id },
        data: updates as any,
      });
    }

    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (food) {
      await this.prisma.food_change_logs.create({
        data: {
          food_id: foodId,
          version: food.data_version ?? 1,
          action: 'ai_enrichment',
          changes: {
            target: 'food_regional_info',
            region,
            fields: Object.keys(updates),
            values: updates,
            confidence,
            reasoning: reasoning ?? null,
          },
          reason: `AI 补全 ${region} 地区信息`,
          operator,
        },
      });
    }

    return {
      action: existing ? 'updated' : 'created',
      fields: Object.keys(updates),
    };
  }

  // ─── Staging 模式：AI 结果写入 change_logs 待审核 ─────────────────────

  async stageEnrichment(
    foodId: string,
    result: EnrichmentResult,
    target: EnrichmentTarget = 'foods',
    locale?: string,
    region?: string,
    operator = 'ai_enrichment',
  ): Promise<string> {
    const food = await this.prisma.foods.findUnique({ where: { id: foodId } });
    if (!food) throw new Error(`Food ${foodId} not found`);

    const log = await this.prisma.food_change_logs.create({
      data: {
        food_id: foodId,
        version: food.data_version ?? 1,
        action: 'ai_enrichment_staged',
        changes: {
          target,
          locale: locale ?? null,
          region: region ?? null,
          proposedValues: result,
          confidence: result.confidence,
          reasoning: result.reasoning ?? null,
        },
        reason: `AI 暂存补全（${target}${locale ? '/' + locale : ''}${region ? '/' + region : ''}），待人工审核`,
        operator,
      },
    });

    this.logger.log(
      `Staged enrichment for "${food.name}" (${target}), logId=${log.id}, confidence=${result.confidence}`,
    );
    return log.id;
  }

  // ─── 查询 Staged 记录 ──────────────────────────────────────────────────

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
    const { page = 1, pageSize = 20, foodId, target } = params;
    const skip = (page - 1) * pageSize;

    const where: any = { action: 'ai_enrichment_staged' };
    if (foodId) where.food_id = foodId;
    if (target) where.changes = { path: ['target'], equals: target };

    const [rawList, total] = await Promise.all([
      this.prisma.food_change_logs.findMany({
        where,
        orderBy: { version: 'desc' },
        skip,
        take: pageSize,
        include: { foods: { select: { name: true } } },
      }),
      this.prisma.food_change_logs.count({ where }),
    ]);

    const list: StagedEnrichment[] = rawList.map((log) => ({
      id: log.id,
      foodId: log.food_id,
      foodName: (log as any).foods?.name ?? undefined,
      action: log.action,
      changes: log.changes as Record<string, any>,
      reason: log.reason,
      operator: log.operator,
      version: log.version,
      createdAt: log.created_at,
    }));

    return { list, total, page, pageSize };
  }

  // ─── 审核通过：将 staged 结果实际入库 ────────────────────────────────

  async approveStaged(
    logId: string,
    operator = 'admin',
  ): Promise<{ applied: boolean; detail: string }> {
    const log = await this.prisma.food_change_logs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`Staged log ${logId} not found`);
    if (log.action !== 'ai_enrichment_staged') {
      throw new Error(`Log ${logId} is not a staged enrichment`);
    }

    const changes = log.changes as Record<string, any>;
    const target: EnrichmentTarget = changes.target ?? 'foods';
    const proposed: EnrichmentResult = changes.proposedValues ?? {};

    let detail = '';

    if (target === 'foods') {
      const { updated, skipped } = await this.applyEnrichment(
        log.food_id,
        proposed,
        operator,
      );
      detail = `updated=[${updated.join(',')}], skipped=[${skipped.join(',')}]`;
    } else if (target === 'translations' && changes.locale) {
      const res = await this.applyTranslationEnrichment(
        log.food_id,
        changes.locale,
        proposed,
        operator,
      );
      detail = `${res.action} fields=[${res.fields.join(',')}]`;
    } else if (target === 'regional' && changes.region) {
      const res = await this.applyRegionalEnrichment(
        log.food_id,
        changes.region,
        proposed,
        operator,
      );
      detail = `${res.action} fields=[${res.fields.join(',')}]`;
    }

    // 将 staged log 标记为已审批
    await this.prisma.food_change_logs.update({
      where: { id: logId },
      data: {
        action: 'ai_enrichment_approved',
        reason: `人工审核通过: ${detail}`,
        operator,
      },
    });

    return { applied: true, detail };
  }

  // ─── 审核拒绝 ─────────────────────────────────────────────────────────

  async rejectStaged(
    logId: string,
    reason: string,
    operator = 'admin',
  ): Promise<void> {
    const log = await this.prisma.food_change_logs.findUnique({
      where: { id: logId },
    });
    if (!log) throw new Error(`Staged log ${logId} not found`);
    if (log.action !== 'ai_enrichment_staged') {
      throw new Error(`Log ${logId} is not a staged enrichment`);
    }

    await this.prisma.food_change_logs.update({
      where: { id: logId },
      data: {
        action: 'ai_enrichment_rejected',
        reason: `人工拒绝: ${reason}`,
        operator,
      },
    });
  }

  // ─── 批量审核通过 ─────────────────────────────────────────────────────

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

  // ─── 补全历史（审计日志）──────────────────────────────────────────────

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
    const { foodId, action, page = 1, pageSize = 20 } = params;
    const skip = (page - 1) * pageSize;

    const where: any = {
      action: {
        in: action
          ? [action]
          : [
              'ai_enrichment',
              'ai_enrichment_staged',
              'ai_enrichment_approved',
              'ai_enrichment_rejected',
            ],
      },
    };
    if (foodId) where.food_id = foodId;

    const [rawList, total] = await Promise.all([
      this.prisma.food_change_logs.findMany({
        where,
        orderBy: { version: 'desc' },
        skip,
        take: pageSize,
        include: { foods: { select: { name: true } } },
      }),
      this.prisma.food_change_logs.count({ where }),
    ]);

    const list: StagedEnrichment[] = rawList.map((log) => ({
      id: log.id,
      foodId: log.food_id,
      foodName: (log as any).foods?.name ?? undefined,
      action: log.action,
      changes: log.changes as Record<string, any>,
      reason: log.reason,
      operator: log.operator,
      version: log.version,
      createdAt: log.created_at,
    }));

    return { list, total, page, pageSize };
  }

  // ─── 辅助：统一调用 AI ────────────────────────────────────────────────

  private async callAI(
    foodName: string,
    prompt: string,
    requestedFields: readonly string[],
    target: EnrichmentTarget,
  ): Promise<EnrichmentResult | null> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post('/chat/completions', {
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                '你是权威食品营养数据库专家。根据食物名称和已有数据，推算缺失字段。严格按JSON格式返回，数值基于每100g计算，禁止自由文本。',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 1200,
        });

        const content = response.data.choices[0]?.message?.content;
        if (!content) continue;

        const raw = JSON.parse(content) as Record<string, any>;
        const validated = this.validateAndClean(raw, requestedFields, target);
        if (validated) return validated;

        this.logger.warn(
          `Attempt ${attempt} validation failed for "${foodName}"`,
        );
      } catch (e) {
        this.logger.warn(
          `Attempt ${attempt} failed for "${foodName}": ${(e as Error).message}`,
        );
        if (attempt < this.maxRetries) await this.sleep(1500 * attempt);
      }
    }

    this.logger.error(`All AI attempts failed for "${foodName}"`);
    return null;
  }

  // ─── 构造主表 Prompt ──────────────────────────────────────────────────

  private buildEnrichmentPrompt(
    food: any,
    missingFields: EnrichableField[],
  ): string {
    const ctx = [
      `名称: ${food.name}`,
      food.aliases ? `别名: ${food.aliases}` : null,
      `分类: ${food.category}`,
      food.sub_category ? `二级分类: ${food.sub_category}` : null,
      food.food_group ? `食物组: ${food.food_group}` : null,
      food.calories != null ? `热量: ${food.calories} kcal/100g` : null,
      food.protein != null ? `蛋白质: ${food.protein} g/100g` : null,
      food.fat != null ? `脂肪: ${food.fat} g/100g` : null,
      food.carbs != null ? `碳水: ${food.carbs} g/100g` : null,
      food.fiber != null ? `膳食纤维: ${food.fiber} g/100g` : null,
      food.sodium != null ? `钠: ${food.sodium} mg/100g` : null,
      food.cuisine ? `菜系: ${food.cuisine}` : null,
      food.cooking_method ? `烹饪方式: ${food.cooking_method}` : null,
      food.is_processed ? `是否加工食品: ${food.is_processed}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const FIELD_DESC: Record<string, string> = {
      protein: 'protein (g/100g, 0-100)',
      fat: 'fat (g/100g, 0-100)',
      carbs: 'carbs (g/100g, 0-100)',
      fiber: 'fiber (g/100g, 0-80)',
      sugar: 'sugar (g/100g, 0-100)',
      added_sugar: 'added_sugar (g/100g, 0-100)',
      natural_sugar: 'natural_sugar (g/100g, 0-100)',
      sodium: 'sodium (mg/100g, 0-50000)',
      calcium: 'calcium (mg/100g, 0-2000)',
      iron: 'iron (mg/100g, 0-100)',
      potassium: 'potassium (mg/100g, 0-10000)',
      cholesterol: 'cholesterol (mg/100g, 0-2000)',
      vitamin_a: 'vitamin_a (μg RAE/100g, 0-50000)',
      vitamin_c: 'vitamin_c (mg/100g, 0-2000)',
      vitamin_d: 'vitamin_d (μg/100g, 0-1000)',
      vitamin_e: 'vitamin_e (mg/100g, 0-500)',
      vitamin_b12: 'vitamin_b12 (μg/100g, 0-100)',
      folate: 'folate (μg DFE/100g, 0-5000)',
      zinc: 'zinc (mg/100g, 0-100)',
      magnesium: 'magnesium (mg/100g, 0-1000)',
      saturated_fat: 'saturated_fat (g/100g, 0-100)',
      trans_fat: 'trans_fat (g/100g, 0-10)',
      purine: 'purine (mg/100g, 0-2000)',
      phosphorus: 'phosphorus (mg/100g, 0-2000)',
      glycemic_index: 'glycemic_index 整数 0-100',
      glycemic_load: 'glycemic_load 0-50',
      fodmap_level: 'fodmap_level: low/medium/high',
      oxalate_level: 'oxalate_level: low/medium/high',
      processing_level: 'processing_level 整数 1-4 (1=自然,4=超加工)',
      sub_category: 'sub_category 英文编码如 lean_meat/whole_grain/leafy_green',
      food_group: 'food_group 英文编码如 meat/fish/grain/vegetable/fruit',
      cuisine: 'cuisine 英文编码如 chinese/western/japanese/korean',
      cooking_method:
        'cooking_method: raw/boiled/steamed/fried/roasted/grilled/stewed',
      meal_types: 'meal_types 数组，选自 breakfast/lunch/dinner/snack',
      allergens:
        'allergens 数组，选自 gluten/dairy/nuts/soy/egg/shellfish/fish/wheat',
      tags: 'tags 数组，选自 high_protein/low_fat/low_carb/high_fiber/low_calorie/low_sodium/vegan/vegetarian/gluten_free',
      common_portions:
        'common_portions JSON数组，如 [{"name":"1碗","grams":200}]',
      quality_score: 'quality_score 0-10综合品质',
      satiety_score: 'satiety_score 0-10饱腹感',
      nutrient_density: 'nutrient_density 0-100营养密度',
      commonality_score: 'commonality_score 0-100大众化程度',
      standard_serving_desc: 'standard_serving_desc 标准份量描述如"1碗(200g)"',
      main_ingredient: 'main_ingredient 主要原料如 rice/chicken',
      flavor_profile:
        'flavor_profile JSON如 {"sweet":3,"salty":5,"sour":1,"spicy":0,"bitter":1}',
    };

    const fieldsList = missingFields
      .map((f) => `- ${FIELD_DESC[f] || f}`)
      .join('\n');

    return `已知食物数据：\n${ctx}\n\n请估算以下缺失字段：\n${fieldsList}\n\n返回JSON（只含请求字段，无法确定返回null）：
{
  ${missingFields.map((f) => `"${f}": <value or null>`).join(',\n  ')},
  "confidence": <0.0-1.0>,
  "reasoning": "<简短说明>"
}`;
  }

  // ─── 验证和清理 AI 结果 ───────────────────────────────────────────────

  private validateAndClean(
    raw: Record<string, any>,
    requestedFields: readonly string[],
    target: EnrichmentTarget,
  ): EnrichmentResult | null {
    if (!raw || typeof raw !== 'object') return null;

    const result: EnrichmentResult = {
      confidence:
        typeof raw.confidence === 'number'
          ? Math.max(0, Math.min(1, raw.confidence))
          : 0.5,
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : undefined,
    };

    const jsonArrayFields = [
      'meal_types',
      'allergens',
      'tags',
      'common_portions',
    ];
    const jsonObjectFields = ['flavor_profile'];
    const stringFields = [
      'sub_category',
      'food_group',
      'cuisine',
      'cooking_method',
      'fodmap_level',
      'oxalate_level',
      'standard_serving_desc',
      'main_ingredient',
      // translation fields
      'name',
      'aliases',
      'description',
      'serving_desc',
      // regional fields
      'local_price_range',
      'availability',
    ];

    for (const field of requestedFields) {
      const value = raw[field];
      if (value === null || value === undefined) {
        result[field] = null;
        continue;
      }

      if (jsonArrayFields.includes(field)) {
        result[field] = Array.isArray(value) ? value : null;
        continue;
      }

      if (jsonObjectFields.includes(field)) {
        result[field] =
          typeof value === 'object' && !Array.isArray(value) ? value : null;
        continue;
      }

      if (stringFields.includes(field)) {
        result[field] =
          typeof value === 'string' && value.trim() ? value.trim() : null;
        continue;
      }

      // 数值
      const numValue =
        typeof value === 'string' ? parseFloat(value) : Number(value);
      if (isNaN(numValue)) {
        result[field] = null;
        continue;
      }

      const range = NUTRIENT_RANGES[field];
      if (range && (numValue < range.min || numValue > range.max)) {
        this.logger.warn(
          `"${field}" value ${numValue} out of range [${range.min},${range.max}]`,
        );
        result[field] = null;
        continue;
      }

      result[field] = numValue;
    }

    return result;
  }

  // ─── 判断是否应该 staging（低置信度自动转暂存）───────────────────────

  shouldStage(result: EnrichmentResult, forceStagedMode: boolean): boolean {
    return forceStagedMode || result.confidence < CONFIDENCE_STAGING_THRESHOLD;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
