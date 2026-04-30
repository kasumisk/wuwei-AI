/**
 * EnrichmentReEnqueueService
 *
 * 负责食物重新入队相关逻辑：
 *  - getFailedFoods         查询失败/被拒绝的食物列表
 *  - resetEnrichmentStatus  重置 enrichment_status 为 pending
 *  - getALLFoodsForReEnqueue 全库食物列表（用于强制重新补全）
 *  - clearFieldsForFoods    批量清空指定字段（入队前调用）
 *
 * 拆分自 food-enrichment.service.ts。
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FoodProvenanceRepository } from '../../../../modules/food/repositories';
import { ENRICHABLE_FIELDS, type EnrichableField } from '../constants/enrichable-fields';

@Injectable()
export class EnrichmentReEnqueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provenanceRepo: FoodProvenanceRepository,
  ) {}

  /**
   * 获取 enrichment_status 为 failed 或 rejected 的食物列表
   */
  async getFailedFoods(
    limit: number,
    foodId?: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const where: any = {
      enrichmentStatus: { in: ['failed', 'rejected'] },
    };
    if (foodId) where.id = foodId;

    return this.prisma.food.findMany({
      where,
      select: { id: true, name: true },
      take: limit,
    });
  }

  /**
   * 重置食物的 enrichment_status 为 pending（用于重新入队前）
   */
  async resetEnrichmentStatus(foodId: string): Promise<void> {
    await this.prisma.food.update({
      where: { id: foodId },
      data: { enrichmentStatus: 'pending' },
    });
  }

  /**
   * 强制将指定字段入队重新补全（忽略字段是否为 NULL，全库或按分类筛选）
   */
  async getALLFoodsForReEnqueue(
    fields: EnrichableField[],
    options: {
      limit?: number;
      category?: string;
      primarySource?: string;
    } = {},
  ): Promise<{ id: string; name: string }[]> {
    const { limit, category, primarySource } = options;

    const where: any = {};
    if (category) where.category = category;
    if (primarySource) where.primarySource = primarySource;

    return this.prisma.food.findMany({
      where,
      select: { id: true, name: true },
      ...(limit && limit > 0 ? { take: limit } : {}),
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 批量清空指定字段（入队前调用，让 AI 可以重新补全）
   * 使用分批处理（每批 200 条）避免超时
   */
  async clearFieldsForFoods(
    foodIds: string[],
    fields: EnrichableField[],
  ): Promise<{ cleared: number }> {
    const validFields = (ENRICHABLE_FIELDS as readonly string[]).filter((f) =>
      (fields as string[]).includes(f),
    ) as EnrichableField[];

    if (validFields.length === 0) return { cleared: 0 };

    // String[] 类型字段（schema 中 @default([])，不可为 null）
    const ARRAY_FIELDS_CAMEL = new Set([
      'tags',
      'ingredientList',
      'cookingMethods',
      'textureTags',
      'requiredEquipment',
    ]);

    // Int 非空字段（schema 无 `?`，不可设为 null，重置时用 0）
    const INT_NON_NULLABLE = new Set(['commonalityScore', 'popularity']);

    // Json 非空字段（schema 无 `?`，不可设为 null，清空时用空 JSON 默认值）
    const JSON_NON_NULLABLE: Record<string, unknown> = {
      mealTypes: [],
      compatibility: {},
      availableChannels: ['home_cook', 'restaurant', 'delivery', 'convenience'],
      commonPortions: [],
      flavorProfile: null,
    };

    const clearData: Record<string, unknown> = {};
    for (const f of validFields) {
      const camelKey = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (ARRAY_FIELDS_CAMEL.has(camelKey)) {
        clearData[camelKey] = [];
      } else if (INT_NON_NULLABLE.has(camelKey)) {
        clearData[camelKey] = 0;
      } else if (camelKey in JSON_NON_NULLABLE) {
        clearData[camelKey] = JSON_NON_NULLABLE[camelKey];
      } else {
        clearData[camelKey] = null;
      }
    }

    const BATCH = 200;
    let cleared = 0;
    for (let i = 0; i < foodIds.length; i += BATCH) {
      const batch = foodIds.slice(i, i + BATCH);
      await this.prisma.food.updateMany({
        where: { id: { in: batch } },
        data: { ...clearData, enrichmentStatus: 'pending' },
      });
      cleared += batch.length;
    }

    await this.provenanceRepo.clearSuccessesForFields(foodIds, validFields);

    return { cleared };
  }
}
