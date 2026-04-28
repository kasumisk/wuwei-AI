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

  /**
   * 读取既有 attempt 元信息（attempts、firstAttempt），供 enrichment
   * 失败累加场景使用。无记录返回 { attempts: 0, firstAttempt: null }。
   */
  async getAttemptInfo(params: {
    foodId: string;
    fieldName: string;
    source: string;
  }): Promise<{ attempts: number; firstAttempt: string | null }> {
    const row = await this.prisma.foodFieldProvenance.findUnique({
      where: {
        foodId_fieldName_source: {
          foodId: params.foodId,
          fieldName: params.fieldName,
          source: params.source,
        },
      },
      select: { rawValue: true, createdAt: true },
    });
    const raw = (row?.rawValue ?? null) as Record<string, unknown> | null;
    const attempts = typeof raw?.attempts === 'number' ? raw.attempts : 0;
    const firstAttempt =
      (typeof raw?.firstAttempt === 'string' ? raw.firstAttempt : null) ??
      row?.createdAt?.toISOString() ??
      null;
    return { attempts, firstAttempt };
  }

  /**
   * 累加式失败记录：自动累加 attempts、保留 firstAttempt。
   * enrichment 失败重试链专用。
   */
  async recordFailureWithAttempts(params: {
    foodId: string;
    fieldName: string;
    source: string;
    reason: string;
    extra?: Record<string, unknown>;
  }): Promise<{ attempts: number; firstAttempt: string }> {
    const { foodId, fieldName, source, reason, extra } = params;
    const prev = await this.getAttemptInfo({ foodId, fieldName, source });
    const attempts = prev.attempts + 1;
    const firstAttempt = prev.firstAttempt ?? new Date().toISOString();
    const rawValue: Record<string, unknown> = {
      lastAttempt: new Date().toISOString(),
      firstAttempt,
      attempts,
      ...(extra ?? {}),
    };
    await this.recordFailure({
      foodId,
      fieldName,
      source,
      reason,
      rawValue: rawValue as Prisma.InputJsonValue,
    });
    return { attempts, firstAttempt };
  }

  async listFailures(foodId: string) {
    return this.prisma.foodFieldProvenance.findMany({
      where: { foodId, status: 'failed' },
    });
  }

  async listSuccesses(foodId: string) {
    return this.prisma.foodFieldProvenance.findMany({
      where: { foodId, status: 'success' },
      orderBy: [{ fieldName: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async getSuccessMap(
    foodId: string,
  ): Promise<Record<string, { source: string; confidence: number | null }>> {
    const rows = await this.listSuccesses(foodId);
    const map: Record<string, { source: string; confidence: number | null }> =
      {};
    for (const row of rows) {
      map[row.fieldName] = {
        source: row.source,
        confidence: row.confidence ?? null,
      };
    }
    return map;
  }

  async hasSuccessfulSource(
    foodId: string,
    fieldName: string,
  ): Promise<boolean> {
    const row = await this.prisma.foodFieldProvenance.findFirst({
      where: { foodId, fieldName, status: 'success' },
      select: { id: true },
    });
    return Boolean(row);
  }

  async hasSuccessfulSources(
    foodId: string,
    fieldNames: string[],
  ): Promise<Record<string, boolean>> {
    if (fieldNames.length === 0) return {};
    const rows = await this.prisma.foodFieldProvenance.findMany({
      where: {
        foodId,
        status: 'success',
        fieldName: { in: fieldNames },
      },
      select: { fieldName: true },
      distinct: ['fieldName'],
    });
    const present = new Set(rows.map((row) => row.fieldName));
    return Object.fromEntries(
      fieldNames.map((fieldName) => [fieldName, present.has(fieldName)]),
    );
  }

  async clearSuccessesForField(
    foodId: string,
    fieldName: string,
  ): Promise<void> {
    await this.prisma.foodFieldProvenance.deleteMany({
      where: { foodId, fieldName, status: 'success' },
    });
  }

  async clearSuccessesForFields(
    foodIds: string[],
    fieldNames: string[],
  ): Promise<void> {
    if (foodIds.length === 0 || fieldNames.length === 0) return;
    await this.prisma.foodFieldProvenance.deleteMany({
      where: {
        foodId: { in: foodIds },
        fieldName: { in: fieldNames },
        status: 'success',
      },
    });
  }

  async listForFood(foodId: string) {
    return this.prisma.foodFieldProvenance.findMany({
      where: { foodId },
      orderBy: [{ fieldName: 'asc' }, { source: 'asc' }],
    });
  }

  async clearFailuresForField(
    foodId: string,
    fieldName: string,
  ): Promise<void> {
    await this.prisma.foodFieldProvenance.deleteMany({
      where: { foodId, fieldName, status: 'failed' },
    });
  }

  /**
   * 全库 Top-N 失败字段统计（管理后台用）
   */
  async topFailedFields(
    limit = 20,
  ): Promise<Array<{ fieldName: string; count: number }>> {
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
