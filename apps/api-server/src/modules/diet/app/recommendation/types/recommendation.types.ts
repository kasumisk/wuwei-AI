/**
 * V7.5 P3-B: Barrel re-export — 保持向后兼容
 *
 * 原 2009 行巨型文件已拆分为 6 个模块：
 * - scene.types.ts:    场景 / 渠道 / 现实性（~280 行）
 * - health.types.ts:   健康状况枚举 / 标准化（~75 行）
 * - meal.types.ts:     餐食 / 食物 / 反馈 / 洞察（~330 行）
 * - scoring.types.ts:  评分权重 / 维度 / 品质 / 微量营养素（~370 行）
 * - pipeline.types.ts: Pipeline 上下文 / 画像 / 请求对象（~310 行）
 * - config.types.ts:   评分配置快照 / 调参配置 / 评分上下文（~400 行）
 *
 * 此文件仅做 re-export，所有现有 import 路径无需修改。
 */

// ── scene.types ──
export {
  type SceneType,
  type SceneConstraints,
  type SceneContext,
  type AvailabilityScore,
  AcquisitionChannel,
  ALL_CHANNELS,
  inferAcquisitionChannel,
  type ChannelTimeAvailability,
  type RealismLevel,
  type RealismPreset,
  REALISM_PRESETS,
  SCENE_DEFAULT_REALISM,
} from './scene.types';

// ── health.types ──
export {
  HealthCondition,
  HEALTH_CONDITION_ALIASES,
  normalizeHealthCondition,
  normalizeHealthConditions,
} from './health.types';

// ── meal.types ──
export {
  type MealTarget,
  type Constraint,
  type ScoredFood,
  type DailyPlanState,
  type InsightType,
  type InsightVisualization,
  type StructuredInsight,
  type MealRecommendation,
  type AssembledRecipe,
  type RecipeNutrition,
  type FoodFeedbackStats,
  type UserPreferenceProfile,
  type PipelineDegradation,
  type ExecutionMatchResult,
  EXECUTION_MATCH_SCORES,
  type CrossMealAdjustment,
  type PreferenceSignal,
  type ContrastiveInsight,
} from './meal.types';

// ── scoring.types ──
export {
  SCORE_DIMENSIONS,
  type ScoreDimension,
  SCORE_WEIGHTS,
  MEAL_WEIGHT_MODIFIERS,
  STATUS_WEIGHT_MODIFIERS,
  computeWeights,
  CATEGORY_QUALITY,
  CATEGORY_SATIETY,
  MACRO_RANGES,
  deriveMacroRangesFromTarget,
  MEAL_RATIOS,
  MEAL_PREFERENCES,
  MEAL_ROLES,
  MUSCLE_GAIN_MEAL_ROLES,
  buildMealRoles,
  ROLE_CATEGORIES,
  type MicroNutrientDefaults,
  buildCategoryMicroAverages,
  type RecallMetadata,
  type CFRecallResult,
} from './scoring.types';

// ── pipeline.types ──
export {
  type PipelineContext,
  type UserProfileConstraints,
  type EnrichedProfileContext,
  type ProfileConflict,
  type LifestyleProfile,
  type MealFromPoolRequest,
} from './pipeline.types';

// ── config.types ──
export {
  type ScoringConfigSnapshot,
  type RecommendationTuningConfig,
  type ScoringContext,
} from './config.types';
