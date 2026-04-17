import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { MealType } from '../../diet.types';
import {
  SaveFoodRecordDto,
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
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
   * 保存饮食记录
   */
  async saveRecord(userId: string, dto: SaveFoodRecordDto) {
    return this.prisma.foodRecords.create({
      data: {
        userId: userId,
        imageUrl: dto.imageUrl,
        foods: dto.foods as any,
        totalCalories: dto.totalCalories,
        mealType: ((dto.mealType as string) || 'lunch') as any,
        advice: dto.advice,
        isHealthy: dto.isHealthy,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
        // V1: 决策字段
        decision: dto.decision || 'SAFE',
        riskLevel: dto.riskLevel,
        reason: dto.reason,
        suggestion: dto.suggestion,
        insteadOptions: dto.insteadOptions || [],
        compensation: dto.compensation as any,
        contextComment: dto.contextComment,
        encouragement: dto.encouragement,
        // V6: 多维营养字段
        totalProtein: dto.totalProtein || 0,
        totalFat: dto.totalFat || 0,
        totalCarbs: dto.totalCarbs || 0,
        avgQuality: dto.avgQuality || 0,
        avgSatiety: dto.avgSatiety || 0,
        nutritionScore: dto.nutritionScore || 0,
        // V6.1: 分析关联
        ...(dto.analysisId ? { analysisId: dto.analysisId } : {}),
        ...(dto.source ? { source: dto.source as any } : {}),
      },
    });
  }

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
}
