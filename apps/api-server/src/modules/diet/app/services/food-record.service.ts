import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';

import {
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
  CreateFoodRecordDto,
} from '../dto/food.dto';
import {
  getUserLocalDayBounds,
  DEFAULT_TIMEZONE,
} from '../../../../common/utils/timezone.util';

@Injectable()
export class FoodRecordService {
  private readonly logger = new Logger(FoodRecordService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取今日记录
   * @param timezone IANA 时区字符串，用于确定"今天"的边界
   */
  async getTodayRecords(userId: string, timezone: string = DEFAULT_TIMEZONE) {
    const { startOfDay, endOfDay } = getUserLocalDayBounds(timezone);

    return this.prisma.foodRecords.findMany({
      where: {
        userId: userId,
        recordedAt: { gte: startOfDay, lte: endOfDay },
      },
      orderBy: { recordedAt: 'desc' },
    });
  }

  /**
   * 分页查询历史记录
   */
  async getRecords(
    userId: string,
    query: FoodRecordQueryDto,
  ): Promise<{
    items: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const where: any = { userId: userId };

    if (query.date) {
      // Filter by date: use raw SQL DATE() or construct day bounds
      const dayStart = new Date(`${query.date}T00:00:00.000Z`);
      const dayEnd = new Date(`${query.date}T23:59:59.999Z`);
      where.recordedAt = { gte: dayStart, lte: dayEnd };
    }

    const [items, total] = await Promise.all([
      this.prisma.foodRecords.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.foodRecords.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * 更新记录
   */
  async updateRecord(
    userId: string,
    recordId: string,
    dto: UpdateFoodRecordDto,
  ) {
    const record = await this.prisma.foodRecords.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundException('记录不存在');
    if (record.userId !== userId) throw new ForbiddenException('无权操作');

    const data: any = {};
    if (dto.foods !== undefined) data.foods = dto.foods;
    if (dto.totalCalories !== undefined) data.totalCalories = dto.totalCalories;
    if (dto.mealType !== undefined) data.mealType = dto.mealType as any;
    if (dto.advice !== undefined) data.advice = dto.advice;
    if (dto.isHealthy !== undefined) data.isHealthy = dto.isHealthy;

    return this.prisma.foodRecords.update({
      where: { id: recordId },
      data,
    });
  }

  /**
   * 删除记录
   */
  async deleteRecord(userId: string, recordId: string) {
    const record = await this.prisma.foodRecords.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundException('记录不存在');
    if (record.userId !== userId) throw new ForbiddenException('无权操作');

    await this.prisma.foodRecords.delete({ where: { id: recordId } });
    return record;
  }

  /**
   * 获取指定日期的记录（内部方法，供 DailySummaryService 调用）
   */
  async getRecordsByDateRange(userId: string, start: Date, end: Date) {
    return this.prisma.foodRecords.findMany({
      where: {
        userId: userId,
        recordedAt: { gte: start, lte: end },
      },
    });
  }

  // ==================== V8: Food Log 统一接口 ====================

  /**
   * V8: 统一写入 Food Log
   * 所有来源（manual/recommend/decision/...）均调用此方法。
   */
  async createRecord(userId: string, dto: CreateFoodRecordDto) {
    return this.prisma.foodRecords.create({
      data: {
        userId,
        imageUrl: dto.imageUrl,
        foods: dto.foods as any,
        totalCalories: dto.totalCalories,
        mealType: dto.mealType as string as any,
        source: dto.source as any,
        advice: dto.advice,
        isHealthy: dto.isHealthy,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        // 营养素
        totalProtein: dto.totalProtein ?? 0,
        totalFat: dto.totalFat ?? 0,
        totalCarbs: dto.totalCarbs ?? 0,
        avgQuality: dto.avgQuality ?? 0,
        avgSatiety: dto.avgSatiety ?? 0,
        nutritionScore: dto.nutritionScore ?? 0,
        // 来源追溯
        ...(dto.analysisId ? { analysisId: dto.analysisId } : {}),
        ...(dto.recommendationTraceId
          ? { recommendationTraceId: dto.recommendationTraceId }
          : {}),
        // 决策快照
        decision: dto.decision || 'SAFE',
        riskLevel: dto.riskLevel,
        reason: dto.reason,
        suggestion: dto.suggestion,
        insteadOptions: dto.insteadOptions ?? [],
        compensation: dto.compensation as any,
        contextComment: dto.contextComment,
        encouragement: dto.encouragement,
      },
    });
  }

  /**
   * V8: 按日期/日期范围+来源查询 Food Records
   *
   * 优先级：startDate+endDate > date > 默认今日
   */
  async queryRecords(
    userId: string,
    query: FoodRecordQueryDto,
    timezone: string = DEFAULT_TIMEZONE,
  ) {
    let startOfDay: Date;
    let endOfDay: Date;

    if (query.startDate && query.endDate) {
      // 日期范围查询
      startOfDay = new Date(`${query.startDate}T00:00:00.000Z`);
      endOfDay = new Date(`${query.endDate}T23:59:59.999Z`);
    } else if (query.date) {
      // 单日查询
      startOfDay = new Date(`${query.date}T00:00:00.000Z`);
      endOfDay = new Date(`${query.date}T23:59:59.999Z`);
    } else {
      // 默认今日
      const bounds = getUserLocalDayBounds(timezone);
      startOfDay = bounds.startOfDay;
      endOfDay = bounds.endOfDay;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const where: any = {
      userId,
      recordedAt: { gte: startOfDay, lte: endOfDay },
    };
    if (query.source) {
      where.source = query.source as any;
    }

    const [items, total] = await Promise.all([
      this.prisma.foodRecords.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.foodRecords.count({ where }),
    ]);

    // 汇总统计
    const summary = {
      totalCalories: items.reduce((s, r) => s + r.totalCalories, 0),
      totalProtein: items.reduce(
        (s, r) => s + (Number(r.totalProtein) || 0),
        0,
      ),
      totalFat: items.reduce((s, r) => s + (Number(r.totalFat) || 0), 0),
      totalCarbs: items.reduce((s, r) => s + (Number(r.totalCarbs) || 0), 0),
      mealCount: items.length,
    };

    return {
      items,
      total,
      page,
      limit,
      date: query.date,
      startDate: query.startDate,
      endDate: query.endDate,
      summary,
    };
  }
}
