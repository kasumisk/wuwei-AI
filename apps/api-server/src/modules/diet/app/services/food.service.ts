import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SaveFoodRecordDto,
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
} from '../dto/food.dto';
import { NutritionScoreService } from './nutrition-score.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import {
  RecommendationEngineService,
  WhyNotResult,
} from './recommendation-engine.service';
import { FoodRecordService } from './food-record.service';
import { DailySummaryService } from './daily-summary.service';
import {
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../../common/utils/timezone.util';
import {
  MEAL_RATIOS,
  UserProfileConstraints,
} from '../recommendation/types/recommendation.types';
import {
  DomainEvents,
  MealRecordedEvent,
  RecommendationGeneratedEvent,
} from '../../../../core/events/domain-events';
import { PrecomputeService } from './precompute.service';
import { t } from '../recommendation/utils/i18n-messages';
import type { DecisionValueTag } from '../recommendation/types/meal.types';

// ─── V7.9 Phase 3-1: 推荐粘性缓存配置 ───

/** 粘性缓存 TTL（毫秒），同一用户+餐次在此时间内返回相同推荐 */
const STICKINESS_CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟
/** 粘性缓存最大条目数（防止内存泄漏） */
const STICKINESS_CACHE_MAX_SIZE = 500;

/** 粘性缓存条目 */
interface StickinessCacheEntry {
  /** 缓存键 */
  key: string;
  /** 缓存结果 */
  result: {
    mealType: string;
    remainingCalories: number;
    suggestion: { foods: string; calories: number; tip: string };
    decisionValueTags?: DecisionValueTag[];
    scenarios?: Array<{
      scenario: string;
      foods: string;
      calories: number;
      tip: string;
    }>;
  };
  /** 写入时间戳 */
  createdAt: number;
  /** 用户当时的已摄入热量（用于判断是否失效） */
  consumedCalories: number;
}

@Injectable()
export class FoodService {
  private readonly logger = new Logger(FoodService.name);

  // ─── V7.9 Phase 3-1: 推荐粘性缓存（内存 Map） ───
  private readonly stickinessCache = new Map<string, StickinessCacheEntry>();

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
      .updateDailySummary(userId, saved.recordedAt)
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
      .updateDailySummary(userId, record.recordedAt)
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
    const recordDate = deleted.recordedAt ?? deleted.createdAt;
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
   *
   * V7.9 Phase 3-1: 粘性缓存 — 同一用户+餐次在5分钟内返回相同推荐
   * V7.9 Phase 3-5: 决策价值标签 — 返回结构化的营养合规/达标提示
   * FIX: 支持 forceRefresh=true 强制跳过粘性缓存（对应前端 ?refresh=1）
   */
  async getMealSuggestion(
    userId: string,
    forceRefresh = false,
  ): Promise<{
    mealType: string;
    remainingCalories: number;
    suggestion: { foods: string; calories: number; tip: string };
    decisionValueTags?: DecisionValueTag[];
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
          foods: t('food.suggestion.caloriesReached'),
          calories: 0,
          tip: t('food.suggestion.noMoreFood'),
        },
      };
    }

    // ─── V7.9 Phase 3-1: 粘性缓存检查 ───
    const cacheKey = this.buildStickinessCacheKey(userId, nextMeal);
    if (!forceRefresh) {
      const cached = this.getFromStickinessCache(
        cacheKey,
        summary.totalCalories || 0,
      );
      if (cached) {
        this.logger.debug(`粘性缓存命中: userId=${userId}, meal=${nextMeal}`);
        return cached;
      }
    } else {
      // 强制刷新时删除旧缓存条目
      this.stickinessCache.delete(cacheKey);
      this.logger.debug(`粘性缓存强制失效: userId=${userId}, meal=${nextMeal}`);
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
              takeout: t('scenario.takeout'),
              convenience: t('scenario.convenience'),
              homeCook: t('scenario.homeCook'),
            };
            const r = rec as {
              displayText?: string;
              totalCalories?: number;
              tip?: string;
            };
            const scenarioCalories = r.totalCalories || 0;
            // #fix R3-04: 场景推荐热量低于单餐推荐热量50%时追加热量偏低提示
            // 预计算路径下 budget 变量不可用，从 mainRec.totalCalories 估算单餐基准
            // 注意：meal-assembler 可能已在 r.tip 中添加了 caloriesUnder，避免重复追加
            const scenarioMealBudget = mainRec.totalCalories || 0;
            let scenarioTip = r.tip || '';
            if (
              scenarioMealBudget > 0 &&
              scenarioCalories > 0 &&
              scenarioCalories < scenarioMealBudget * 0.5
            ) {
              const underTip = t('tip.caloriesUnder');
              if (!scenarioTip.includes(underTip)) {
                scenarioTip = scenarioTip
                  ? `${scenarioTip}；${underTip}`
                  : underTip;
              }
            }
            return {
              scenario: scenarioLabels[key] || key,
              foods: r.displayText || '',
              calories: scenarioCalories,
              tip: scenarioTip,
            };
          })
        : undefined;

      this.logger.debug(
        `预计算命中: userId=${userId}, meal=${nextMeal}, date=${todayStr}`,
      );

      // V7.9 P3-5: 生成决策价值标签
      const decisionValueTags = this.generateDecisionValueTags(
        mainRec.totalCalories,
        mainRec.totalProtein,
        mainRec.totalFat,
        mainRec.totalCarbs,
        remaining,
        goals,
        summary,
        goalType,
      );

      const result = {
        mealType: nextMeal,
        remainingCalories: remaining,
        suggestion: {
          foods: mainRec.displayText,
          calories: mainRec.totalCalories,
          tip: mainRec.tip,
        },
        decisionValueTags,
        scenarios,
      };

      // V7.9 P3-1: 写入粘性缓存
      this.setToStickinessCache(cacheKey, result, summary.totalCalories || 0);

      return result;
    }

    // 预计算未命中 → 回退到实时计算（现有逻辑不变）

    // V5 1.10: 使用统一的 MEAL_RATIOS 替代硬编码比例
    // FIX: 用全天目标热量 × 餐次比例计算单餐预算，而非剩余热量 × 比例（后者在已摄入多时会严重低估预算）
    const mealRatios = MEAL_RATIOS[goalType] || MEAL_RATIOS.health;
    const ratio = mealRatios[nextMeal] || 0.25;
    const calBudget = Math.min(
      Math.round(goals.calories * ratio),
      remaining, // 预算不超过剩余量（防止热量超标）
    );
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

    // S4 fix: 构建 userConstraints 传入推荐引擎，确保过敏原/忌口/健康状况被过滤
    const userConstraints: UserProfileConstraints | undefined = profile
      ? {
          dietaryRestrictions: (profile.dietaryRestrictions as string[]) || [],
          allergens: (profile.allergens as string[]) || [],
          healthConditions: (profile.healthConditions as string[]) || [],
          regionCode: (profile.regionCode as string) || 'CN',
          timezone: profile.timezone,
          // V6.2 3.4: 声明画像新字段接入推荐
          cookingSkillLevel: profile.cookingSkillLevel as string | undefined,
          budgetLevel: profile.budgetLevel as string | undefined,
          cuisinePreferences:
            (profile.cuisinePreferences as string[]) || undefined,
        }
      : undefined;

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
        userConstraints,
      ),
      this.recommendationEngine.recommendByScenario(
        userId,
        nextMeal,
        goalType,
        consumed,
        budget,
        dailyTarget,
        userConstraints,
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
        takeout: t('scenario.takeout'),
        convenience: t('scenario.convenience'),
        homeCook: t('scenario.homeCook'),
      };
      const scenarioCalories = rec.totalCalories || 0;
      // #fix R3-04: 场景推荐热量低于单餐预算50%时追加热量偏低提示
      // 用 budget.calories 作为本餐预算基准
      // 注意：meal-assembler 可能已在 rec.tip 中添加了 caloriesUnder，避免重复追加
      let scenarioTip = rec.tip || '';
      if (
        budget.calories > 0 &&
        scenarioCalories > 0 &&
        scenarioCalories < budget.calories * 0.5
      ) {
        const underTip = t('tip.caloriesUnder');
        if (!scenarioTip.includes(underTip)) {
          scenarioTip = scenarioTip ? `${scenarioTip}；${underTip}` : underTip;
        }
      }
      return {
        scenario: scenarioLabels[key] || key,
        foods: rec.displayText,
        calories: scenarioCalories,
        tip: scenarioTip,
      };
    });

    // V7.9 P3-5: 生成决策价值标签
    const decisionValueTags = this.generateDecisionValueTags(
      mainRec.totalCalories,
      mainRec.totalProtein,
      mainRec.totalFat,
      mainRec.totalCarbs,
      remaining,
      goals,
      summary,
      goalType,
    );

    const result = {
      mealType: nextMeal,
      remainingCalories: remaining,
      suggestion: {
        foods: mainRec.displayText,
        calories: mainRec.totalCalories,
        tip: mainRec.tip,
      },
      decisionValueTags,
      scenarios,
    };

    // V7.9 P3-1: 写入粘性缓存
    this.setToStickinessCache(cacheKey, result, summary.totalCalories || 0);

    return result;
  }

  // ─── V7.9 Phase 3-1: 粘性缓存工具方法 ───

  /**
   * 构建粘性缓存键
   *
   * 格式：userId:mealType:日期
   * 同一用户、同一餐次、同一天只缓存一个推荐结果。
   */
  private buildStickinessCacheKey(userId: string, mealType: string): string {
    const dateStr = new Date().toISOString().slice(0, 10);
    return `${userId}:${mealType}:${dateStr}`;
  }

  /**
   * 从粘性缓存读取
   *
   * 失效条件：
   * 1. 超过 TTL（5分钟）
   * 2. 用户已摄入热量变化（说明记录了新饮食，推荐应更新）
   */
  private getFromStickinessCache(
    key: string,
    currentConsumedCalories: number,
  ): StickinessCacheEntry['result'] | null {
    const entry = this.stickinessCache.get(key);
    if (!entry) return null;

    const now = Date.now();
    // 条件1: TTL 过期
    if (now - entry.createdAt > STICKINESS_CACHE_TTL_MS) {
      this.stickinessCache.delete(key);
      return null;
    }
    // 条件2: 已摄入热量变化（用户记录了新饮食）
    if (Math.abs(currentConsumedCalories - entry.consumedCalories) > 10) {
      this.stickinessCache.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * 写入粘性缓存（含容量淘汰）
   */
  private setToStickinessCache(
    key: string,
    result: StickinessCacheEntry['result'],
    consumedCalories: number,
  ): void {
    // 容量淘汰：超过上限时清理最旧的一半
    if (this.stickinessCache.size >= STICKINESS_CACHE_MAX_SIZE) {
      const entries = Array.from(this.stickinessCache.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      );
      const deleteCount = Math.floor(STICKINESS_CACHE_MAX_SIZE / 2);
      for (let i = 0; i < deleteCount; i++) {
        this.stickinessCache.delete(entries[i][0]);
      }
    }

    this.stickinessCache.set(key, {
      key,
      result,
      createdAt: Date.now(),
      consumedCalories,
    });
  }

  /**
   * 手动失效下一餐推荐粘性缓存
   * - 指定 mealType 时仅删除该餐
   * - 未指定时删除今日全部餐次缓存
   */
  invalidateMealSuggestionCache(userId: string, mealType?: string): void {
    const dateStr = new Date().toISOString().slice(0, 10);
    if (mealType) {
      this.stickinessCache.delete(`${userId}:${mealType}:${dateStr}`);
      return;
    }

    for (const mt of ['breakfast', 'lunch', 'snack', 'dinner']) {
      this.stickinessCache.delete(`${userId}:${mt}:${dateStr}`);
    }
  }

  // ─── V7.9 Phase 3-5: 决策价值标签生成 ───

  /**
   * 生成决策价值标签
   *
   * 基于本餐推荐的营养素与目标的对比，生成结构化标签：
   * - compliance: 合规提示（如"热量在预算内"）
   * - achievement: 达标提示（如"蛋白质达标"）
   * - warning: 警告提示（如"碳水偏高"）
   * - bonus: 额外价值（如"今日热量合规率高"）
   *
   * @param mealCalories 本餐推荐热量
   * @param mealProtein 本餐推荐蛋白质
   * @param mealFat 本餐推荐脂肪
   * @param mealCarbs 本餐推荐碳水
   * @param remainingCalories 今日剩余热量
   * @param goals 每日营养目标
   * @param summary 今日汇总
   * @param goalType 目标类型
   */
  private generateDecisionValueTags(
    mealCalories: number,
    mealProtein: number,
    mealFat: number,
    mealCarbs: number,
    remainingCalories: number,
    goals: { calories: number; protein: number; fat: number; carbs: number },
    summary: {
      totalCalories?: number;
      totalProtein?: number;
      totalFat?: number;
      totalCarbs?: number;
    },
    goalType: string,
  ): DecisionValueTag[] {
    const tags: DecisionValueTag[] = [];

    // 1. 热量合规检查
    if (mealCalories <= remainingCalories * 1.05) {
      tags.push({
        type: 'compliance',
        label: '热量在预算内',
        dimension: 'calories',
        value: mealCalories,
        target: remainingCalories,
      });
    } else {
      tags.push({
        type: 'warning',
        label: '热量略超预算',
        dimension: 'calories',
        value: mealCalories,
        target: remainingCalories,
      });
    }

    // 2. 蛋白质达标检查（按目标比例）
    const consumedProtein = summary.totalProtein || 0;
    const proteinAfterMeal = consumedProtein + mealProtein;
    const proteinRatio = proteinAfterMeal / goals.protein;
    if (proteinRatio >= 0.9) {
      tags.push({
        type: 'achievement',
        label: '蛋白质充足',
        dimension: 'protein',
        value: Math.round(proteinRatio * 100),
        target: 100,
      });
    }

    // 3. 脂肪/碳水累计进度（与每日评分口径对齐）
    const consumedFat = summary.totalFat || 0;
    const consumedCarbs = summary.totalCarbs || 0;

    if (goals.fat > 0) {
      const fatRatio = (consumedFat + mealFat) / goals.fat;
      if (fatRatio > 1.15) {
        tags.push({
          type: 'warning',
          label: '脂肪累计偏高',
          dimension: 'fat',
          value: Math.round(fatRatio * 100),
          target: 100,
        });
      } else {
        tags.push({
          type: 'compliance',
          label: '脂肪累计进度正常',
          dimension: 'fat',
          value: Math.round(fatRatio * 100),
          target: 100,
        });
      }
    }

    if (goals.carbs > 0) {
      const carbsRatio = (consumedCarbs + mealCarbs) / goals.carbs;
      if (carbsRatio > 1.2) {
        tags.push({
          type: 'warning',
          label: '碳水累计偏高',
          dimension: 'carbs',
          value: Math.round(carbsRatio * 100),
          target: 100,
        });
      } else if (carbsRatio < 0.6) {
        tags.push({
          type: 'warning',
          label: '碳水累计偏低',
          dimension: 'carbs',
          value: Math.round(carbsRatio * 100),
          target: 100,
        });
      } else {
        tags.push({
          type: 'compliance',
          label: '碳水累计进度正常',
          dimension: 'carbs',
          value: Math.round(carbsRatio * 100),
          target: 100,
        });
      }
    }

    // 4. 今日整体合规率
    const consumedCalories = summary.totalCalories || 0;
    const caloriesAfterMeal = consumedCalories + mealCalories;
    const dailyComplianceRate = Math.min(caloriesAfterMeal / goals.calories, 1);
    if (dailyComplianceRate >= 0.7 && dailyComplianceRate <= 1.05) {
      tags.push({
        type: 'bonus',
        label: '今日热量进度正常',
        dimension: 'daily_compliance',
        value: Math.round(dailyComplianceRate * 100),
        target: 100,
      });
    }

    // 5. 目标特定标签
    // FIX: 使用正确的 GoalType 枚举值（'fat_loss' 和 'muscle_gain'，非旧值 'lose_weight'/'gain_muscle'）
    if (goalType === 'fat_loss' && mealCalories < remainingCalories * 0.8) {
      tags.push({
        type: 'bonus',
        label: '有利于减脂目标',
        dimension: 'goal',
      });
    } else if (goalType === 'muscle_gain' && mealProtein >= 25) {
      tags.push({
        type: 'achievement',
        label: '高蛋白餐，助力增肌',
        dimension: 'goal',
        value: mealProtein,
      });
    }

    return tags;
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
    // FIX: 用全天目标热量 × 餐次比例，不超过剩余量
    const calBudget = Math.min(Math.round(goals.calories * ratio), remaining);
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
          dietaryRestrictions: (profile.dietaryRestrictions as string[]) || [],
          allergens: (profile.allergens as string[]) || [],
          healthConditions: (profile.healthConditions as string[]) || [],
          regionCode: (profile.regionCode as string) || 'CN',
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
