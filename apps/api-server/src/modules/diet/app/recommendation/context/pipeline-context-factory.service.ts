/**
 * V8.0 P1-01: PipelineContext 工厂
 *
 * 从 RecommendationEngineService.recommendMealFromPool 中提取
 * PipelineContext 的构建逻辑（原行 709-740 / 813-845），统一为单一入口。
 *
 * 职责：
 * - 接收 MealFromPoolRequest + 计算后的 Constraint
 * - 注入运行时依赖（tuning、replacementWeightMap）
 * - 返回完整的 PipelineContext
 *
 * 设计：
 * - 纯数据组装，无业务逻辑（不做 DB/Redis IO）
 * - ScoringConfigService.getTuning() 是同步内存读取，零 IO
 */
import { Injectable, Logger } from '@nestjs/common';
import { ScoringConfigService } from './scoring-config.service';
import {
  DEFAULT_TIMEZONE,
  getUserLocalMonth,
  getUserLocalHour,
} from '../../../../../common/utils/timezone.util';
import { DEFAULT_REGION_CODE } from '../../../../../common/config/regional-defaults';
import type {
  PipelineContext,
  MealFromPoolRequest,
} from '../types/pipeline.types';
import type {
  Constraint,
  ScoredFood,
  CrossMealAdjustment,
} from '../types/meal.types';

/** 构建 PipelineContext 所需的额外运行时参数（由调用方提前计算） */
export interface PipelineContextBuildParams {
  /** 约束条件（由 ConstraintGenerator 生成） */
  constraints: Constraint;
  /** 已选食物列表的引用（用于角色循环中的累积） */
  picks: ScoredFood[];
  /** 已使用的食物名集合（用于去重） */
  usedNames: Set<string>;
  /** 替换反馈权重 Map（由 ReplacementFeedbackInjectorService 提供，可为 null） */
  replacementWeightMap?: Map<string, number> | null;
  /** 跨餐营养补偿覆盖（由调用方实时计算后传入，覆盖 req 中的原始值） */
  crossMealAdjustment?: CrossMealAdjustment;
}

@Injectable()
export class PipelineContextFactory {
  private readonly logger = new Logger(PipelineContextFactory.name);

  /**
   * 阶段 1.5：timezone / regionCode 缺失警告去重集合。
   * 同一 userId 只打印一次 WARN，避免高频推荐请求刷屏日志。
   * 进程重启后自动清空（符合预期：重启后重新检测）。
   */
  private readonly warnedMissingTimezone = new Set<string>();
  private readonly warnedMissingRegion = new Set<string>();

  constructor(private readonly scoringConfigService: ScoringConfigService) {}

  /**
   * 构建完整的 PipelineContext
   *
   * 将 MealFromPoolRequest 的字段 + 运行时参数 + tuning 配置组装为 PipelineContext。
   * 调用方只需提供 request 和少量计算结果，不再需要手动列举 40+ 字段。
   */
  build(
    req: MealFromPoolRequest,
    params: PipelineContextBuildParams,
  ): PipelineContext {
    // 区域+时区优化（阶段 1.1）：统一从 userProfile 提取 timezone / regionCode，
    // 并基于 timezone 计算用户本地当前月份，供下游 SeasonalityService 等使用。
    const rawTimezone = req.userProfile?.timezone;
    const rawRegionCode = req.userProfile?.regionCode;
    const userId = req.userId ?? 'anonymous';

    // 阶段 1.5：缺失字段一次性警告（按 userId 去重）
    if (!rawTimezone && !this.warnedMissingTimezone.has(userId)) {
      this.warnedMissingTimezone.add(userId);
      this.logger.warn(
        `[RegionalTZ] userId=${userId} missing timezone, falling back to default "${DEFAULT_TIMEZONE}". ` +
          `Please ensure UserProfiles.timezone is populated.`,
      );
    }
    if (!rawRegionCode && !this.warnedMissingRegion.has(userId)) {
      this.warnedMissingRegion.add(userId);
      this.logger.warn(
        `[RegionalTZ] userId=${userId} missing regionCode, falling back to default "${DEFAULT_REGION_CODE}". ` +
          `Please ensure UserProfiles.regionCode is populated.`,
      );
    }

    const timezone = rawTimezone || DEFAULT_TIMEZONE;
    const regionCode = rawRegionCode || DEFAULT_REGION_CODE;
    const currentMonth = getUserLocalMonth(timezone);
    const localHour = getUserLocalHour(timezone);

    return {
      // ── 核心字段 ──
      allFoods: req.allFoods,
      mealType: req.mealType,
      goalType: req.goalType,
      target: req.target,
      // P0-3: 下沉 dailyTarget 到 PipelineContext，供 FoodScorer/MultiObjectiveOptimizer 使用
      dailyTarget: req.dailyTarget,
      constraints: params.constraints,
      usedNames: params.usedNames,
      picks: params.picks,

      // ── 用户标识 ──
      userId: req.userId,

      // ── 区域+时区（阶段 1.1） ──
      timezone,
      currentMonth,
      localHour,
      regionCode,

      // ── 反馈/偏好 ──
      replacementWeightMap: params.replacementWeightMap,
      userPreferences: req.userPreferences,
      feedbackStats: req.feedbackStats,
      userProfile: req.userProfile,
      preferenceProfile: req.preferenceProfile,
      regionalBoostMap: req.regionalBoostMap,

      // ── 协同过滤 / 权重覆盖 ──
      cfScores: req.cfScores,
      weightOverrides: req.weightOverrides,
      mealWeightOverrides: req.mealWeightOverrides,

      // ── 画像 ──
      shortTermProfile: req.shortTermProfile,
      contextualProfile: req.contextualProfile,
      analysisProfile: req.analysisProfile,

      // ── 策略 ──
      resolvedStrategy: req.resolvedStrategy,

      // ── 场景/渠道 ──
      channel: req.channel,
      sceneContext: req.sceneContext,

      // ── 目标/进度 ──
      effectiveGoal: req.effectiveGoal,
      goalProgress: req.goalProgress,
      domainProfiles: req.domainProfiles,

      // ── 跨餐/厨房/替换 ──
      crossMealAdjustment:
        params.crossMealAdjustment ?? req.crossMealAdjustment,
      kitchenProfile: req.kitchenProfile,
      substitutions: req.substitutions,

      // ── 现实策略覆盖 ──
      realismOverride: req.realismOverride,

      // ── 调参配置（同步内存读取） ──
      tuning: this.scoringConfigService.getTuning(),
    };
  }
}
