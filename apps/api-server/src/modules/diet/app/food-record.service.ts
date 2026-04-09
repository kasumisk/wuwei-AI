import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { FoodRecord, MealType } from '../entities/food-record.entity';
import {
  SaveFoodRecordDto,
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
} from './food.dto';

@Injectable()
export class FoodRecordService {
  private readonly logger = new Logger(FoodRecordService.name);

  constructor(
    @InjectRepository(FoodRecord)
    private readonly foodRepo: Repository<FoodRecord>,
  ) {}

  /**
   * 保存饮食记录
   */
  async saveRecord(
    userId: string,
    dto: SaveFoodRecordDto,
  ): Promise<FoodRecord> {
    const record = this.foodRepo.create({
      userId,
      imageUrl: dto.imageUrl,
      foods: dto.foods,
      totalCalories: dto.totalCalories,
      mealType: (dto.mealType as MealType) || MealType.LUNCH,
      advice: dto.advice,
      isHealthy: dto.isHealthy,
      recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      // V1: 决策字段
      decision: dto.decision || 'SAFE',
      riskLevel: dto.riskLevel,
      reason: dto.reason,
      suggestion: dto.suggestion,
      insteadOptions: dto.insteadOptions || [],
      compensation: dto.compensation,
      contextComment: dto.contextComment,
      encouragement: dto.encouragement,
      // V6: 多维营养字段
      totalProtein: dto.totalProtein || 0,
      totalFat: dto.totalFat || 0,
      totalCarbs: dto.totalCarbs || 0,
      avgQuality: dto.avgQuality || 0,
      avgSatiety: dto.avgSatiety || 0,
      nutritionScore: dto.nutritionScore || 0,
    });

    return this.foodRepo.save(record);
  }

  /**
   * 获取今日记录
   */
  async getTodayRecords(userId: string): Promise<FoodRecord[]> {
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    return this.foodRepo.find({
      where: {
        userId,
        recordedAt: Between(startOfDay, endOfDay),
      },
      order: { recordedAt: 'DESC' },
    });
  }

  /**
   * 分页查询历史记录
   */
  async getRecords(
    userId: string,
    query: FoodRecordQueryDto,
  ): Promise<{
    items: FoodRecord[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const qb = this.foodRepo
      .createQueryBuilder('r')
      .where('r.user_id = :userId', { userId });

    if (query.date) {
      qb.andWhere('DATE(r.recorded_at) = :date', { date: query.date });
    }

    qb.orderBy('r.recorded_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  /**
   * 更新记录
   */
  async updateRecord(
    userId: string,
    recordId: string,
    dto: UpdateFoodRecordDto,
  ): Promise<FoodRecord> {
    const record = await this.foodRepo.findOne({ where: { id: recordId } });
    if (!record) throw new NotFoundException('记录不存在');
    if (record.userId !== userId) throw new ForbiddenException('无权操作');

    if (dto.foods !== undefined) record.foods = dto.foods;
    if (dto.totalCalories !== undefined)
      record.totalCalories = dto.totalCalories;
    if (dto.mealType !== undefined) record.mealType = dto.mealType as MealType;
    if (dto.advice !== undefined) record.advice = dto.advice;
    if (dto.isHealthy !== undefined) record.isHealthy = dto.isHealthy;

    return this.foodRepo.save(record);
  }

  /**
   * 删除记录
   */
  async deleteRecord(userId: string, recordId: string): Promise<void> {
    const record = await this.foodRepo.findOne({ where: { id: recordId } });
    if (!record) throw new NotFoundException('记录不存在');
    if (record.userId !== userId) throw new ForbiddenException('无权操作');

    await this.foodRepo.remove(record);
  }

  /**
   * 获取指定日期的记录（内部方法，供 DailySummaryService 调用）
   */
  async getRecordsByDateRange(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<FoodRecord[]> {
    return this.foodRepo.find({
      where: {
        userId,
        recordedAt: Between(start, end),
      },
    });
  }
}
