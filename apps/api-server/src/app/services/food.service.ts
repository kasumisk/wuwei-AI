import { Injectable, Logger } from '@nestjs/common';
import { FoodRecord } from '../../entities/food-record.entity';
import { DailySummary } from '../../entities/daily-summary.entity';
import {
  SaveFoodRecordDto,
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
} from '../dto/food.dto';
import { NutritionScoreService } from './nutrition-score.service';
import { UserProfileService } from './user-profile.service';
import { RecommendationEngineService } from './recommendation-engine.service';
import { FoodRecordService } from './food-record.service';
import { DailySummaryService } from './daily-summary.service';

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);

  constructor(
    private readonly foodRecordService: FoodRecordService,
    private readonly dailySummaryService: DailySummaryService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly userProfileService: UserProfileService,
    private readonly recommendationEngine: RecommendationEngineService,
  ) {}

  /**
   * 保存饮食记录（委托 + 异步更新汇总）
   */
  async saveRecord(
    userId: string,
    dto: SaveFoodRecordDto,
  ): Promise<FoodRecord> {
    const saved = await this.foodRecordService.saveRecord(userId, dto);

    // 异步更新每日汇总
    this.dailySummaryService
      .updateDailySummary(userId, saved.recordedAt)
      .catch((err) => this.logger.error(`更新每日汇总失败: ${err.message}`));

    return saved;
  }

  /**
   * 获取今日记录
   */
  async getTodayRecords(userId: string): Promise<FoodRecord[]> {
    return this.foodRecordService.getTodayRecords(userId);
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
    return this.foodRecordService.getRecords(userId, query);
  }

  /**
   * 更新记录
   */
  async updateRecord(
    userId: string,
    recordId: string,
    dto: UpdateFoodRecordDto,
  ): Promise<FoodRecord> {
    const record = await this.foodRecordService.updateRecord(
      userId,
      recordId,
      dto,
    );

    // 异步更新每日汇总
    this.dailySummaryService
      .updateDailySummary(userId, record.recordedAt)
      .catch((err) => this.logger.error(`更新每日汇总失败: ${err.message}`));

    return record;
  }

  /**
   * 删除记录
   */
  async deleteRecord(userId: string, recordId: string): Promise<void> {
    await this.foodRecordService.deleteRecord(userId, recordId);
  }

  /**
   * 获取今日汇总
   */
  async getTodaySummary(userId: string) {
    return this.dailySummaryService.getTodaySummary(userId);
  }

  /**
   * 获取最近 N 天的汇总数据（趋势图用）
   */
  async getRecentSummaries(
    userId: string,
    days: number = 7,
  ): Promise<DailySummary[]> {
    return this.dailySummaryService.getRecentSummaries(userId, days);
  }

  // ─── V2: 下一餐推荐（食物库 + 推荐引擎） ───

  /**
   * 获取下一餐推荐（基于食物库的多维评分推荐 + 场景化建议）
   */
  async getMealSuggestion(userId: string): Promise<{
    mealType: string;
    remainingCalories: number;
    suggestion: { foods: string; calories: number; tip: string };
    scenarios?: Array<{
      scenario: string;
      foods: string;
      calories: number;
      tip: string;
    }>;
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
        suggestion: {
          foods: '今日热量已达标',
          calories: 0,
          tip: '建议不再进食，喝水或零卡饮品',
        },
      };
    }

    // 计算预算比例
    const ratios: Record<string, number> = {
      breakfast: 0.3,
      lunch: 0.4,
      dinner: 0.3,
      snack: 0.15,
    };
    const ratio = ratios[nextMeal] || 0.3;
    const calBudget = Math.round(remaining * ratio);
    const proteinRem = Math.max(0, goals.protein - (summary.totalProtein || 0));

    const consumed = {
      calories: summary.totalCalories || 0,
      protein: summary.totalProtein || 0,
    };
    const dailyTarget = { calories: goals.calories, protein: goals.protein };
    const budget = {
      calories: calBudget,
      protein: Math.round(proteinRem * ratio),
      fat: Math.round(goals.fat * ratio),
      carbs: Math.round(goals.carbs * ratio),
    };

    // 并行获取：通用推荐 + 场景化推荐
    const [mainRec, scenarioRecs] = await Promise.all([
      this.recommendationEngine.recommendMeal(
        userId,
        nextMeal,
        goalType,
        consumed,
        budget,
        dailyTarget,
      ),
      this.recommendationEngine.recommendByScenario(
        userId,
        nextMeal,
        goalType,
        consumed,
        budget,
        dailyTarget,
      ),
    ]);

    const scenarios = Object.entries(scenarioRecs).map(([key, rec]) => {
      const scenarioLabels: Record<string, string> = {
        takeout: '外卖',
        convenience: '便利店',
        homeCook: '在家做',
      };
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
      suggestion: {
        foods: mainRec.displayText,
        calories: mainRec.totalCalories,
        tip: mainRec.tip,
      },
      scenarios,
    };
  }
}
