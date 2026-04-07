import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
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
import { NutritionScoreService } from './nutrition-score.service';
import { UserProfileService } from './user-profile.service';
import { RecommendationEngineService } from './recommendation-engine.service';

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);

  constructor(
    @InjectRepository(FoodRecord)
    private readonly foodRepo: Repository<FoodRecord>,
    @InjectRepository(DailySummary)
    private readonly summaryRepo: Repository<DailySummary>,
    private readonly nutritionScoreService: NutritionScoreService,
    @Inject(forwardRef(() => UserProfileService))
    private readonly userProfileService: UserProfileService,
    private readonly recommendationEngine: RecommendationEngineService,
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
  ): Promise<{
    totalCalories: number;
    calorieGoal: number | null;
    mealCount: number;
    remaining: number;
    totalProtein: number;
    totalFat: number;
    totalCarbs: number;
    avgQuality: number;
    avgSatiety: number;
    nutritionScore: number;
    proteinGoal: number;
    fatGoal: number;
    carbsGoal: number;
  }> {
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
        totalProtein: records.reduce((s, r) => s + (Number(r.totalProtein) || 0), 0),
        totalFat: records.reduce((s, r) => s + (Number(r.totalFat) || 0), 0),
        totalCarbs: records.reduce((s, r) => s + (Number(r.totalCarbs) || 0), 0),
        avgQuality: 0,
        avgSatiety: 0,
        nutritionScore: 0,
        proteinGoal: 0,
        fatGoal: 0,
        carbsGoal: 0,
      };
    }

    return {
      totalCalories: summary.totalCalories,
      calorieGoal: summary.calorieGoal ?? null,
      mealCount: summary.mealCount,
      remaining: summary.calorieGoal
        ? Math.max(0, summary.calorieGoal - summary.totalCalories)
        : 0,
      totalProtein: Number(summary.totalProtein) || 0,
      totalFat: Number(summary.totalFat) || 0,
      totalCarbs: Number(summary.totalCarbs) || 0,
      avgQuality: Number(summary.avgQuality) || 0,
      avgSatiety: Number(summary.avgSatiety) || 0,
      nutritionScore: Number(summary.nutritionScore) || 0,
      proteinGoal: Number(summary.proteinGoal) || 0,
      fatGoal: Number(summary.fatGoal) || 0,
      carbsGoal: Number(summary.carbsGoal) || 0,
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

  // ─── V2: 下一餐推荐（食物库 + 推荐引擎） ───

  /**
   * 获取下一餐推荐（基于食物库的多维评分推荐 + 场景化建议）
   */
  async getMealSuggestion(
    userId: string,
  ): Promise<{
    mealType: string;
    remainingCalories: number;
    suggestion: { foods: string; calories: number; tip: string };
    scenarios?: Array<{ scenario: string; foods: string; calories: number; tip: string }>;
  }> {
    const [summary, profile] = await Promise.all([
      this.getTodaySummary(userId),
      this.userProfileService.getProfile(userId),
    ]);
    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const goalType = profile?.goal || 'health';
    const goal = summary.calorieGoal || goals.calories;
    const remaining = Math.max(0, goal - summary.totalCalories);
    const hour = new Date().getHours();

    let nextMeal: string;
    if (hour < 9) nextMeal = 'breakfast';
    else if (hour < 14) nextMeal = 'lunch';
    else if (hour < 17) nextMeal = 'snack';
    else nextMeal = 'dinner';

    if (remaining <= 0) {
      return {
        mealType: nextMeal,
        remainingCalories: 0,
        suggestion: { foods: '今日热量已达标', calories: 0, tip: '建议不再进食，喝水或零卡饮品' },
      };
    }

    // 计算预算比例
    const ratios: Record<string, number> = { breakfast: 0.30, lunch: 0.40, dinner: 0.30, snack: 0.15 };
    const ratio = ratios[nextMeal] || 0.30;
    const calBudget = Math.round(remaining * ratio);
    const proteinRem = Math.max(0, goals.protein - (summary.totalProtein || 0));

    const consumed = { calories: summary.totalCalories || 0, protein: summary.totalProtein || 0 };
    const dailyTarget = { calories: goals.calories, protein: goals.protein };
    const budget = {
      calories: calBudget,
      protein: Math.round(proteinRem * ratio),
      fat: Math.round(goals.fat * ratio),
      carbs: Math.round(goals.carbs * ratio),
    };

    // 并行获取：通用推荐 + 场景化推荐
    const [mainRec, scenarioRecs] = await Promise.all([
      this.recommendationEngine.recommendMeal(userId, nextMeal, goalType, consumed, budget, dailyTarget),
      this.recommendationEngine.recommendByScenario(userId, nextMeal, goalType, consumed, budget, dailyTarget),
    ]);

    const scenarios = Object.entries(scenarioRecs).map(([key, rec]) => {
      const scenarioLabels: Record<string, string> = { takeout: '外卖', convenience: '便利店', homeCook: '在家做' };
      return {
        scenario: scenarioLabels[key] || key,
        foods: rec.displayText,
        calories: rec.totalCalories,
        tip: rec.tip,
      };
    });

    return {
      mealType: nextMeal,
      remainingCalories: remaining,
      suggestion: { foods: mainRec.displayText, calories: mainRec.totalCalories, tip: mainRec.tip },
      scenarios,
    };
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

    // V6: 多维汇总
    const totalProtein = records.reduce((s, r) => s + (Number(r.totalProtein) || 0), 0);
    const totalFat = records.reduce((s, r) => s + (Number(r.totalFat) || 0), 0);
    const totalCarbs = records.reduce((s, r) => s + (Number(r.totalCarbs) || 0), 0);

    // 加权平均质量分和饱腹分（按热量权重）
    const totalCal = totalCalories || 1;
    const avgQuality = records.reduce(
      (s, r) => s + (Number(r.avgQuality) || 0) * r.totalCalories, 0,
    ) / totalCal;
    const avgSatiety = records.reduce(
      (s, r) => s + (Number(r.avgSatiety) || 0) * r.totalCalories, 0,
    ) / totalCal;

    // 营养目标（从用户档案计算）
    let profile: any = null;
    let goals = { calories: 2000, protein: 0, fat: 0, carbs: 0, quality: 7, satiety: 6 };
    try {
      profile = await this.userProfileService.getProfile(userId);
      goals = this.nutritionScoreService.calculateDailyGoals(profile);
    } catch { /* ignore */ }

    // 综合评分
    const goalType = profile?.goal || 'health';
    const scoreResult = this.nutritionScoreService.calculateScore(
      {
        calories: totalCalories,
        targetCalories: goals.calories,
        protein: totalProtein,
        fat: totalFat,
        carbs: totalCarbs,
        foodQuality: avgQuality,
        satiety: avgSatiety,
      },
      goalType,
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

    // V6: 更新多维字段
    summary.totalProtein = totalProtein;
    summary.totalFat = totalFat;
    summary.totalCarbs = totalCarbs;
    summary.avgQuality = Math.round(avgQuality * 10) / 10;
    summary.avgSatiety = Math.round(avgSatiety * 10) / 10;
    summary.nutritionScore = scoreResult.score;
    summary.proteinGoal = goals.protein;
    summary.fatGoal = goals.fat;
    summary.carbsGoal = goals.carbs;
    summary.calorieGoal = goals.calories;

    await this.summaryRepo.save(summary);
  }
}
