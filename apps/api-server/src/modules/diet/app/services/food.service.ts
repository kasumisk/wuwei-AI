import { Injectable, Logger, RequestTimeoutException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
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
import { normalizeDietLocale } from '../recommendation/utils/locale.util';
import type { DecisionValueTag } from '../recommendation/types/meal.types';
import { RequestContextService } from '../../../../core/context/request-context.service';
import { FoodI18nService } from './food-i18n.service';
import { FoodLibrary } from '../../../food/food.types';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';

// ─── V7.9 Phase 3-1: 推荐粘性缓存配置 ───

/** 粘性缓存 TTL（毫秒），同一用户+餐次在此时间内返回相同推荐（Redis 持久化，跨实例共享） */
const STICKINESS_CACHE_TTL_MS = 30 * 60 * 1000; // 30分钟
/** 粘性缓存最大条目数（防止内存泄漏，仅用于 fallback in-memory cache） */
const STICKINESS_CACHE_MAX_SIZE = 500;
/** Redis 粘性缓存 key 前缀 */
const STICKINESS_REDIS_PREFIX = 'stickiness:v1:';

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

interface MealSuggestionOptions {
  mealType?: string;
  skipPrecomputed?: boolean;
}

interface MealSuggestionContext {
  locale: Locale;
  summary: Awaited<ReturnType<FoodService['getTodaySummary']>>;
  profile: Awaited<ReturnType<UserProfileService['getProfile']>>;
  goals: MealTarget;
  goalType: string;
  remaining: number;
  nextMeal: string;
  budget: MealTarget;
  cacheKey: string;
  todayStr: string;
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

type ScenarioRecommendations = Awaited<
  ReturnType<RecommendationEngineService['recommendByScenario']>
>;

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
    private readonly redisCache: RedisCacheService,
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
    options?: MealSuggestionOptions,
  ): Promise<MealSuggestionResponse> {
    const ctx = await this.buildMealSuggestionContext(userId, options);
    const {
      locale,
      summary,
      profile,
      goals,
      goalType,
      remaining,
      nextMeal,
      budget,
      cacheKey,
      todayStr,
    } = ctx;

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
    if (!forceRefresh) {
      const cached = await this.getFromStickinessCache(
        cacheKey,
        summary.totalCalories || 0,
      );
      if (cached) {
        this.logger.log(
          `[MealSuggestion] stickiness hit userId=${userId} meal=${nextMeal} locale=${locale} scenarios=${cached.scenarios?.length ?? 0}`,
        );
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
    const precomputed = options?.skipPrecomputed
      ? null
      : await this.precomputeService.getPrecomputed(
          userId,
          todayStr,
          nextMeal,
          'unknown',
        );
    if (precomputed) {
      const result = await this.buildMealSuggestionFromPrecomputed(
        userId,
        precomputed,
        ctx,
      );

      // V7.9 P3-1: 写入粘性缓存
      this.setToStickinessCache(cacheKey, result, summary.totalCalories || 0);

      return result;
    }

    // 预计算未命中 → 回退到实时计算（现有逻辑不变）
    const reqId = randomUUID().slice(0, 8);
    const _tMiss = Date.now();
    this.logger.log(
      `[PERF reqId=${reqId}] miss-start userId=${userId} meal=${nextMeal} locale=${locale} consumedKcal=${summary.totalCalories ?? 0}`,
    );

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

     // 实时路径统一为「三场景推荐」：takeout / convenience / homeCook。
     // suggestion 字段仅是默认场景的投影，避免再额外计算一套 recommendMeal。
     /**
      * 实时推荐超时阈值（ms）
      * 生产日志显示首个 miss 用户在 summary/profile/precompute 检查之外，
      * recommendByScenario 本身偶尔还需要接近 4s；3500ms 仍会把这类首个冷请求
      * 误判为超时。先提高到 5000ms，优先减少首次生成 408。
      */
     const REALTIME_TIMEOUT_MS = 5000;

    /** 创建超时 Promise，resolve 为 null 表示超时 */
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), REALTIME_TIMEOUT_MS),
    );

     const startTime = Date.now();
     const scenarioRecommendPromise = this.recommendationEngine.recommendByScenario(
       userId,
       nextMeal,
       goalType,
      consumed,
      budget,
       dailyTarget,
       userConstraints,
       reqId,
     );

     const raceResult = await Promise.race([
       scenarioRecommendPromise,
       timeoutPromise,
     ]);

     if (raceResult === null) {
      // ─── 超时：直接抛错，不再用热门榜单兜底误导用户 ───
      const latencyMs = Date.now() - startTime;
      this.logger.warn(
        `实时推荐超时 (>${REALTIME_TIMEOUT_MS}ms, elapsed=${latencyMs}ms), 直接报错: userId=${userId}, meal=${nextMeal}`,
      );

       // 后台继续完整三场景推荐，成功后写入粘性缓存；下一次请求直接命中。
       scenarioRecommendPromise
         .then(async (scenarioRecs) => {
           await Promise.all(
             Object.values(scenarioRecs).map((rec) =>
               this.foodI18nService.applyToMealRecommendation(rec, locale),
             ),
           );
           const result = this.buildMealSuggestionFromScenarios(
             scenarioRecs,
             nextMeal,
             remaining,
             goalType,
             budget,
             goals,
             summary,
             locale,
           );
           this.setToStickinessCache(
             cacheKey,
             result,
             summary.totalCalories || 0,
           );
         })
         .catch((err) =>
           this.logger.warn(
             `后台推荐计算失败 (userId=${userId}): ${(err as Error).message}`,
          ),
        );

      throw new RequestTimeoutException(
        'Meal suggestion generation timed out. Please retry.',
      );
    }

     const scenarioRecs = raceResult;
     const latencyMs = Date.now() - startTime;
     await Promise.all(
       Object.values(scenarioRecs).map((rec) =>
         this.foodI18nService.applyToMealRecommendation(rec, locale),
       ),
     );
     const result = this.buildMealSuggestionFromScenarios(
       scenarioRecs,
       nextMeal,
       remaining,
       goalType,
       budget,
       goals,
       summary,
       locale,
     );

    // V6 Phase 1.2: 发布推荐生成事件
    this.eventEmitter.emit(
      DomainEvents.RECOMMENDATION_GENERATED,
      new RecommendationGeneratedEvent(
        userId,
        nextMeal,
         result.scenarios?.length ?? 0,
         latencyMs,
         false, // fromPrecompute — Phase 1.10 预计算实现后会根据实际情况设置
       ),
     );

    // V7.9 P3-1: 写入粘性缓存
    this.setToStickinessCache(cacheKey, result, summary.totalCalories || 0);
    this.logger.log(
      `[PERF reqId=${reqId}] miss-end totalMs=${Date.now() - _tMiss} scenarioRecMs=${latencyMs} userId=${userId} meal=${nextMeal} scenarios=${result.scenarios?.length ?? 0}`,
    );
    this.logger.log(
      `[MealSuggestion] realtime success userId=${userId} meal=${nextMeal} locale=${locale} scenarios=${result.scenarios?.length ?? 0} primary="${result.suggestion.foods}"`,
    );

    return result;
  }

  private buildMealSuggestionFromScenarios(
    scenarioRecs: ScenarioRecommendations,
    nextMeal: string,
    remaining: number,
    goalType: string,
    budget: MealTarget,
    goals: MealTarget,
    summary: { totalCalories?: number; totalProtein?: number; totalFat?: number; totalCarbs?: number },
    locale: Locale,
  ): MealSuggestionResponse {
    const scenarios = this.buildScenarioSuggestions(
      scenarioRecs,
      nextMeal,
      goalType,
      budget,
      locale,
    );
    const primaryScenario = this.selectPrimaryScenario(scenarios);
    this.logger.log(
      `[MealSuggestion] scenarios built meal=${nextMeal} locale=${locale} count=${scenarios.length} primary="${primaryScenario.scenario}"`,
    );

    const decisionValueTags = this.generateDecisionValueTags(
      primaryScenario.calories,
      primaryScenario.totalProtein ?? 0,
      primaryScenario.totalFat ?? 0,
      primaryScenario.totalCarbs ?? 0,
      remaining,
      goals,
      summary,
      goalType,
      locale,
    );

    return {
      mealType: nextMeal,
      remainingCalories: remaining,
      suggestion: {
        foods: primaryScenario.foods,
        foodItems: primaryScenario.foodItems,
        calories: primaryScenario.calories,
        tip: primaryScenario.tip,
        totalProtein: primaryScenario.totalProtein,
        totalFat: primaryScenario.totalFat,
        totalCarbs: primaryScenario.totalCarbs,
      },
      decisionValueTags,
      scenarios,
    };
  }

  private selectPrimaryScenario(
    scenarios: MealSuggestionScenario[],
  ): MealSuggestionScenario {
    // 默认展示更通用的 takeout-like 第一项；如果未来前端明确传偏好渠道，可在此切换。
    return scenarios[0];
  }

  private buildScenarioSuggestions(
    scenarioRecs: ScenarioRecommendations,
    nextMeal: string,
    goalType: string,
    budget: MealTarget,
    locale: Locale,
  ): MealSuggestionScenario[] {
    return Object.entries(scenarioRecs).map(([key, rec]) => {
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
  }


  async adjustMealSuggestion(
    userId: string,
    _reason: string,
    mealType?: string,
  ): Promise<MealSuggestionResponse> {
    const ctx = await this.buildMealSuggestionContext(userId, { mealType });
    const current = await this.getExistingMealSuggestion(userId, ctx);

    const rotated = current
      ? this.rotateMealSuggestionScenarios(current)
      : null;
    if (rotated) {
      this.setToStickinessCache(
        ctx.cacheKey,
        rotated,
        ctx.summary.totalCalories || 0,
      );
      this.logger.log(
        `[MealSuggestion] adjust reused scenarios userId=${userId} meal=${rotated.mealType} locale=${ctx.locale} scenarios=${rotated.scenarios?.length ?? 0} primary="${rotated.suggestion.foods}"`,
      );
      return rotated;
    }

    if (mealType) {
      this.invalidateMealSuggestionCache(userId, mealType);
    }

    return this.getMealSuggestion(userId, true, {
      mealType,
      skipPrecomputed: true,
    });
  }

  private async buildMealSuggestionContext(
    userId: string,
    options?: MealSuggestionOptions,
  ): Promise<MealSuggestionContext> {
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

    let nextMeal = options?.mealType;
    if (!nextMeal) {
      if (hour < 9) nextMeal = 'breakfast';
      else if (hour < 14) nextMeal = 'lunch';
      else if (hour < 17) nextMeal = 'snack';
      else nextMeal = 'dinner';
    }

    const ratio = mealRatios[nextMeal] || 0.25;
    const calBudget = Math.min(Math.round(goals.calories * ratio), remaining);
    const proteinRem = Math.max(0, goals.protein - (summary.totalProtein || 0));
    const budget: MealTarget = {
      calories: calBudget,
      protein: Math.round(proteinRem * ratio),
      fat: Math.round(goals.fat * ratio),
      carbs: Math.round(goals.carbs * ratio),
    };

    return {
      locale,
      summary,
      profile,
      goals,
      goalType,
      remaining,
      nextMeal,
      budget,
      cacheKey: this.buildStickinessCacheKey(userId, nextMeal, locale),
      todayStr: new Date().toISOString().slice(0, 10),
    };
  }

  private async getExistingMealSuggestion(
    userId: string,
    ctx: MealSuggestionContext,
  ): Promise<MealSuggestionResponse | null> {
    const cached = await this.getFromStickinessCache(
      ctx.cacheKey,
      ctx.summary.totalCalories || 0,
    );
    if (cached) {
      this.logger.log(
        `[MealSuggestion] stickiness hit userId=${userId} meal=${ctx.nextMeal} locale=${ctx.locale} scenarios=${cached.scenarios?.length ?? 0}`,
      );
      return cached;
    }

    const precomputed = await this.precomputeService.getPrecomputed(
      userId,
      ctx.todayStr,
      ctx.nextMeal,
      'unknown',
    );
    if (!precomputed) {
      return null;
    }

    const result = await this.buildMealSuggestionFromPrecomputed(
      userId,
      precomputed,
      ctx,
    );
    this.setToStickinessCache(
      ctx.cacheKey,
      result,
      ctx.summary.totalCalories || 0,
    );
    return result;
  }

  private async buildMealSuggestionFromPrecomputed(
    userId: string,
    precomputed: NonNullable<Awaited<ReturnType<PrecomputeService['getPrecomputed']>>>,
    ctx: MealSuggestionContext,
  ): Promise<MealSuggestionResponse> {
    const { result: mainRec, scenarioResults } = precomputed;

    await this.foodI18nService.applyToMealRecommendation(mainRec as any, ctx.locale);
    if (scenarioResults) {
      await Promise.all(
        Object.values(scenarioResults).map((rec) =>
          this.foodI18nService.applyToMealRecommendation(rec as any, ctx.locale),
        ),
      );
    }

    this.eventEmitter.emit(
      DomainEvents.RECOMMENDATION_GENERATED,
      new RecommendationGeneratedEvent(
        userId,
        ctx.nextMeal,
        mainRec.foods?.length ?? 0,
        0,
        true,
      ),
    );

    const scenarios = scenarioResults
      ? Object.entries(scenarioResults).map(([key, rec]) => {
          const scenarioLabels: Record<string, string> = {
            takeout: t('scenario.takeout', {}, ctx.locale),
            convenience: t('scenario.convenience', {}, ctx.locale),
            homeCook: t('scenario.homeCook', {}, ctx.locale),
          };
          const r = rec as {
            displayText?: string;
            totalCalories?: number;
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
            foods: this.rebuildDisplayText(r.foods, r.displayText || '', ctx.locale),
            foodItems: this.toSuggestionFoodItems(r.foods),
            calories: scenarioCalories,
            tip: this.buildSuggestionTip(
              ctx.nextMeal,
              ctx.goalType,
              ctx.budget,
              scenarioCalories,
              ctx.locale,
            ),
            totalProtein: r.totalProtein,
            totalFat: r.totalFat,
            totalCarbs: r.totalCarbs,
          };
        })
      : undefined;

    this.logger.debug(
      `预计算命中: userId=${userId}, meal=${ctx.nextMeal}, date=${ctx.todayStr}`,
    );
    this.logger.log(
      `[MealSuggestion] precomputed hit userId=${userId} meal=${ctx.nextMeal} locale=${ctx.locale} scenarios=${scenarios?.length ?? 0}`,
    );

    return {
      mealType: ctx.nextMeal,
      remainingCalories: ctx.remaining,
      suggestion: {
        foods: this.rebuildDisplayText(mainRec.foods, mainRec.displayText, ctx.locale),
        foodItems: this.toSuggestionFoodItems(mainRec.foods),
        calories: mainRec.totalCalories,
        tip: this.buildSuggestionTip(
          ctx.nextMeal,
          ctx.goalType,
          ctx.budget,
          Math.max(mainRec.totalCalories || 0, 0),
          ctx.locale,
        ),
        totalProtein: mainRec.totalProtein,
        totalFat: mainRec.totalFat,
        totalCarbs: mainRec.totalCarbs,
      },
      decisionValueTags: this.generateDecisionValueTags(
        mainRec.totalCalories,
        mainRec.totalProtein,
        mainRec.totalFat,
        mainRec.totalCarbs,
        ctx.remaining,
        ctx.goals,
        ctx.summary,
        ctx.goalType,
        ctx.locale,
      ),
      scenarios,
    };
  }

  private rotateMealSuggestionScenarios(
    suggestion: MealSuggestionResponse,
  ): MealSuggestionResponse | null {
    const scenarios = suggestion.scenarios;
    if (!Array.isArray(scenarios) || scenarios.length < 2) {
      return null;
    }

    const [currentPrimary, ...rest] = scenarios;
    const nextPrimary = rest[0];
    const rotatedScenarios = [...rest, currentPrimary];

    return {
      ...suggestion,
      suggestion: {
        foods: nextPrimary.foods,
        foodItems: nextPrimary.foodItems,
        calories: nextPrimary.calories,
        tip: nextPrimary.tip,
        totalProtein: nextPrimary.totalProtein,
        totalFat: nextPrimary.totalFat,
        totalCarbs: nextPrimary.totalCarbs,
      },
      scenarios: rotatedScenarios,
    };
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
        servingDesc: pick.food?.standardServingDesc || '',
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
        const serving = p.food?.standardServingDesc || `${p.food?.standardServingG || 100}g`;
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
   * 从粘性缓存读取（Redis 优先，in-memory fallback）
   *
   * 失效条件：
   * 1. 超过 TTL（30分钟）
   * 2. 用户已摄入热量变化（说明记录了新饮食，推荐应更新）
   */
  private async getFromStickinessCache(
    key: string,
    currentConsumedCalories: number,
  ): Promise<StickinessCacheEntry['result'] | null> {
    const redisKey = `${STICKINESS_REDIS_PREFIX}${key}`;
    try {
      if (this.redisCache.isConfigured) {
        const entry = await this.redisCache.get<StickinessCacheEntry>(redisKey);
        if (entry) {
          // 已摄入热量变化则失效
          if (Math.abs(currentConsumedCalories - entry.consumedCalories) > 10) {
            this.logger.log(
              `[MealSuggestion] stickiness invalidated by calories key=${key} current=${currentConsumedCalories} cached=${entry.consumedCalories}`,
            );
            void this.redisCache.del(redisKey);
            return null;
          }
          return entry.result;
        }
        this.logger.log(`[MealSuggestion] stickiness miss key=${key} source=redis`);
        return null;
      }
    } catch (e) {
      this.logger.warn(`[StickinessCache] Redis get failed, fallback to in-memory: ${e}`);
    }
    // in-memory fallback
    const entry = this.stickinessCache.get(key);
    if (!entry) {
      this.logger.log(`[MealSuggestion] stickiness miss key=${key} source=memory`);
      return null;
    }
    const now = Date.now();
    if (now - entry.createdAt > STICKINESS_CACHE_TTL_MS) {
      this.logger.log(`[MealSuggestion] stickiness expired key=${key} source=memory`);
      this.stickinessCache.delete(key);
      return null;
    }
    if (Math.abs(currentConsumedCalories - entry.consumedCalories) > 10) {
      this.logger.log(
        `[MealSuggestion] stickiness invalidated by calories key=${key} source=memory current=${currentConsumedCalories} cached=${entry.consumedCalories}`,
      );
      this.stickinessCache.delete(key);
      return null;
    }
    return entry.result;
  }

  /**
   * 写入粘性缓存（Redis 优先，in-memory fallback）
   */
  private setToStickinessCache(
    key: string,
    result: StickinessCacheEntry['result'],
    consumedCalories: number,
  ): void {
    const entry: StickinessCacheEntry = {
      key,
      result,
      createdAt: Date.now(),
      consumedCalories,
    };
    const redisKey = `${STICKINESS_REDIS_PREFIX}${key}`;
    // 异步写 Redis，不阻塞响应
    if (this.redisCache.isConfigured) {
      this.redisCache.set(redisKey, entry, STICKINESS_CACHE_TTL_MS).catch((e) => {
        this.logger.warn(`[StickinessCache] Redis set failed, fallback to in-memory: ${e}`);
        this._setInMemoryStickinessCache(key, entry);
      });
    } else {
      this._setInMemoryStickinessCache(key, entry);
    }
  }

  private _setInMemoryStickinessCache(key: string, entry: StickinessCacheEntry): void {
    if (this.stickinessCache.size >= STICKINESS_CACHE_MAX_SIZE) {
      const entries = Array.from(this.stickinessCache.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      );
      const deleteCount = Math.floor(STICKINESS_CACHE_MAX_SIZE / 2);
      for (let i = 0; i < deleteCount; i++) {
        this.stickinessCache.delete(entries[i][0]);
      }
    }
    this.stickinessCache.set(key, entry);
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
        const key = `${userId}:${mealType}:${locale}:${dateStr}`;
        this.stickinessCache.delete(key);
        if (this.redisCache.isConfigured) {
          void this.redisCache.del(`${STICKINESS_REDIS_PREFIX}${key}`);
        }
      }
      return;
    }

    for (const mt of ['breakfast', 'lunch', 'snack', 'dinner']) {
      for (const locale of locales) {
        const key = `${userId}:${mt}:${locale}:${dateStr}`;
        this.stickinessCache.delete(key);
        if (this.redisCache.isConfigured) {
          void this.redisCache.del(`${STICKINESS_REDIS_PREFIX}${key}`);
        }
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
    return normalizeDietLocale(this.requestCtx.locale);
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
