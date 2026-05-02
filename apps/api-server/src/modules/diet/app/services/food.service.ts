import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
  CreateFoodRecordDto,
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
  MealTarget,
} from '../recommendation/types/recommendation.types';
import {
  DomainEvents,
  MealRecordedEvent,
  RecommendationGeneratedEvent,
} from '../../../../core/events/domain-events';
import { PrecomputeService } from './precompute.service';
import { t, type Locale } from '../recommendation/utils/i18n-messages';
import type { DecisionValueTag } from '../recommendation/types/meal.types';
import { RequestContextService } from '../../../../core/context/request-context.service';
import { FoodI18nService } from './food-i18n.service';

// ─── V7.9 Phase 3-1: 推荐粘性缓存配置 ───

/** 粘性缓存 TTL（毫秒），同一用户+餐次在此时间内返回相同推荐 */
const STICKINESS_CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟
/** 粘性缓存最大条目数（防止内存泄漏） */
const STICKINESS_CACHE_MAX_SIZE = 500;

interface SuggestionFoodItem {
  foodId: string;
  name: string;
  servingDesc: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  category: string;
}

interface MealSuggestionScenario {
  scenario: string;
  foods: string;
  foodItems?: SuggestionFoodItem[];
  calories: number;
  tip: string;
  totalProtein?: number;
  totalFat?: number;
  totalCarbs?: number;
}

interface MealSuggestionResponse {
  mealType: string;
  remainingCalories: number;
  suggestion: {
    foods: string;
    foodItems?: SuggestionFoodItem[];
    calories: number;
    tip: string;
    totalProtein?: number;
    totalFat?: number;
    totalCarbs?: number;
  };
  decisionValueTags?: DecisionValueTag[];
  scenarios?: MealSuggestionScenario[];
}

/** 粘性缓存条目 */
interface StickinessCacheEntry {
  /** 缓存键 */
  key: string;
  /** 缓存结果 */
  result: MealSuggestionResponse;
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
    private readonly requestCtx: RequestContextService,
    private readonly foodI18nService: FoodI18nService,
  ) {}

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
  ): Promise<MealSuggestionResponse> {
    const locale = this.getCurrentLocale();
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
    const mealRatios = MEAL_RATIOS[goalType] || MEAL_RATIOS.health;

    let nextMeal: string;
    if (hour < 9) nextMeal = 'breakfast';
    else if (hour < 14) nextMeal = 'lunch';
    else if (hour < 17) nextMeal = 'snack';
    else nextMeal = 'dinner';

    const ratio = mealRatios[nextMeal] || 0.25;
    const calBudget = Math.min(Math.round(goals.calories * ratio), remaining);
    const proteinRem = Math.max(0, goals.protein - (summary.totalProtein || 0));
    const budget = {
      calories: calBudget,
      protein: Math.round(proteinRem * ratio),
      fat: Math.round(goals.fat * ratio),
      carbs: Math.round(goals.carbs * ratio),
    };

    if (remaining <= 0) {
      return {
        mealType: nextMeal,
        remainingCalories: 0,
        suggestion: {
          foods: t('food.suggestion.caloriesReached', {}, locale),
          calories: 0,
          tip: t('food.suggestion.noMoreFood', {}, locale),
        },
      };
    }

    // ─── V7.9 Phase 3-1: 粘性缓存检查 ───
    const cacheKey = this.buildStickinessCacheKey(userId, nextMeal, locale);
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
    // 5.3 修复: getMealSuggestion 当前无 channel 入参（待接 client-context middleware）；
    //   先传 'unknown' 以命中 processor 为 unknown 存储的兜底预计算缓存。
    //   接入 X-Client-Type header 后，将 channel 透传至此并移除该注释。
    const todayStr = new Date().toISOString().slice(0, 10);
    const precomputed = await this.precomputeService.getPrecomputed(
      userId,
      todayStr,
      nextMeal,
      'unknown',
    );
    if (precomputed) {
      const { result: mainRec, scenarioResults } = precomputed;

      // 预计算结果没有经过推荐引擎的实时翻译注入，这里补注 displayName
      await this.foodI18nService.applyToMealRecommendation(
        mainRec as any,
        locale,
      );
      if (scenarioResults) {
        await Promise.all(
          Object.values(scenarioResults).map((rec) =>
            this.foodI18nService.applyToMealRecommendation(rec as any, locale),
          ),
        );
      }

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
              takeout: t('scenario.takeout', {}, locale),
              convenience: t('scenario.convenience', {}, locale),
              homeCook: t('scenario.homeCook', {}, locale),
            };
            const r = rec as {
              displayText?: string;
              totalCalories?: number;
              tip?: string;
              totalProtein?: number;
              totalFat?: number;
              totalCarbs?: number;
              foods?: Array<{
                food?: {
                  id?: string;
                  name?: string;
                  category?: string;
                  standardServingDesc?: string;
                };
                servingCalories?: number;
                servingProtein?: number;
                servingFat?: number;
                servingCarbs?: number;
              }>;
            };
            const scenarioCalories = r.totalCalories || 0;
            return {
              scenario: scenarioLabels[key] || key,
              foods: this.rebuildDisplayText(
                r.foods,
                r.displayText || '',
                locale,
              ),
              foodItems: this.toSuggestionFoodItems(r.foods),
              calories: scenarioCalories,
              tip: this.buildSuggestionTip(
                nextMeal,
                goalType,
                budget,
                scenarioCalories,
                locale,
              ),
              totalProtein: r.totalProtein,
              totalFat: r.totalFat,
              totalCarbs: r.totalCarbs,
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
        locale,
      );

      const result = {
        mealType: nextMeal,
        remainingCalories: remaining,
        suggestion: {
          foods: this.rebuildDisplayText(
            mainRec.foods,
            mainRec.displayText,
            locale,
          ),
          foodItems: this.toSuggestionFoodItems(mainRec.foods),
          calories: mainRec.totalCalories,
          tip: this.buildSuggestionTip(
            nextMeal,
            goalType,
            budget,
            Math.max(mainRec.totalCalories || 0, 0),
            locale,
          ),
          totalProtein: mainRec.totalProtein,
          totalFat: mainRec.totalFat,
          totalCarbs: mainRec.totalCarbs,
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
    const consumed = {
      calories: summary.totalCalories || 0,
      protein: summary.totalProtein || 0,
    };
    const dailyTarget: MealTarget = {
      calories: goals.calories,
      protein: goals.protein,
      fat: goals.fat,
      carbs: goals.carbs,
    };
    // S4 fix: 构建 userConstraints 传入推荐引擎，确保过敏原/忌口/健康状况被过滤
    const userConstraints: UserProfileConstraints | undefined = profile
      ? {
          dietaryRestrictions: (profile.dietaryRestrictions as string[]) || [],
          allergens: (profile.allergens as string[]) || [],
          healthConditions: (profile.healthConditions as string[]) || [],
          regionCode: (profile.regionCode as string) || 'CN',
          timezone: profile.timezone ?? undefined,
          // V6.2 3.4: 声明画像新字段接入推荐
          cookingSkillLevel: profile.cookingSkillLevel as string | undefined,
          budgetLevel: profile.budgetLevel as string | undefined,
          cuisinePreferences:
            (profile.cuisinePreferences as string[]) || undefined,
        }
      : undefined;

    // Risk-4 修复（2026-05-02）: 实时路径超时保护 + 热门榜单 fallback
    // 新用户无预计算缓存时，profileAggregator 多轮 Redis 查询 + 全量 food 池加载
    // 可能导致延迟 >3s。使用 Promise.race 设置 2500ms 超时门槛，
    // 超时后立即返回按 popularity 降序的热门榜单，避免用户长等。
    // 后台完整推荐计算继续执行并写入预计算缓存，下次请求可命中。
    /** 实时推荐超时阈值（ms） */
    const REALTIME_TIMEOUT_MS = 2500;

    /** 创建超时 Promise，resolve 为 null 表示超时 */
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), REALTIME_TIMEOUT_MS),
    );

    // 并行获取：通用推荐 + 场景化推荐
    const startTime = Date.now();
    const fullRecommendPromise = Promise.all([
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

    // Race: 完整推荐 vs 超时
    const raceResult = await Promise.race([
      fullRecommendPromise,
      timeoutPromise,
    ]);

    if (raceResult === null) {
      // ─── 超时降级：返回热门榜单 ───
      const latencyMs = Date.now() - startTime;
      this.logger.warn(
        `实时推荐超时 (>${REALTIME_TIMEOUT_MS}ms, elapsed=${latencyMs}ms), 降级到热门榜单: userId=${userId}, meal=${nextMeal}`,
      );

      // 后台继续完整推荐并触发预计算写入（fire-and-forget）
      fullRecommendPromise.catch((err) =>
        this.logger.warn(
          `后台推荐计算失败 (userId=${userId}): ${(err as Error).message}`,
        ),
      );

      const popularFoods =
        await this.recommendationEngine.getTopPopularFoods(nextMeal);
      const popularFoodText =
        popularFoods.length > 0
          ? popularFoods.map((f) => f.name).join('、')
          : t('food.suggestion.loading', {}, locale);

      this.eventEmitter.emit(
        DomainEvents.RECOMMENDATION_GENERATED,
        new RecommendationGeneratedEvent(
          userId,
          nextMeal,
          popularFoods.length,
          latencyMs,
          false,
        ),
      );

      const fallbackResult: MealSuggestionResponse = {
        mealType: nextMeal,
        remainingCalories: remaining,
        suggestion: {
          foods: popularFoodText,
          foodItems: popularFoods.map((f) => ({
            foodId: f.id,
            name: f.name,
            servingDesc: f.standardServingDesc || '1份',
            calories: f.calories ?? 0,
            protein: f.protein ?? 0,
            fat: f.fat ?? 0,
            carbs: f.carbs ?? 0,
            category: f.category || '',
          })),
          calories: popularFoods.reduce((s, f) => s + (f.calories ?? 0), 0),
          tip: t('food.suggestion.popularFallbackTip', {}, locale),
        },
      };

      this.setToStickinessCache(
        cacheKey,
        fallbackResult,
        summary.totalCalories || 0,
      );
      return fallbackResult;
    }

    // ─── 正常路径：完整推荐成功 ───
    const [mainRec, scenarioRecs] = raceResult;
    const latencyMs = Date.now() - startTime;

    // recommendByScenario 没有内置翻译注入，这里补注 displayName
    await Promise.all(
      Object.values(scenarioRecs).map((rec) =>
        this.foodI18nService.applyToMealRecommendation(rec, locale),
      ),
    );

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
        takeout: t('scenario.takeout', {}, locale),
        convenience: t('scenario.convenience', {}, locale),
        homeCook: t('scenario.homeCook', {}, locale),
      };
      const scenarioCalories = rec.totalCalories || 0;
      return {
        scenario: scenarioLabels[key] || key,
        foods: this.rebuildDisplayText(rec.foods, rec.displayText, locale),
        foodItems: this.toSuggestionFoodItems(rec.foods),
        calories: scenarioCalories,
        tip: this.buildSuggestionTip(
          nextMeal,
          goalType,
          budget,
          scenarioCalories,
          locale,
        ),
        totalProtein: rec.totalProtein,
        totalFat: rec.totalFat,
        totalCarbs: rec.totalCarbs,
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
      locale,
    );

    const result = {
      mealType: nextMeal,
      remainingCalories: remaining,
      suggestion: {
        foods: this.rebuildDisplayText(
          mainRec.foods,
          mainRec.displayText,
          locale,
        ),
        foodItems: this.toSuggestionFoodItems(mainRec.foods),
        calories: mainRec.totalCalories,
        tip: this.buildSuggestionTip(
          nextMeal,
          goalType,
          budget,
          mainRec.totalCalories,
          locale,
        ),
        totalProtein: mainRec.totalProtein,
        totalFat: mainRec.totalFat,
        totalCarbs: mainRec.totalCarbs,
      },
      decisionValueTags,
      scenarios,
    };

    // V7.9 P3-1: 写入粘性缓存
    this.setToStickinessCache(cacheKey, result, summary.totalCalories || 0);

    return result;
  }

  private toSuggestionFoodItems(
    picks?: Array<{
      food?: {
        id?: string;
        name?: string;
        displayName?: string;
        category?: string;
        standardServingDesc?: string;
        displayServingDesc?: string;
      };
      servingCalories?: number;
      servingProtein?: number;
      servingFat?: number;
      servingCarbs?: number;
    }>,
  ): SuggestionFoodItem[] | undefined {
    if (!Array.isArray(picks) || picks.length === 0) {
      return undefined;
    }

    const items = picks
      .map((pick) => ({
        foodId: pick.food?.id || '',
        name: pick.food?.displayName || pick.food?.name || '',
        servingDesc:
          pick.food?.displayServingDesc || pick.food?.standardServingDesc || '',
        calories: Math.round(Number(pick.servingCalories) || 0),
        protein: Math.round(Number(pick.servingProtein) || 0),
        fat: Math.round(Number(pick.servingFat) || 0),
        carbs: Math.round(Number(pick.servingCarbs) || 0),
        category: pick.food?.category || '',
      }))
      .filter((item) => !!item.name);

    return items.length > 0 ? items : undefined;
  }

  /**
   * 若食物已注入 displayName（多语言），用 displayName 重建 displayText。
   * 无 displayName 时返回原 displayText 不变（zh 语言 / 无翻译回退）。
   */
  private rebuildDisplayText(
    foods: Array<{ food?: any; servingCalories?: number }> | undefined,
    originalDisplayText: string,
    locale: string,
  ): string {
    if (!Array.isArray(foods) || foods.length === 0) return originalDisplayText;
    const hasTranslation = foods.some((p) => p.food?.displayName);
    if (!hasTranslation) return originalDisplayText;

    return foods
      .map((p) => {
        const name = p.food?.displayName || p.food?.name || '';
        const serving =
          p.food?.displayServingDesc ||
          p.food?.standardServingDesc ||
          `${p.food?.standardServingG || 100}g`;
        const calories = Math.round(Number(p.servingCalories) || 0);
        return t(
          'display.foodItem',
          { name, serving, calories },
          locale as any,
        );
      })
      .join(' + ');
  }

  // ─── V7.9 Phase 3-1: 粘性缓存工具方法 ───

  /**
   * 构建粘性缓存键
   *
   * 格式：userId:mealType:日期
   * 同一用户、同一餐次、同一天只缓存一个推荐结果。
   */
  private buildStickinessCacheKey(
    userId: string,
    mealType: string,
    locale: Locale,
  ): string {
    const dateStr = new Date().toISOString().slice(0, 10);
    return `${userId}:${mealType}:${locale}:${dateStr}`;
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
    const locales: Locale[] = ['zh-CN', 'en-US', 'ja-JP'];
    if (mealType) {
      for (const locale of locales) {
        this.stickinessCache.delete(
          `${userId}:${mealType}:${locale}:${dateStr}`,
        );
      }
      return;
    }

    for (const mt of ['breakfast', 'lunch', 'snack', 'dinner']) {
      for (const locale of locales) {
        this.stickinessCache.delete(`${userId}:${mt}:${locale}:${dateStr}`);
      }
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
    locale: Locale,
  ): DecisionValueTag[] {
    const tags: DecisionValueTag[] = [];

    // 1. 热量合规检查
    if (mealCalories <= remainingCalories * 1.05) {
      tags.push({
        type: 'compliance',
        label: t('response.tag.withinBudget', {}, locale),
        dimension: 'calories',
        value: mealCalories,
        target: remainingCalories,
      });
    } else {
      tags.push({
        type: 'warning',
        label: t('response.tag.slightlyOverBudget', {}, locale),
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
        label: t('response.tag.proteinAdequate', {}, locale),
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
          label: t('response.tag.fatHigh', {}, locale),
          dimension: 'fat',
          value: Math.round(fatRatio * 100),
          target: 100,
        });
      } else {
        tags.push({
          type: 'compliance',
          label: t('response.tag.fatNormal', {}, locale),
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
          label: t('response.tag.carbsHigh', {}, locale),
          dimension: 'carbs',
          value: Math.round(carbsRatio * 100),
          target: 100,
        });
      } else if (carbsRatio < 0.6) {
        tags.push({
          type: 'warning',
          label: t('response.tag.carbsLow', {}, locale),
          dimension: 'carbs',
          value: Math.round(carbsRatio * 100),
          target: 100,
        });
      } else {
        tags.push({
          type: 'compliance',
          label: t('response.tag.carbsNormal', {}, locale),
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
        label: t('response.tag.dailyProgressNormal', {}, locale),
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
        label: t('response.tag.supportsFatLoss', {}, locale),
        dimension: 'goal',
      });
    } else if (goalType === 'muscle_gain' && mealProtein >= 25) {
      tags.push({
        type: 'achievement',
        label: t('response.tag.highProteinForMuscleGain', {}, locale),
        dimension: 'goal',
        value: mealProtein,
      });
    }

    return tags;
  }

  private getCurrentLocale(): Locale {
    const locale = this.requestCtx.locale;
    return locale === 'en-US' || locale === 'ja-JP' || locale === 'zh-CN'
      ? locale
      : 'zh-CN';
  }

  private buildSuggestionTip(
    mealType: string,
    goalType: string,
    target: Pick<MealTarget, 'calories'>,
    actualCalories: number,
    locale: Locale,
  ): string {
    const tips: string[] = [];

    if (actualCalories > target.calories * 1.1) {
      tips.push(t('tip.caloriesOver', {}, locale));
    } else if (actualCalories < target.calories * 0.7) {
      tips.push(t('tip.caloriesUnder', {}, locale));
    }

    const goalTipKey = `tip.goal.${goalType}`;
    tips.push(
      t(goalTipKey, {}, locale) !== goalTipKey
        ? t(goalTipKey, {}, locale)
        : t('tip.goal.health', {}, locale),
    );

    const mealTipKey = `tip.meal.${mealType}`;
    const mealTip = t(mealTipKey, {}, locale);
    if (mealTip !== mealTipKey) {
      tips.push(mealTip);
    }

    return tips.filter(Boolean).join('；');
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
    locale?: string,
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
    const dailyTarget: MealTarget = {
      calories: goals.calories,
      protein: goals.protein,
      fat: goals.fat,
      carbs: goals.carbs,
    };
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
          timezone: profile.timezone ?? undefined,
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
      locale,
    );
  }

  // ==================== V8: Food Records 统一接口 ====================

  /**
   * V8: 统一写入 Food Record，触发每日汇总更新和 MEAL_RECORDED 事件
   */
  async createRecord(userId: string, dto: CreateFoodRecordDto): Promise<any> {
    const saved = await this.foodRecordService.createRecord(userId, dto);

    this.dailySummaryService
      .updateDailySummary(userId, saved.recordedAt)
      .catch((err) => this.logger.error(`更新每日汇总失败: ${err.message}`));

    this.eventEmitter.emit(
      DomainEvents.MEAL_RECORDED,
      new MealRecordedEvent(
        userId,
        dto.mealType || 'unknown',
        dto.foods?.map((f) => f.name).filter(Boolean) || [],
        dto.totalCalories || 0,
        dto.source || 'manual',
        saved.id,
      ),
    );

    return saved;
  }

  /**
   * V8: 查询 Food Records（支持单日/日期范围）
   */
  async queryRecords(userId: string, query: FoodRecordQueryDto): Promise<any> {
    const tz = await this.userProfileService.getTimezone(userId);
    return this.foodRecordService.queryRecords(userId, query, tz);
  }
}
