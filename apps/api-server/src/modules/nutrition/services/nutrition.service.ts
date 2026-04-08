import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { FoodRecord } from '../entities/food-record.entity';
import { DailySummary } from '../entities/daily-summary.entity';
import { CreateFoodRecordDto, QueryRecordsDto } from '../dto/nutrition.dto';
import { NutritionScoringService } from './nutrition-scoring.service';
import { todayStr } from '../../../shared/utils/date.utils';

@Injectable()
export class NutritionService {
  private readonly logger = new Logger(NutritionService.name);

  constructor(
    @InjectRepository(FoodRecord)
    private recordRepo: Repository<FoodRecord>,
    @InjectRepository(DailySummary)
    private summaryRepo: Repository<DailySummary>,
    private scoringService: NutritionScoringService,
  ) {}

  async createRecord(userId: string, dto: CreateFoodRecordDto): Promise<FoodRecord> {
    const totalCalories = dto.foods.reduce((sum, f) => sum + f.calories, 0);
    const totalProtein = dto.foods.reduce((sum, f) => sum + (f.protein || 0), 0);
    const totalFat = dto.foods.reduce((sum, f) => sum + (f.fat || 0), 0);
    const totalCarbs = dto.foods.reduce((sum, f) => sum + (f.carbs || 0), 0);

    const avgQuality = dto.foods.length > 0
      ? dto.foods.reduce((sum, f) => sum + (f.quality || 5), 0) / dto.foods.length
      : 5;
    const avgSatiety = dto.foods.length > 0
      ? dto.foods.reduce((sum, f) => sum + (f.satiety || 5), 0) / dto.foods.length
      : 5;

    const record = this.recordRepo.create({
      userId,
      imageUrl: dto.imageUrl,
      source: dto.source,
      foods: dto.foods,
      totalCalories,
      mealType: dto.mealType,
      totalProtein,
      totalFat,
      totalCarbs,
      avgQuality,
      avgSatiety,
    });

    const saved = await this.recordRepo.save(record);

    // Update daily summary
    await this.updateDailySummary(userId, todayStr());

    return saved;
  }

  async getRecords(userId: string, dto: QueryRecordsDto) {
    const where: any = { userId };
    if (dto.date) where.recordedAt = Between(new Date(`${dto.date}T00:00:00`), new Date(`${dto.date}T23:59:59`));
    if (dto.mealType) where.mealType = dto.mealType;

    return this.recordRepo.find({
      where,
      order: { recordedAt: 'DESC' },
    });
  }

  async getDailySummary(userId: string, date?: string) {
    const d = date || todayStr();
    let summary = await this.summaryRepo.findOne({
      where: { userId, date: d },
    });
    if (!summary) {
      summary = this.summaryRepo.create({ userId, date: d });
    }
    return summary;
  }

  async getWeeklySummaries(userId: string) {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    return this.summaryRepo.find({
      where: {
        userId,
        date: Between(
          sevenDaysAgo.toISOString().split('T')[0],
          today.toISOString().split('T')[0],
        ) as any,
      },
      order: { date: 'ASC' },
    });
  }

  async getTodayConsumed(userId: string) {
    const records = await this.recordRepo.find({
      where: {
        userId,
        recordedAt: Between(
          new Date(`${todayStr()}T00:00:00`),
          new Date(`${todayStr()}T23:59:59`),
        ),
      },
    });

    return {
      calories: records.reduce((sum, r) => sum + r.totalCalories, 0),
      protein: records.reduce((sum, r) => sum + Number(r.totalProtein), 0),
      fat: records.reduce((sum, r) => sum + Number(r.totalFat), 0),
      carbs: records.reduce((sum, r) => sum + Number(r.totalCarbs), 0),
    };
  }

  private async updateDailySummary(userId: string, date: string): Promise<void> {
    const records = await this.recordRepo.find({
      where: {
        userId,
        recordedAt: Between(
          new Date(`${date}T00:00:00`),
          new Date(`${date}T23:59:59`),
        ),
      },
    });

    const totalCalories = records.reduce((sum, r) => sum + r.totalCalories, 0);
    const totalProtein = records.reduce((sum, r) => sum + Number(r.totalProtein), 0);
    const totalFat = records.reduce((sum, r) => sum + Number(r.totalFat), 0);
    const totalCarbs = records.reduce((sum, r) => sum + Number(r.totalCarbs), 0);
    const avgQuality = records.length > 0
      ? records.reduce((sum, r) => sum + Number(r.avgQuality), 0) / records.length
      : 0;
    const avgSatiety = records.length > 0
      ? records.reduce((sum, r) => sum + Number(r.avgSatiety), 0) / records.length
      : 0;
    const nutritionScore = records.length > 0
      ? Math.round(records.reduce((sum, r) => sum + r.nutritionScore, 0) / records.length)
      : 0;

    await this.summaryRepo.upsert(
      {
        userId,
        date,
        totalCalories,
        mealCount: records.length,
        totalProtein,
        totalFat,
        totalCarbs,
        avgQuality,
        avgSatiety,
        nutritionScore,
      },
      ['userId', 'date'],
    );
  }
}
