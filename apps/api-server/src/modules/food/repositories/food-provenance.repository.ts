import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * V8.2 FoodFieldProvenance 仓储
 *
 * 收口字段级数据溯源（成功 / 失败 / 置信度）的读写。
 * 替换原本 foods.failed_fields jsonb / foods.field_sources jsonb 的部分读写路径。
 *
 * 唯一键：(foodId, fieldName, source)
 *
 * 写法约定：
 *   - status='success'  → 数据已写入主表 + 标注来源
 *   - status='failed'   → AI/外部源尝试补全失败，需重试或人工
 *   - status='pending'  → 占位中（极少使用）
 */
@Injectable()
export class FoodProvenanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async recordSuccess(params: {
    foodId: string;
    fieldName: string;
    source: string;
    confidence?: number;
    rawValue?: Prisma.InputJsonValue;
  }): Promise<void> {
    const { foodId, fieldName, source, confidence, rawValue } = params;
    await this.prisma.foodFieldProvenance.upsert({
      where: {
        foodId_fieldName_source: { foodId, fieldName, source },
      },
      update: {
        confidence: confidence ?? null,
        status: 'success',
        failureReason: null,
        rawValue: rawValue ?? Prisma.JsonNull,
        updatedAt: new Date(),
      },
      create: {
        foodId,
        fieldName,
        source,
        confidence: confidence ?? null,
        status: 'success',
        rawValue: rawValue ?? Prisma.JsonNull,
      },
    });
  }

  async recordFailure(params: {
    foodId: string;
    fieldName: string;
    source: string;
    reason: string;
    rawValue?: Prisma.InputJsonValue;
  }): Promise<void> {
    const { foodId, fieldName, source, reason, rawValue } = params;
    await this.prisma.foodFieldProvenance.upsert({
      where: {
        foodId_fieldName_source: { foodId, fieldName, source },
      },
      update: {
        status: 'failed',
        failureReason: reason,
        rawValue: rawValue ?? Prisma.JsonNull,
        updatedAt: new Date(),
      },
      create: {
        foodId,
        fieldName,
        source,
        status: 'failed',
        failureReason: reason,
        rawValue: rawValue ?? Prisma.JsonNull,
      },
    });
  }

  async listFailures(foodId: string) {
    return this.prisma.foodFieldProvenance.findMany({
      where: { foodId, status: 'failed' },
    });
  }

  async listForFood(foodId: string) {
    return this.prisma.foodFieldProvenance.findMany({
      where: { foodId },
      orderBy: [{ fieldName: 'asc' }, { source: 'asc' }],
    });
  }

  async clearFailuresForField(foodId: string, fieldName: string): Promise<void> {
    await this.prisma.foodFieldProvenance.deleteMany({
      where: { foodId, fieldName, status: 'failed' },
    });
  }

  /**
   * 全库 Top-N 失败字段统计（管理后台用）
   */
  async topFailedFields(limit = 20): Promise<Array<{ fieldName: string; count: number }>> {
    const rows = await this.prisma.foodFieldProvenance.groupBy({
      by: ['fieldName'],
      where: { status: 'failed' },
      _count: { fieldName: true },
      orderBy: { _count: { fieldName: 'desc' } },
      take: limit,
    });
    return rows.map((r) => ({
      fieldName: r.fieldName,
      count: r._count.fieldName,
    }));
  }
}
