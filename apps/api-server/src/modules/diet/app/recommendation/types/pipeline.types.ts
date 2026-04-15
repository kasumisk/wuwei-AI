/**
 * V7.5 P3-B: Pipeline 上下文 / 画像 / 请求对象类型
 *
 * 从 recommendation.types.ts 拆分，涵盖：
 * - PipelineContext
 * - MealFromPoolRequest
 * - EnrichedProfileContext / UserProfileConstraints
 * - LifestyleProfile / ProfileConflict
 */

import { FoodLibrary } from '../../../../food/food.types';
import { ShortTermProfile } from '../../../../user/app/services/profile/realtime-profile.service';
import { ScoredRecipe } from '../../../../recipe/recipe.types';
import { ResolvedStrategy } from '../../../../strategy/strategy.types';
import { ContextualProfile } from '../../../../user/app/services/profile/contextual-profile.service';
import { AnalysisShortTermProfile } from '../../../../food/app/listeners/analysis-event.listener';
import type { EffectiveGoal } from '../../../../user/app/services/goal/goal-phase.service';
import type { GoalProgress } from '../../../../user/app/services/goal/goal-tracker.service';
import type { DomainProfiles } from '../../../../user/domain/profile-factory';
import type { KitchenProfile } from '../../../../user/user.types';

import type {
  AcquisitionChannel,
  SceneContext,
  RealismLevel,
} from './scene.types';
import type {
  MealTarget,
  Constraint,
  ScoredFood,
  FoodFeedbackStats,
  UserPreferenceProfile,
  DailyPlanState,
  CrossMealAdjustment,
} from './meal.types';
import type { RecommendationTuningConfig } from './config.types';

// ==================== Pipeline 上下文 ====================

/**
 * 三阶段 Pipeline 上下文 — 在各阶段间传递的共享数据
 */
export interface PipelineContext {
  allFoods: FoodLibrary[];
  mealType: string;
  goalType: string;
  target: MealTarget;
  constraints: Constraint;
  usedNames: Set<string>;
  picks: ScoredFood[];
  /** V6.5 Phase 3D: 用户 ID（供语义召回等异步服务使用） */
  userId?: string;
  /** V6.6 Phase 2-B: 替换反馈权重 Map（食物 ID → 乘数），由 ReplacementFeedbackInjectorService 提供 */
  replacementWeightMap?: Map<string, number> | null;
  userPreferences?: { loves?: string[]; avoids?: string[] };
  feedbackStats?: Record<string, FoodFeedbackStats>;
  userProfile?: UserProfileConstraints;
  preferenceProfile?: UserPreferenceProfile;
  regionalBoostMap?: Record<string, number>;
  /** V4 Phase 4.4: 协同过滤推荐分（V6.7: food ID → 0~1） */
  cfScores?: Record<string, number>;
  /** V5 4.7: 在线学习后的权重覆盖（传递给 food-scorer） */
  weightOverrides?: number[] | null;
  /** V5 4.8: A/B 实验组覆盖的餐次权重修正（传递给 food-scorer → computeWeights） */
  mealWeightOverrides?: Record<string, Record<string, number>> | null;
  /** V6 1.9: 短期画像上下文（近 7 天行为，来自 Redis） */
  shortTermProfile?: ShortTermProfile | null;
  /** V6 2.2: 解析后的策略配置（来自 StrategyResolver） */
  resolvedStrategy?: ResolvedStrategy | null;
  /** V6 2.18: 上下文画像（场景检测结果：工作日/周末/深夜等） */
  contextualProfile?: ContextualProfile | null;
  /** V6.1 Phase 3.5: 分析画像（近期分析的食物分类、风险食物等，来自 Redis） */
  analysisProfile?: AnalysisShortTermProfile | null;
  /** V6.4 Phase 3.2: 当前推荐的获取渠道（用于候选池过滤） */
  channel?: AcquisitionChannel;
  /** V6.9 Phase 1-E: 场景上下文（由 SceneResolver 解析，包含渠道、场景类型、约束等） */
  sceneContext?: SceneContext;
  /** V7.0 Phase 3-A: 解析后的有效目标（含复合目标 + 当前阶段 + 权重调整） */
  effectiveGoal?: EffectiveGoal;
  /** V7.0 Phase 3-A: 目标进度（热量/蛋白合规率、执行率、连续天数等） */
  goalProgress?: GoalProgress | null;
  /** V7.0 Phase 3-A: 领域画像（强类型营养画像 + 偏好画像） */
  domainProfiles?: DomainProfiles;
  /** V7.2 P2-C: 用户端现实策略覆盖（"今天想挑战一下" vs "今天想简单吃"） */
  realismOverride?: {
    level: RealismLevel;
  };
  /** V7.1 P3-A: 跨餐营养补偿调整（由 DailyPlanContextService.computeCrossMealAdjustment 产出） */
  crossMealAdjustment?: CrossMealAdjustment;
  /** V7.1 P3-B: 用户厨房设备画像（用于 HOME_COOK 场景设备过滤） */
  kitchenProfile?: KitchenProfile | null;
  /** V7.1 P3-D: 用户高频替换模式（供 PreferenceProfileService.computePreferenceSignal 使用） */
  substitutions?: Array<{
    fromFoodId: string;
    fromFoodName: string;
    toFoodId: string;
    toFoodName: string;
    frequency: number;
  }>;
  /** V7.3 P3-D: 匹配到的餐食模板（由 MealTemplateService.matchTemplate 设置） */
  matchedTemplate?: import('./meal-template.types').MealTemplate;
  /** V7.3 P3-E: Factor 强度用户调整（由 FactorLearner 提供） */
  factorAdjustments?: import('../optimization/factor-learner.service').FactorAdjustmentMap;
  /** V7.4 P2-C: 推荐策略（宏观行为模式：explore/exploit/strict_health/scene_first） */
  recommendationStrategy?: import('./recommendation-strategy.types').ResolvedRecommendationStrategy;
  /** V7.5 P3-A: 推荐调参配置（从 ScoringConfigService.getTuning() 注入） */
  tuning?: Required<RecommendationTuningConfig>;
  /** V7.9: 管道全链路追踪（各阶段写入，最终汇总） */
  trace?: PipelineTrace;
}

// ==================== 用户画像类型 ====================

export interface UserProfileConstraints {
  dietaryRestrictions?: string[];
  weakTimeSlots?: string[];
  discipline?: string;
  allergens?: string[];
  healthConditions?: string[];
  regionCode?: string;
  /** V5 1.8: 用户 IANA 时区（如 'Asia/Shanghai'），传递给约束生成器用于时段判断 */
  timezone?: string;
  /** V6.2 Phase 2.14: 用户份量倾向（'small'|'normal'|'large'），来自行为画像 */
  portionTendency?: string;
  /** V6.2 3.4: 烹饪技能等级（'beginner'|'intermediate'|'advanced'），来自声明画像 */
  cookingSkillLevel?: string;
  /** V6.2 3.4: 预算等级（'low'|'medium'|'high'），来自声明画像 */
  budgetLevel?: string;
  /** V6.2 3.4: 菜系偏好（如 ['中餐','日料']），来自声明画像 */
  cuisinePreferences?: string[];
}

/**
 * V6.2 Phase 2.11 — 增强型画像上下文
 *
 * 扩展 UserProfileConstraints，聚合五层画像数据：
 * - declared: 声明画像（用户主动填写）
 * - observed: 行为画像（Cron 聚合统计）
 * - inferred: 推断画像（BMR/TDEE/Segment 等）
 * - shortTerm: 短期画像（Redis 7天滑窗）
 * - contextual: 上下文画像（实时场景检测）
 *
 * 由 ProfileResolverService.resolve() 统一构建，
 * 推荐引擎只需注入此单一对象即可获取全部画像信息。
 */
export interface EnrichedProfileContext extends UserProfileConstraints {
  /** 声明画像 — 用户主动填写的基础信息 */
  declared: {
    gender?: string;
    birthYear?: number;
    heightCm?: number;
    weightKg?: number;
    targetWeightKg?: number;
    activityLevel?: string;
    goal?: string;
    goalSpeed?: string;
    dailyCalorieGoal?: number;
    mealsPerDay?: number;
    takeoutFrequency?: string;
    canCook?: boolean;
    cookingSkillLevel?: string;
    budgetLevel?: string;
    familySize?: number;
    cuisinePreferences?: string[];
    foodPreferences?: string[];
    dietaryRestrictions?: string[];
    allergens?: string[];
    healthConditions?: string[];
    weakTimeSlots?: string[];
    bingeTriggers?: string[];
    discipline?: string;
    regionCode?: string;
    timezone?: string;
    /** V6.3 P2-9: 每周运动计划，用于 post_exercise 场景检测 */
    exerciseSchedule?: Record<
      string,
      { startHour: number; durationHours: number }
    > | null;
    /** V6.6 Phase 2-C: 生活方式画像字段 */
    sleepQuality?: string | null;
    stressLevel?: string | null;
    hydrationGoal?: number | null;
    supplementsUsed?: string[] | null;
    mealTimingPreference?: string | null;
    /** V7.8: 运动强度（来自 exercise_profile.intensity，原 exercise_intensity 字段已删除） */
    exerciseIntensity?: string | null;
    /** V6.8 Phase 3-B: 饮酒频率 */
    alcoholFrequency?: string | null;
    /** V6.8 Phase 3-B: 年龄 */
    age?: number | null;
    /** V6.8 Phase 3-C: 声明层置信度 0-1（受新鲜度衰减影响） */
    confidence?: number;
  } | null;

  /** 推断画像 — 系统计算的营养/行为推断 */
  inferred: {
    estimatedBmr?: number;
    estimatedTdee?: number;
    recommendedCalories?: number;
    macroTargets?: Record<string, number>;
    userSegment?: string;
    churnRisk?: number;
    optimalMealCount?: number;
    nutritionGaps?: string[];
    preferenceWeights?: Record<string, number>;
  } | null;

  /** 行为画像 — Cron 聚合的行为统计 */
  observed: {
    avgComplianceRate?: number;
    totalRecords?: number;
    streakDays?: number;
    mealTimingPatterns?: Record<string, any>;
    portionTendency?: string;
    /** V6.3 P1-3: 暴食风险时段（小时桶列表，如 [14,21,22]） */
    bingeRiskHours?: number[];
  } | null;

  /** 短期画像 — Redis 7天滑窗（实时事件驱动更新） */
  shortTerm: ShortTermProfile | null;

  /** 上下文画像 — 实时场景检测（纯计算，无 I/O） */
  contextual: ContextualProfile | null;

  /** V6.5: 生活方式画像 — 从 declared 层聚合的评分相关字段 */
  lifestyle: LifestyleProfile | null;

  /** V6.6 Phase 2-C: 生活方式营养素优先级调整 — 由 LifestyleScoringAdapter 生成 */
  lifestyleAdjustment?: Record<string, number> | null;

  /** V6.8 Phase 1-D: 跨层冲突检测结果 */
  conflicts: ProfileConflict[];

  /** V6.8 Phase 1-D: 声明画像新鲜度 0-1（半年衰减到 0） */
  profileFreshness: number;
}

/**
 * V6.8 Phase 1-D: 画像冲突检测结果
 *
 * 在 ProfileResolver 的 5 层合并后检测跨层矛盾（如用户声明减脂但实际摄入超标），
 * 记录冲突字段、双方值、解决策略及置信度，供下游评分/解释/trace 使用。
 */
export interface ProfileConflict {
  /** 冲突字段标识 */
  field: string;
  /** 声明层的值 */
  declaredValue: any;
  /** 观察层的值 */
  observedValue: any;
  /** 解决策略 */
  resolution: 'use_declared' | 'use_observed' | 'blend';
  /** 置信度 0-1（基于观察数据量） */
  confidence: number;
  /** 冲突原因标识 */
  reason: string;
}

/**
 * V6.5 Phase 1E: 生活方式画像
 *
 * 从 declared 声明画像中提取与推荐评分直接相关的6个字段，
 * 结构化为独立子对象，供 ProfileScoringMapper 消费。
 */
export interface LifestyleProfile {
  /** 口味强度偏好 {spicy: 0-5, sweet: 0-5, ...} */
  tasteIntensity: Record<string, number> | null;
  /** 偏好菜系列表 */
  cuisinePreferences: string[];
  /** 预算等级 */
  budgetLevel: 'low' | 'medium' | 'high' | null;
  /** 烹饪技能等级（字符串: beginner/intermediate/advanced） */
  cookingSkillLevel: string | null;
  /** 家庭人数 */
  familySize: number;
  /** 是否愿意备餐 */
  mealPrepWilling: boolean;
  /** V6.6 Phase 2-C: 睡眠质量 */
  sleepQuality?: string | null;
  /** V6.6 Phase 2-C: 压力水平 */
  stressLevel?: string | null;
  /** V6.6 Phase 2-C: 每日目标饮水量 (ml) */
  hydrationGoal?: number | null;
  /** V6.6 Phase 2-C: 正在服用的补剂列表 */
  supplementsUsed?: string[] | null;
  /** V6.6 Phase 2-C: 用餐时间偏好 */
  mealTimingPreference?: string | null;
  /** V7.8: 运动强度（来自 exercise_profile.intensity，原 exercise_intensity 字段已删除） */
  exerciseIntensity?: 'none' | 'light' | 'moderate' | 'high' | null;
  /** V6.8 Phase 3-B: 饮酒频率 */
  alcoholFrequency?: 'never' | 'occasional' | 'frequent' | null;
  /** V6.8 Phase 3-B: 年龄 */
  age?: number | null;
}

// ==================== V6.2 Phase 3.1: MealFromPoolRequest ====================

/**
 * V6.2 Phase 3.1 — recommendMealFromPool 参数请求对象
 *
 * 将原 19 个位置参数合并为单一对象，提升可读性和可维护性。
 * 所有可选字段默认为 undefined/null（与原位置参数行为一致）。
 */
export interface MealFromPoolRequest {
  /** 食物库全集 */
  allFoods: FoodLibrary[];
  /** 餐次类型 */
  mealType: string;
  /** 目标类型（减脂/增肌/健康等） */
  goalType: string;
  /** 当日已摄入量 */
  consumed: { calories: number; protein: number };
  /** 本餐目标 */
  target: MealTarget;
  /** 当日总目标 */
  dailyTarget: { calories: number; protein: number };
  /** 排除食物名称列表（去重） */
  excludeNames: string[];
  /** 用户偏好（loves/avoids） */
  userPreferences?: { loves?: string[]; avoids?: string[] };
  /** 食物反馈统计（Thompson Sampling） */
  feedbackStats?: Record<string, FoodFeedbackStats>;
  /** 用户约束画像 */
  userProfile?: UserProfileConstraints;
  /** 用户偏好画像（按维度的接受率乘数） */
  preferenceProfile?: UserPreferenceProfile;
  /** 区域加分映射 */
  regionalBoostMap?: Record<string, number>;
  /** 协同过滤评分 */
  cfScores?: Record<string, number>;
  /** V5 4.7: 在线学习后的权重覆盖 */
  weightOverrides?: number[] | null;
  /** V5 4.8: A/B 实验组覆盖的餐次权重修正 */
  mealWeightOverrides?: Record<string, Record<string, number>> | null;
  /** V6 1.9: 短期画像上下文（近 7 天行为） */
  shortTermProfile?: ShortTermProfile | null;
  /** V6 2.2: 解析后的策略配置 */
  resolvedStrategy?: ResolvedStrategy | null;
  /** V6 2.18: 上下文画像（场景检测结果） */
  contextualProfile?: ContextualProfile | null;
  /** V6.1 Phase 3.5: 分析画像（近期分析的食物分类、风险食物等） */
  analysisProfile?: AnalysisShortTermProfile | null;
  /** V6.3 P2-8: 已评分的菜谱候选（由调用方提前获取，用于菜谱优先组装模式） */
  scoredRecipes?: ScoredRecipe[] | null;
  /** V6.4 Phase 3.2: 获取渠道（用于候选池过滤） */
  channel?: AcquisitionChannel;
  /** V6.5 Phase 3D: 用户 ID（供语义召回等异步服务使用） */
  userId?: string;
  /** V6.9 Phase 1-E: 场景上下文（由 SceneResolver 解析） */
  sceneContext?: SceneContext;
  /** V6.9 Phase 2-D: 用户端现实策略覆盖（"今天想挑战一下" vs "今天想简单吃"） */
  realismOverride?: {
    level: RealismLevel;
  };
  /** V6.9 Phase 2-D: 日计划状态（跨餐多样性，由上游传入） */
  dailyPlanState?: DailyPlanState;
  /** V7.0 Phase 3-A: 解析后的有效目标（含复合目标 + 当前阶段 + 权重调整） */
  effectiveGoal?: EffectiveGoal;
  /** V7.0 Phase 3-A: 目标进度（热量/蛋白合规率、执行率、连续天数等） */
  goalProgress?: GoalProgress | null;
  /** V7.0 Phase 3-A: 领域画像（强类型营养画像 + 偏好画像） */
  domainProfiles?: DomainProfiles;
  /** V7.1 P3-A: 跨餐营养补偿调整 */
  crossMealAdjustment?: CrossMealAdjustment;
  /** V7.1 P3-B: 用户厨房设备画像 */
  kitchenProfile?: KitchenProfile | null;
  /** V7.1 P3-D: 用户高频替换模式 */
  substitutions?: Array<{
    fromFoodId: string;
    fromFoodName: string;
    toFoodId: string;
    toFoodName: string;
    frequency: number;
  }>;
}

// ==================== V7.9: Pipeline Trace ====================

/**
 * V7.9: 推荐管道全链路结构化追踪
 *
 * 由 PipelineBuilderService 在管道执行过程中逐阶段填充，
 * 最终写入 recommendation_traces 表或直接返回给 admin debug API。
 */
export interface PipelineTrace {
  /** 追踪 ID，UUID，关联一次推荐请求 */
  traceId: string;
  userId: string;
  mealType: string;
  /** 管道开始时间戳 (ms) */
  startedAt: number;
  /** 管道结束时间戳 (ms) */
  completedAt?: number;
  /** 各阶段追踪数据 */
  stages: PipelineStageTrace[];
  /** 管道汇总信息 */
  summary?: PipelineTraceSummary;
  /**
   * V8.0 P1-04: 阶段间临时数据缓冲区
   *
   * 替代原 `(ctx.trace as any)._lastXxxDetails` 模式，
   * 由下游服务在执行阶段写入，由 executeRolePipeline 在阶段结束时读取并清除。
   * 使用类型安全的 key → 具体 detail interface 映射。
   */
  stageBuffer?: Partial<StageBufferMap>;
}

/**
 * V8.0 P1-04: stageBuffer 的类型安全 key → value 映射
 *
 * 每个 key 对应一个下游服务在执行阶段写入的详情对象。
 * executeRolePipeline 在阶段结束时读取对应 key 的值，合并到 PipelineStageTrace.details 中。
 */
export interface StageBufferMap {
  recallMerge: RecallMergeBufferDetails;
  realisticFilter: RealisticFilterBufferDetails;
  scoringChain: ScoringChainBufferDetails;
  healthModifier: HealthModifierBufferDetails;
}

/** recallCandidates 三路合并后写入的各路召回计数 */
export interface RecallMergeBufferDetails {
  ruleCandidates: number;
  semanticCandidates: number;
  cfCandidates: number;
  mergedTotal: number;
}

/** RealisticFilterService 写入的各阶段过滤计数 */
export interface RealisticFilterBufferDetails {
  filteredByCommonality: number;
  filteredByFoodForm: number;
  filteredByBudget: number;
  filteredByCookTime: number;
  filteredByCanteen: number;
  filteredBySkill: number;
  filteredByEquipment: number;
  fallbackTriggered: boolean;
}

/** ScoringChainService 写入的因子执行详情 */
export interface ScoringChainBufferDetails {
  activeFactors: string[];
  disabledFactors: string[];
  candidateCount: number;
  factorHitCounts: Record<string, number>;
}

/** HealthModifierEngine 写入的否决详情 */
export interface HealthModifierBufferDetails {
  totalEvaluated: number;
  vetoedCount: number;
  vetoedFoods: string[];
}

/** 单个管道阶段的追踪记录 */
export interface PipelineStageTrace {
  stage:
    | 'recall'
    | 'realistic_filter'
    | 'rank'
    | 'health_modifier'
    | 'scoring_chain'
    | 'rerank'
    | 'assemble';
  durationMs: number;
  inputCount: number;
  outputCount: number;
  /** 阶段特定详情，按 stage 类型区分 */
  details?: Record<string, unknown>;
}

/** Recall 阶段追踪详情 */
export interface RecallTraceDetails {
  ruleCandidates: number;
  semanticCandidates: number;
  cfCandidates: number;
  mergedTotal: number;
  filteredByAllergen: number;
  filteredByRestriction: number;
  filteredByShortTermReject: number;
}

/** RealisticFilter 阶段追踪详情 */
export interface RealisticFilterTraceDetails {
  realismLevel: string;
  filteredByCommonality: number;
  filteredByBudget: number;
  filteredByCookTime: number;
  filteredBySkill: number;
  filteredByEquipment: number;
  filteredByFoodForm: number;
  fallbackTriggered: boolean;
}

/** Rank 阶段追踪详情 */
export interface RankTraceDetails {
  scoringFactorsApplied: string[];
  healthModifierVetoed: string[];
  topCandidates: Array<{
    foodName: string;
    baseScore: number;
    chainAdjustment: number;
    healthModifier: number;
    finalScore: number;
  }>;
}

/** Rerank 阶段追踪详情 */
export interface RerankTraceDetails {
  explorationRate: number;
  foodFormPromotions: number;
  diversityPenalties: number;
}

/** 管道执行汇总 */
export interface PipelineTraceSummary {
  totalDurationMs: number;
  /** 候选数流转路径，e.g. "384→152→30→5" */
  candidateFlowPath: string;
  strategyName: string;
  sceneName: string;
  realismLevel: string;
  degradations: string[];
  cacheHit: boolean;
}

// ─── V8.0 P1-04: stageBuffer 辅助函数 ───

/**
 * 类型安全地向 trace.stageBuffer 写入阶段详情
 */
export function writeStageBuffer<K extends keyof StageBufferMap>(
  trace: PipelineTrace | undefined,
  key: K,
  value: StageBufferMap[K],
): void {
  if (!trace) return;
  if (!trace.stageBuffer) trace.stageBuffer = {};
  trace.stageBuffer[key] = value;
}

/**
 * 类型安全地从 trace.stageBuffer 读取并清除阶段详情
 */
export function consumeStageBuffer<K extends keyof StageBufferMap>(
  trace: PipelineTrace | undefined,
  key: K,
): StageBufferMap[K] | undefined {
  if (!trace?.stageBuffer) return undefined;
  const value = trace.stageBuffer[key];
  delete trace.stageBuffer[key];
  return value as StageBufferMap[K] | undefined;
}
