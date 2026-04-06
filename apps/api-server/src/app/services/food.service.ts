import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { FoodRecord, MealType } from '../../entities/food-record.entity';
import { DailySummary } from '../../entities/daily-summary.entity';
import {
  SaveFoodRecordDto,
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
} from '../dto/food.dto';

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);

  constructor(
    @InjectRepository(FoodRecord)
    private readonly foodRepo: Repository<FoodRecord>,
    @InjectRepository(DailySummary)
    private readonly summaryRepo: Repository<DailySummary>,
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
    });

    const saved = await this.foodRepo.save(record);

    // 异步更新每日汇总
    this.updateDailySummary(userId, saved.recordedAt).catch((err) =>
      this.logger.error(`更新每日汇总失败: ${err.message}`),
    );

    return saved;
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
  ): Promise<{ items: FoodRecord[]; total: number; page: number; limit: number }> {
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
    if (dto.totalCalories !== undefined) record.totalCalories = dto.totalCalories;
    if (dto.mealType !== undefined) record.mealType = dto.mealType as MealType;
    if (dto.advice !== undefined) record.advice = dto.advice;
    if (dto.isHealthy !== undefined) record.isHealthy = dto.isHealthy;

    const saved = await this.foodRepo.save(record);

    this.updateDailySummary(userId, record.recordedAt).catch((err) =>
      this.logger.error(`更新每日汇总失败: ${err.message}`),
    );

    return saved;
  }

  /**
   * 删除记录
   */
  async deleteRecord(userId: string, recordId: string): Promise<void> {
    const record = await this.foodRepo.findOne({ where: { id: recordId } });
    if (!record) throw new NotFoundException('记录不存在');
    if (record.userId !== userId) throw new ForbiddenException('无权操作');

    await this.foodRepo.remove(record);

    this.updateDailySummary(userId, record.recordedAt).catch((err) =>
      this.logger.error(`更新每日汇总失败: ${err.message}`),
    );
  }

  /**
   * 获取今日汇总
   */
  async getTodaySummary(
    userId: string,
  ): Promise<{ totalCalories: number; calorieGoal: number | null; mealCount: number; remaining: number }> {
    const today = new Date().toISOString().split('T')[0];
    let summary = await this.summaryRepo.findOne({
      where: { userId, date: today },
    });

    if (!summary) {
      // 实时计算
      const records = await this.getTodayRecords(userId);
      const totalCalories = records.reduce(
        (sum, r) => sum + r.totalCalories,
        0,
      );
      return {
        totalCalories,
        calorieGoal: null,
        mealCount: records.length,
        remaining: 0,
      };
    }

    return {
      totalCalories: summary.totalCalories,
      calorieGoal: summary.calorieGoal ?? null,
      mealCount: summary.mealCount,
      remaining: summary.calorieGoal
        ? Math.max(0, summary.calorieGoal - summary.totalCalories)
        : 0,
    };
  }

  /**
   * 获取最近 N 天的汇总数据（趋势图用）
   */
  async getRecentSummaries(
    userId: string,
    days: number = 7,
  ): Promise<DailySummary[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceDate = since.toISOString().split('T')[0];

    return this.summaryRepo
      .createQueryBuilder('s')
      .where('s.user_id = :userId', { userId })
      .andWhere('s.date >= :sinceDate', { sinceDate })
      .orderBy('s.date', 'ASC')
      .getMany();
  }

  /**
   * 更新某天的每日汇总
   */
  private async updateDailySummary(
    userId: string,
    recordDate: Date,
  ): Promise<void> {
    const date = recordDate.toISOString().split('T')[0];
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    const records = await this.foodRepo.find({
      where: {
        userId,
        recordedAt: Between(startOfDay, endOfDay),
      },
    });

    const totalCalories = records.reduce(
      (sum, r) => sum + r.totalCalories,
      0,
    );

    let summary = await this.summaryRepo.findOne({
      where: { userId, date },
    });

    if (summary) {
      summary.totalCalories = totalCalories;
      summary.mealCount = records.length;
    } else {
      summary = this.summaryRepo.create({
        userId,
        date,
        totalCalories,
        mealCount: records.length,
      });
    }

    await this.summaryRepo.save(summary);
  }
}
