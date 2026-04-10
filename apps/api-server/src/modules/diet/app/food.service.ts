import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SaveFoodRecordDto,
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
} from './food.dto';
import { NutritionScoreService } from './nutrition-score.service';
import { UserProfileService } from '../../user/app/user-profile.service';
import {
  RecommendationEngineService,
  WhyNotResult,
} from './recommendation-engine.service';
import { FoodRecordService } from './food-record.service';
import { DailySummaryService } from './daily-summary.service';
import {
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../common/utils/timezone.util';
import {
  MEAL_RATIOS,
  UserProfileConstraints,
} from './recommendation/recommendation.types';
import {
  DomainEvents,
  MealRecordedEvent,
  RecommendationGeneratedEvent,
} from '../../../core/events/domain-events';
import { PrecomputeService } from './precompute.service';

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);

  constructor(
    private readonly foodRecordService: FoodRecordService,
    private readonly dailySummaryService: DailySummaryService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly userProfileService: UserProfileService,
    private readonly recommendationEngine: RecommendationEngineService,
    private readonly eventEmitter: EventEmitter2,
    private readonly precomputeService: PrecomputeService,
  ) {}

  /**
   * 保存饮食记录（委托 + 异步更新汇总）
   */
  async saveRecord(userId: string, dto: SaveFoodRecordDto): Promise<any> {
    const saved = await this.foodRecordService.saveRecord(userId, dto);

    // 异步更新每日汇总
    this.dailySummaryService
      .updateDailySummary(userId, saved.recorded_at)
      .catch((err) => this.logger.error(`更新每日汇总失败: ${err.message}`));

    // V6 Phase 1.2: 发布饮食记录事件
    this.eventEmitter.emit(
      DomainEvents.MEAL_RECORDED,
      new MealRecordedEvent(
        userId,
        dto.mealType || 'unknown',
        dto.foods?.map((f) => f.name).filter(Boolean) || [],
        dto.totalCalories || 0,
        'manual',
        saved.id,
      ),
    );

    return saved;
  }

  /**
   * 获取今日记录
   */
  async getTodayRecords(userId: string): Promise<any[]> {
    const tz = await this.userProfileService.getTimezone(userId);
    return this.foodRecordService.getTodayRecords(userId, tz);
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
    return this.foodRecordService.getRecords(userId, query);
  }

  /**
   * 更新记录
   */
  async updateRecord(
    userId: string,
    recordId: string,
    dto: UpdateFoodRecordDto,
  ): Promise<any> {
    const record = await this.foodRecordService.updateRecord(
      userId,
      recordId,
      dto,
    );

    // 异步更新每日汇总
    this.dailySummaryService
      .updateDailySummary(userId, record.recorded_at)
      .catch((err) => this.logger.error(`更新每日汇总失败: ${err.message}`));

    return record;
  }

  /**
   * 删除记录
   * V5 1.9: 删除后异步更新 DailySummary（V4 遗漏）
   */
  async deleteRecord(userId: string, recordId: string): Promise<void> {
    const deleted = await this.foodRecordService.deleteRecord(userId, recordId);
    // 异步更新当日汇总，不阻塞删除响应
    const recordDate = (deleted.recorded_at ?? deleted.created_at) as Date;
    this.dailySummaryService
      .updateDailySummary(userId, recordDate)
      .catch((err) => {
        this.logger.warn(`删除记录后更新日汇总失败: ${(err as Error).message}`);
      });
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
  async getRecentSummaries(userId: string, days: number = 7): Promise<any[]> {
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
    const tz = profile?.timezone || DEFAULT_TIMEZONE;
    const hour = getUserLocalHour(tz);

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

    // V6 Phase 1.10: 优先查询预计算结果（延迟 < 200ms）
    const todayStr = new Date().toISOString().slice(0, 10);
    const precomputed = await this.precomputeService.getPrecomputed(
      userId,
      todayStr,
      nextMeal,
    );
    if (precomputed) {
      const { result: mainRec, scenarioResults } = precomputed;

      // 发布推荐生成事件（标记来自预计算）
      this.eventEmitter.emit(
        DomainEvents.RECOMMENDATION_GENERATED,
        new RecommendationGeneratedEvent(
          userId,
          nextMeal,
          mainRec.foods?.length ?? 0,
          0, // latencyMs ≈ 0（预计算命中）
          true, // fromPrecompute
        ),
      );

      const scenarios = scenarioResults
        ? Object.entries(scenarioResults).map(([key, rec]) => {
            const scenarioLabels: Record<string, string> = {
              takeout: '外卖',
              convenience: '便利店',
              homeCook: '在家做',
            };
            const r = rec as {
              displayText?: string;
              totalCalories?: number;
              tip?: string;
            };
            return {
              scenario: scenarioLabels[key] || key,
              foods: r.displayText || '',
              calories: r.totalCalories || 0,
              tip: r.tip || '',
            };
          })
        : undefined;

      this.logger.debug(
        `预计算命中: userId=${userId}, meal=${nextMeal}, date=${todayStr}`,
      );

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

    // 预计算未命中 → 回退到实时计算（现有逻辑不变）

    // V5 1.10: 使用统一的 MEAL_RATIOS 替代硬编码比例
    const mealRatios = MEAL_RATIOS[goalType] || MEAL_RATIOS.health;
    const ratio = mealRatios[nextMeal] || 0.25;
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
    const startTime = Date.now();
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
    const latencyMs = Date.now() - startTime;

    // V6 Phase 1.2: 发布推荐生成事件
    this.eventEmitter.emit(
      DomainEvents.RECOMMENDATION_GENERATED,
      new RecommendationGeneratedEvent(
        userId,
        nextMeal,
        mainRec.foods?.length ?? 0,
        latencyMs,
        false, // fromPrecompute — Phase 1.10 预计算实现后会根据实际情况设置
      ),
    );

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

  // ─── V6 2.8: 反向解释 API ───

  /**
   * 解释"为什么不推荐某食物"
   *
   * 与 getMealSuggestion 共享同一套目标计算逻辑，
   * 对用户指定的食物跑评分 + 过滤分析，返回不推荐原因 + 替代方案。
   *
   * @param userId    用户 ID
   * @param foodName  用户查询的食物名
   * @param mealType  餐次类型
   */
  async explainWhyNot(
    userId: string,
    foodName: string,
    mealType: string,
  ): Promise<WhyNotResult> {
    const [summary, profile] = await Promise.all([
      this.getTodaySummary(userId),
      this.userProfileService.getProfile(userId),
    ]);

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);
    const goalType = profile?.goal || 'health';

    // 计算该餐次的营养预算
    const mealRatios = MEAL_RATIOS[goalType] || MEAL_RATIOS.health;
    const ratio = mealRatios[mealType] || 0.25;
    const remaining = Math.max(
      0,
      (summary.calorieGoal || goals.calories) - summary.totalCalories,
    );
    const calBudget = Math.round(remaining * ratio);
    const proteinRem = Math.max(0, goals.protein - (summary.totalProtein || 0));

    const consumed = {
      calories: summary.totalCalories || 0,
      protein: summary.totalProtein || 0,
    };
    const dailyTarget = { calories: goals.calories, protein: goals.protein };
    const target = {
      calories: calBudget,
      protein: Math.round(proteinRem * ratio),
      fat: Math.round(goals.fat * ratio),
      carbs: Math.round(goals.carbs * ratio),
    };

    const userConstraints: UserProfileConstraints | undefined = profile
      ? {
          dietaryRestrictions: (profile.dietary_restrictions as string[]) || [],
          allergens: (profile.allergens as string[]) || [],
          healthConditions: (profile.health_conditions as string[]) || [],
          regionCode: (profile.region_code as string) || 'CN',
          timezone: profile.timezone,
        }
      : undefined;

    return this.recommendationEngine.scoreAndExplainWhyNot(
      userId,
      foodName,
      mealType,
      goalType,
      target,
      dailyTarget,
      consumed,
      userConstraints,
    );
  }
}
