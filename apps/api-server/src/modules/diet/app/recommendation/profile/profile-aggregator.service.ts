/**
 * V7.6 P1-B: ProfileAggregatorService — 画像聚合 Facade
 *
 * 将 RecommendationEngineService 中 9 个画像相关 DI 聚合为单一 facade，
 * 减少 Engine 的构造函数参数（31 → 23 DI）。
 *
 * 聚合的 DI：
 * - ProfileResolverService（统一画像聚合）
 * - PreferenceProfileService（偏好画像 + 地域 boost + 近期食物）
 * - RecommendationFeedbackService（反馈统计）
 * - UserProfileService（厨房画像 + 推荐偏好）
 * - GoalPhaseService（分阶段目标）
 * - GoalTrackerService（目标进度）
 * - ExecutionTrackerService（替换模式）
 * - LearnedRankingService（per-segment 学习权重）
 * - RealtimeProfileService（短期画像）
 *
 * 暴露方法：
 * - aggregateForRecommendation() — recommendMeal 所需的全部画像数据
 * - aggregateForScenario()       — recommendByScenario 所需的画像数据
 * - getShortTermProfile()        — scoreAndExplainWhyNot 所需的短期画像
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  ProfileResolverService,
  type EnrichedProfileWithDomain,
} from '../../../../user/app/services/profile/profile-resolver.service';
import { PreferenceProfileService } from './preference-profile.service';
import { RecommendationFeedbackService } from '../feedback/feedback.service';
import { UserProfileService } from '../../../../user/app/services/profile/user-profile.service';
import {
  GoalPhaseService,
  type EffectiveGoal,
} from '../../../../user/app/services/goal/goal-phase.service';
import {
  GoalTrackerService,
  type GoalProgress,
} from '../../../../user/app/services/goal/goal-tracker.service';
import {
  ExecutionTrackerService,
  type SubstitutionPattern,
} from '../feedback/execution-tracker.service';
import { LearnedRankingService } from '../optimization/learned-ranking.service';
import { WeightLearnerService } from '../optimization/weight-learner.service';
import { SCORE_WEIGHTS } from '../types/scoring.types';
import type { GoalType } from '../../services/nutrition-score.service';
import {
  DEFAULT_REGION_CODE,
} from '../../../../../common/config/regional-defaults';
import { localeToFoodRegion } from '../../../../../common/utils/locale-region.util';
import {
  RealtimeProfileService,
  type ShortTermProfile,
} from '../../../../user/app/services/profile/realtime-profile.service';
import type {
  FoodFeedbackStats,
  UserPreferenceProfile,
} from '../types/meal.types';
import type { KitchenProfile } from '../../../../user/user.types';
import type { EnrichedProfileContext } from '../types/recommendation.types';

// ─── 聚合结果类型 ───

/**
 * recommendMeal 所需的全部画像数据
 */
export interface RecommendationProfileData {
  /** 近期推荐过的食物名（用于排重） */
  recentFoodNames: string[];
  /** 反馈统计（Thompson Sampling） */
  feedbackStats: Record<string, FoodFeedbackStats>;
  /** 偏好画像（品类/食材/食物组/食物名权重） */
  preferenceProfile: UserPreferenceProfile;
  /** 统一聚合画像（五层 + 领域画像） */
  enrichedProfile: EnrichedProfileWithDomain;
  /** 分阶段有效目标 */
  effectiveGoal: EffectiveGoal;
  /** 目标进度 */
  goalProgress: GoalProgress;
  /** 厨房设备画像 */
  kitchenProfile: KitchenProfile | null;
  /** 高频替换模式 */
  substitutions: SubstitutionPattern[];
  /** per-segment 学习权重（null = 未启用 / 无数据） */
  learnedWeightOverrides: number[] | null;
  /** 地域偏好 boost 映射（已合并 region + cuisine 双源） */
  regionalBoostMap: Record<string, number>;
  /**
   * P3-3.5：用户 cuisine 偏好对应的国家代码列表（去重、已排除用户当前 country）。
   * 用于 RecommendationTrace 透出"为什么 boost 了这些 foods"。
   */
  cuisinePreferenceRegions: string[];
}

/**
 * recommendByScenario 所需的画像数据（子集）
 */
export interface ScenarioProfileData {
  /** 近期推荐过的食物名 */
  recentFoodNames: string[];
  /** 统一聚合画像（基础版，不含 domainProfiles） */
  enrichedProfile: EnrichedProfileContext;
}

@Injectable()
export class ProfileAggregatorService {
  private readonly logger = new Logger(ProfileAggregatorService.name);

  constructor(
    private readonly profileResolver: ProfileResolverService,
    private readonly preferenceProfileService: PreferenceProfileService,
    private readonly feedbackService: RecommendationFeedbackService,
    private readonly userProfileService: UserProfileService,
    private readonly goalPhaseService: GoalPhaseService,
    private readonly goalTrackerService: GoalTrackerService,
    private readonly executionTrackerService: ExecutionTrackerService,
    private readonly learnedRankingService: LearnedRankingService,
    private readonly weightLearnerService: WeightLearnerService,
    private readonly realtimeProfile: RealtimeProfileService,
  ) {}

  /**
   * 为 recommendMeal 聚合全部画像数据。
   *
   * 并行获取 8 项画像，然后串行获取 learnedWeights 和 regionalBoostMap
   * （后两者依赖 enrichedProfile 中的 userSegment / regionCode）。
   */
  async aggregateForRecommendation(
    userId: string,
    mealType: string,
  ): Promise<RecommendationProfileData> {
    // Phase 1: 并行获取独立画像数据
    const [
      recentFoodNames,
      feedbackStats,
      preferenceProfile,
      enrichedProfile,
      effectiveGoal,
      goalProgress,
      kitchenProfile,
      substitutions,
    ] = await Promise.all([
      this.preferenceProfileService.getRecentFoodNames(userId, 3),
      this.feedbackService.getUserFeedbackStats(userId),
      this.preferenceProfileService.getUserPreferenceProfile(userId),
      this.profileResolver.resolveWithDomainProfiles(userId, mealType),
      this.goalPhaseService.getCurrentGoal(userId),
      this.goalTrackerService.getProgress(userId),
      this.userProfileService.getKitchenProfile(userId),
      this.executionTrackerService.getTopSubstitutions(userId),
    ]);

    // Phase 2: 依赖 enrichedProfile 的串行获取
    const userSegment = enrichedProfile.inferred?.userSegment;

    // 区域+时区优化（阶段 1.4）：regionCode 缺失时依次通过 locale 推断，最终兜底 DEFAULT_REGION_CODE
    let regionCode = enrichedProfile.regionCode;
    if (!regionCode) {
      // 尝试用 locale（BCP 47）推断 regionCode（如 'en-US' → 'US'）
      const inferredFromLocale = enrichedProfile.locale
        ? localeToFoodRegion(enrichedProfile.locale)
        : null;
      regionCode = inferredFromLocale || DEFAULT_REGION_CODE;
      this.logger.warn(
        `No regionCode for user=${userId}, ` +
          (inferredFromLocale
            ? `inferred '${regionCode}' from locale '${enrichedProfile.locale}'`
            : `falling back to default '${DEFAULT_REGION_CODE}'`),
      );
    }

    // P3-2.6 / P3-PR1：weightLearner 四层融合（user×meal × region × global）优先；
    // 无任何学习信号时回退到 segment 级 LearnedRankingService（旧路径）。
    let learnedWeightOverrides: number[] | null = null;
    const goalType = effectiveGoal?.goalType as GoalType | undefined;
    if (goalType && SCORE_WEIGHTS[goalType]) {
      try {
        learnedWeightOverrides =
          await this.weightLearnerService.getUserMealWeights(
            userId,
            goalType,
            mealType,
            SCORE_WEIGHTS[goalType],
            regionCode,
          );
      } catch (err) {
        this.logger.debug(
          `WeightLearnerService.getUserMealWeights failed (user=${userId}): ${(err as Error).message}`,
        );
      }
    }
    if (!learnedWeightOverrides) {
      try {
        learnedWeightOverrides =
          await this.learnedRankingService.getLearnedWeights(
            userSegment,
            userId,
          );
      } catch (err) {
        this.logger.debug(
          `LearnedRankingService.getLearnedWeights failed (user=${userId}): ${(err as Error).message}`,
        );
      }
    }

    const regionalBoostMap =
      await this.preferenceProfileService.getRegionalBoostMap(regionCode);

    // P3-3.5：cuisine 偏好衍生 boost map，与 region map 取 max 合并
    const declaredCuisinePrefs =
      (enrichedProfile.declared?.cuisinePreferences as
        | string[]
        | undefined) ?? null;
    const cuisineBoostMap =
      await this.preferenceProfileService.getCuisineRegionalBoostMap(
        declaredCuisinePrefs,
        regionCode,
      );
    const mergedRegionalBoostMap =
      PreferenceProfileService.mergeRegionalBoostMaps(
        regionalBoostMap,
        cuisineBoostMap,
      );

    // P3-3.5：透出 cuisine 推断到的国家列表，供 trace 解释
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCuisinePreferenceCountries } = require(
      '../../../../../common/utils/cuisine.util',
    ) as {
      getCuisinePreferenceCountries: (
        prefs: readonly string[] | null | undefined,
        excludeCountryCode?: string | null,
      ) => string[];
    };
    const cuisinePreferenceRegions = getCuisinePreferenceCountries(
      declaredCuisinePrefs,
      regionCode,
    );

    return {
      recentFoodNames,
      feedbackStats,
      preferenceProfile,
      enrichedProfile,
      effectiveGoal,
      goalProgress,
      kitchenProfile,
      substitutions,
      learnedWeightOverrides,
      regionalBoostMap: mergedRegionalBoostMap,
      cuisinePreferenceRegions,
    };
  }

  /**
   * 为 recommendByScenario 聚合画像数据（子集）。
   *
   * 场景推荐只需基础画像（不含 domainProfiles / goal / feedback 等）。
   */
  async aggregateForScenario(
    userId: string,
    mealType: string,
  ): Promise<ScenarioProfileData> {
    const [recentFoodNames, enrichedProfile] = await Promise.all([
      this.preferenceProfileService.getRecentFoodNames(userId, 3),
      this.profileResolver.resolve(userId, mealType),
    ]);

    return {
      recentFoodNames,
      enrichedProfile,
    };
  }

  /**
   * 为 scoreAndExplainWhyNot 获取短期画像。
   */
  async getShortTermProfile(userId: string): Promise<ShortTermProfile | null> {
    return this.realtimeProfile.getShortTermProfile(userId);
  }

  /**
   * 获取用户推荐偏好（用于策略覆盖层）。
   * 供 StrategyResolverFacade (P1-C) 使用。
   */
  async getRecommendationPreferences(userId: string) {
    return this.userProfileService.getRecommendationPreferences(userId);
  }
}
