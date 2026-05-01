/**
 * V7.5 P3-B: 评分配置快照 / 评分上下文 / 调参配置类型
 *
 * 从 recommendation.types.ts 拆分，涵盖：
 * - ScoringConfigSnapshot
 * - ScoringContext
 * - RecommendationTuningConfig
 */

import { FoodLibrary } from '../../../../food/food.types';
import type { HealthModifierContext } from '../modifier/health-modifier-engine.service';
import type { HealthModifierResult } from '../modifier/health-modifier-engine.service';
import type { NutritionTargets } from '../pipeline/nutrition-target.service';
import type { LifestyleNutrientAdjustment } from '../modifier/lifestyle-scoring-adapter.service';
import type { EffectiveGoal } from '../../../../user/app/services/goal/goal-phase.service';
import type { PreferencesProfile } from '../../../../user/domain/preferences-profile';
import { RankPolicyConfig } from '../../../../strategy/strategy.types';

import type { AcquisitionChannel } from './scene.types';
import type { MealTarget } from './meal.types';
import type { PreferenceSignal } from './meal.types';

// ==================== V6.7 Phase 1-B: ScoringConfigSnapshot ====================

/**
 * V6.7 Phase 1-B: 评分参数快照
 *
 * 从 ScoringConfigService 加载，集中管理分散在 10+ service 中的 42+ 硬编码常量。
 * 支持运行时通过 Admin API 更新，无需重部署。
 *
 * 分区说明：
 * - FoodScorer: 12维评分 + NOVA/addedSugar 惩罚 + 置信度
 * - RecallMerger: 三路召回权重 + 品类候选上限
 * - RealisticFilter: 最小候选数 + 食堂通用度阈值
 * - MealComposition: 5维组合评分权重
 * - ReplacementFeedback: 替换反馈衰减/频率参数
 * - CF: 用户/物品协同过滤权重
 * - Lifestyle: 生活方式营养素 boost 系数
 */
export interface ScoringConfigSnapshot {
  // ── FoodScorer 参数 ──

  /** 可执行性评分的子权重 */
  executabilitySubWeights: {
    commonality: number;
    cost: number;
    cookTime: number;
    skill: number;
  };
  /** NRF 9.3 Sigmoid 中心点（默认 150） */
  nrf93SigmoidCenter: number;
  /** NRF 9.3 Sigmoid 斜率（默认 0.01） */
  nrf93SigmoidSlope: number;
  /** 炎症指数 Sigmoid 中心点（默认 20） */
  inflammationCenter: number;
  /** 炎症指数 Sigmoid 斜率（默认 0.08） */
  inflammationSlope: number;
  /** 添加糖惩罚阈值 (g → 每 N g 扣分，默认 10) */
  addedSugarPenaltyPerGrams: number;
  /** 置信度下限（默认 0.7） */
  confidenceFloor: number;
  /** NOVA 基准惩罚乘数 [NOVA0兜底, NOVA1, NOVA2, NOVA3, NOVA4]（默认 [1.0, 1.0, 1.0, 0.85, 0.55]） */
  novaBase: number[];
  /** 热量评分 Sigma 比例（per-goal，默认 { fat_loss: 0.12, muscle_gain: 0.2, health: 0.15, habit: 0.25 }） */
  energySigmaRatios: Record<string, number>;

  // ── RecallMerger 参数 ──

  /** 语义召回独占权重（默认 0.7） */
  semanticOnlyWeight: number;
  /** CF 召回独占权重（默认 0.6） */
  cfOnlyWeight: number;
  /** 非规则候选每品类上限（默认 5） */
  maxCandidatesPerCategoryForNonRule: number;

  // ── RealisticFilter 参数 ──

  /** 最小候选数量（默认 5） */
  minCandidates: number;
  /** 食堂场景通用度阈值（默认 60） */
  canteenCommonalityThreshold: number;

  // ── MealComposition 参数 ──

  /** 整餐组合评分 5 维权重 */
  compositionWeights: {
    ingredientDiversity: number;
    cookingMethodDiversity: number;
    flavorHarmony: number;
    nutritionComplementarity: number;
    textureDiversity: number;
  };

  // ── ReplacementFeedback 参数 ──

  /** 被替换食物的分数乘数（默认 0.8，降权） */
  replacedFromMultiplier: number;
  /** 替换为食物的分数乘数（默认 1.12，增权） */
  replacedToMultiplier: number;
  /** 替换反馈衰减天数（默认 30） */
  replacementDecayDays: number;
  /** 替换反馈最低频次门槛（默认 2） */
  replacementMinFrequency: number;

  // ── CF 参数 ──

  /** 用户协同过滤权重（默认 0.4） */
  cfUserBasedWeight: number;
  /** 物品协同过滤权重（默认 0.6） */
  cfItemBasedWeight: number;

  // ── Lifestyle 参数 ──

  /** 睡眠差 → 色氨酸 boost（默认 0.15） */
  lifestyleSleepPoorTryptophanBoost: number;
  /** 睡眠差 → 镁 boost（默认 0.1） */
  lifestyleSleepPoorMagnesiumBoost: number;
  /** 压力高 → 维C boost（默认 0.12） */
  lifestyleStressHighVitCBoost: number;

  // ────────────────────────────────────────────────────
  // V6.8 新增参数（全部可选，未提供时使用 getDefaults() 中的硬编码默认值）
  // ────────────────────────────────────────────────────

  // ── V6.8 蛋白质评分参数 ──

  /** 每目标蛋白质理想热量占比范围（默认 { fat_loss: [0.25,0.35], muscle_gain: [0.25,0.4], health: [0.15,0.25], habit: [0.12,0.3] }） */
  proteinRangeByGoal?: Record<string, [number, number]>;
  /** 低于范围时的线性斜率系数（默认 0.3） */
  proteinBelowRangeCoeff?: number;
  /** 低于范围时的基础分（默认 0.7） */
  proteinBelowRangeBase?: number;
  /** 超出范围时的衰减系数（默认 0.5） */
  proteinAboveRangeDecay?: number;
  /** 超出范围时的分母（默认 0.15） */
  proteinAboveRangeDiv?: number;

  // ── V6.8 能量评分参数 ──

  /** 减脂超标惩罚乘数（默认 0.85） */
  energyFatLossPenalty?: number;
  /** 增肌不足惩罚乘数（默认 0.9） */
  energyMuscleGainPenalty?: number;
  /** target<=0 时默认分（默认 0.8） */
  energyDefaultScore?: number;
  /** calories<=0 时蛋白质默认分（默认 0.8） */
  proteinDefaultScore?: number;

  // ── V6.8 GI/GL 评分参数 ──

  /** 无法估算时 GI 默认分（默认 0.75） */
  giDefaultScore?: number;
  /** GL Sigmoid 斜率（默认 0.3） */
  glSigmoidSlope?: number;
  /** GL Sigmoid 中心点（默认 15） */
  glSigmoidCenter?: number;
  /** 品类 GI 估算 map */
  categoryGiMap?: Record<string, number>;
  /** 品类未知时 fallback GI（默认 55） */
  giFallback?: number;
  /** 每 NOVA 级加工 GI 增量（默认 5） */
  giProcessingStep?: number;
  /** 每克纤维 GI 减量（默认 2） */
  giFiberReduction?: number;
  /** 纤维 GI 减量上限（默认 15） */
  giFiberReductionCap?: number;

  // ── V6.8 NRF 9.3 Gap Bonus 参数 ──

  /** 最低 %DV 才触发 bonus（默认 15） */
  nrfGapThreshold?: number;
  /** 单营养素最大 bonus（默认 20） */
  nrfGapMaxBonus?: number;
  /** 总 bonus 上限（默认 80） */
  nrfGapTotalCap?: number;
  /** 是否启用连续函数（默认 true）；false 则使用 V6.7 二值逻辑 */
  nrfGapContinuous?: boolean;

  // ── V6.8 NOVA 微调参数 ──

  /** 高纤维缓解阈值 g/100g（默认 3） */
  novaHighFiberThreshold?: number;
  /** 高纤维缓解量（默认 0.05） */
  novaHighFiberRelief?: number;
  /** 低糖缓解阈值 g（默认 5） */
  novaLowSugarThreshold?: number;
  /** 低糖缓解量（默认 0.05） */
  novaLowSugarRelief?: number;
  /** 低饱和脂肪缓解阈值 g（默认 3） */
  novaLowSatFatThreshold?: number;
  /** 低饱和脂肪缓解量（默认 0.05） */
  novaLowSatFatRelief?: number;
  /** 高钠加重阈值 mg（默认 800） */
  novaHighSodiumThreshold?: number;
  /** 高钠加重量（默认 0.05） */
  novaHighSodiumPenalty?: number;
  /** NOVA 3/4 最小惩罚 clamp（默认 [0.75, 0.45]） */
  novaClampMin?: [number, number];
  /** NOVA 3/4 最大惩罚 clamp（默认 [0.95, 0.7]） */
  novaClampMax?: [number, number];

  // ── V6.8 炎症公式参数 ──

  /** 反式脂肪促炎除数（默认 2） */
  inflammTransFatDiv?: number;
  /** 反式脂肪促炎上限（默认 50） */
  inflammTransFatMax?: number;
  /** 饱和脂肪促炎除数（默认 10） */
  inflammSatFatDiv?: number;
  /** 饱和脂肪促炎上限（默认 30） */
  inflammSatFatMax?: number;
  /** 抗炎纤维除数（默认 5） */
  inflammFiberDiv?: number;
  /** 抗炎纤维上限（默认 40） */
  inflammFiberMax?: number;

  // ── V6.8 烹饪便利阈值 ──

  /** 快手菜阈值 分钟（默认 15） */
  cookTimeQuick?: number;
  /** 快手菜分数（默认 1.0） */
  cookTimeQuickScore?: number;
  /** 中等时间阈值 分钟（默认 30） */
  cookTimeMedium?: number;
  /** 中等时间分数（默认 0.8） */
  cookTimeMediumScore?: number;
  /** 长时间阈值 分钟（默认 60） */
  cookTimeLong?: number;
  /** 长时间分数（默认 0.5） */
  cookTimeLongScore?: number;
  /** 免烹饪分数（默认 0.8） */
  cookTimeZeroScore?: number;

  // ── V6.8 品类含水量估算 ──

  /** 品类含水量 map（默认 { veggie:90, fruit:85, ... }） */
  categoryWaterMap?: Record<string, number>;

  // ── V6.8 Lifestyle 调整参数 ──

  /** 高含水率阈值（默认 80） */
  lifestyleWaterHighThreshold?: number;
  /** 高含水率乘数（默认 0.8） */
  lifestyleWaterHighMultiplier?: number;
  /** 中含水率阈值（默认 60） */
  lifestyleWaterMedThreshold?: number;
  /** 中含水率乘数（默认 0.4） */
  lifestyleWaterMedMultiplier?: number;
  /** 色氨酸丰富食物标签列表 */
  lifestyleTryptophanTags?: string[];

  // ── V6.8 替换营养接近度权重 ──

  /** 替换服务的多维营养接近度权重 */
  substitutionWeights?: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    gi: number;
    micronutrients: number;
  };

  // ── V6.8 杂项默认值 ──

  /** 品质分默认值（默认 5） */
  defaultQualityScore?: number;
  /** 饱腹分默认值（默认 4） */
  defaultSatietyScore?: number;
  /** 默认餐次热量目标（默认 400） */
  defaultMealCalorieTarget?: number;
  /** calories=0 时碳水/脂肪默认分（默认 0.5） */
  defaultCarbFatScore?: number;
  /** 默认置信度（默认 0.5） */
  defaultConfidence?: number;
  /** 添加糖惩罚上限（默认 -15） */
  maxAddedSugarPenalty?: number;
  /** 区间外惩罚陡度（默认 2） */
  rangeOutPenaltySteepness?: number;

  // ────────────────────────────────────────────────────
  // V6.9 新增参数（全部可选）
  // ────────────────────────────────────────────────────

  // ── V6.9 Phase 2-A: 跨餐多样性惩罚参数 ──

  /** 跨餐多样性惩罚配置 */
  crossMealDiversityPenalties?: {
    /** 名称完全重复惩罚（默认 -0.3） */
    nameDuplicate?: number;
    /** 主食材重复惩罚（默认 -0.2） */
    mainIngredientDuplicate?: number;
    /** 品类过度使用惩罚（默认 -0.15） */
    categoryOveruse?: number;
    /** 烹饪方式过度使用惩罚（默认 -0.1） */
    cookingMethodOveruse?: number;
    /** 品类过度使用阈值（默认 3） */
    categoryThreshold?: number;
    /** 烹饪方式过度使用阈值（默认 2） */
    cookingMethodThreshold?: number;
    /** 惩罚下限（默认 -0.5） */
    minPenalty?: number;
  };

  // ────────────────────────────────────────────────────
  // V7.5 新增: 推荐调参配置（pipeline / assembly / factor 层魔数）
  // ────────────────────────────────────────────────────

  /** V7.5: 推荐系统调参配置 — 覆盖 pipeline / assembly / factor / constraint 层的硬编码常量 */
  tuning?: RecommendationTuningConfig;
}

// ==================== V7.5 P3-A: 推荐系统调参配置 ====================

/**
 * V7.5 P3-A: 推荐系统调参配置
 *
 * 将散落在 10+ 个文件中的 60+ 个硬编码常量集中到此接口，
 * 所有字段可选，未提供时使用 ScoringConfigService.getDefaults().tuning 中的默认值。
 *
 * 分组：
 * - assembly:     MealAssembler 相似度 / 搭配评分
 * - pipeline:     PipelineBuilder 优化器 / 多样性 / 食物形态
 * - constraint:   ConstraintGenerator 缺口阈值 / 卡路里上限
 * - factor:       ScoringChain 各 Factor 的阈值 / 系数
 * - scorer:       FoodScorer 中尚未被 ScoringConfigSnapshot 覆盖的残余参数
 */
export interface RecommendationTuningConfig {
  // ── MealAssembler ──

  /** 食物相似度子权重 */
  similarityWeights?: {
    /** 同品类权重（默认 0.3） */
    category?: number;
    /** 同主食材权重（默认 0.5） */
    mainIngredient?: number;
    /** 同子品类权重（默认 0.2） */
    subCategory?: number;
    /** 每个共同标签权重（默认 0.05） */
    tagOverlap?: number;
  };
  /** 多样性选择时的相似度惩罚系数（默认 0.3） */
  diversitySimilarityPenalty?: number;
  /** 搭配好评加分（默认 0.05） */
  compatibilityGoodBonus?: number;
  /** 搭配差评扣分（默认 -0.1） */
  compatibilityBadPenalty?: number;
  /** 搭配分 clamp 下限（默认 -0.15） */
  compatibilityClampMin?: number;
  /** 搭配分 clamp 上限（默认 0.15） */
  compatibilityClampMax?: number;

  // ── PipelineBuilder ──

  /** 每角色优化器候选上限（默认 8） */
  optimizerCandidateLimit?: number;
  /** 高多样性模式的多样性乘数（默认 1.5） */
  diversityHighMultiplier?: number;
  /** 低多样性模式的多样性乘数（默认 0.5） */
  diversityLowMultiplier?: number;
  /** 基础探索率（用于 rateScale 计算，默认 0.15） */
  baseExplorationRate?: number;
  /** 成品菜在外出场景的 dishPriority 除数（默认 500） */
  dishPriorityDivisorScene?: number;
  /** 成品菜在非外出场景的 dishPriority 除数（默认 1000） */
  dishPriorityDivisorNormal?: number;
  /** 半成品在外出场景的乘数（默认 1.08） */
  semiPreparedMultiplierScene?: number;
  /** 半成品在非外出场景的乘数（默认 1.03） */
  semiPreparedMultiplierNormal?: number;
  /** 原材料在外出场景的乘数（默认 0.9） */
  ingredientMultiplierScene?: number;
  /** 原材料在非外出场景的乘数（默认 0.85） — Bug5-fix */
  ingredientMultiplierNormal?: number;
  /** 冲突解决最大轮数（默认 3） */
  conflictMaxRounds?: number;
  /** 食材多样性冲突阈值（默认 60） */
  ingredientDiversityThreshold?: number;
  /** 烹饪方式多样性冲突阈值（默认 50） */
  cookingMethodDiversityThreshold?: number;

  // ── ConstraintGenerator ──

  /** 蛋白质缺口触发 high_protein 标签的阈值 g（默认 30） */
  proteinGapThreshold?: number;
  /** 卡路里缺口触发 low_calorie 标签的阈值 kcal（默认 300） */
  calorieGapThreshold?: number;
  /** 卡路里上限放宽系数（默认 1.15） */
  calorieCeilingMultiplier?: number;
  /** 暴食风险时段卡路里紧缩系数（默认 0.98） */
  bingeRiskCalorieMultiplier?: number;
  /** 最低蛋白质占目标比例（默认 0.5） */
  minProteinRatio?: number;

  // ── SceneContextFactor ──

  /** 场景 boost clamp 下限（默认 0.8） */
  sceneBoostClampMin?: number;
  /** 场景 boost clamp 上限（默认 1.2） */
  sceneBoostClampMax?: number;

  // ── AnalysisProfileFactor ──

  /** 品类兴趣每次计数的 boost 增量（默认 0.02） */
  categoryInterestPerCount?: number;
  /** 品类兴趣 boost 上限（默认 0.08） */
  categoryInterestCap?: number;
  /** 风险食物惩罚乘数（默认 0.7） */
  riskFoodPenalty?: number;

  // ── PreferenceSignalFactor ──

  /** 声明偏好每个匹配的 boost（默认 0.05） */
  declaredPrefPerMatch?: number;
  /** 声明偏好 boost 上限（默认 0.15） */
  declaredPrefCap?: number;

  // ── LifestyleBoostFactor ──

  /** 含水率高阈值（默认 80） — factor 层使用，区别于 ScoringConfig 的 lifestyleWaterHighThreshold */
  factorWaterHighThreshold?: number;
  /** 营养 boost clamp 下限（默认 0.85） */
  nutrientBoostClampMin?: number;
  /** 营养 boost clamp 上限（默认 1.15） */
  nutrientBoostClampMax?: number;
  /** 营养 boost 每单位累积增量的乘数（默认 0.05） */
  nutrientBoostDeltaMultiplier?: number;

  // ── ShortTermProfileFactor ──

  /** 短期画像最小交互数（默认 3） */
  shortTermMinInteractions?: number;

  // ── PopularityFactor ──

  /** 人气归一化除数（默认 100） */
  popularityNormalizationDivisor?: number;

  // ── FoodScorer 残余参数 ──

  /** 菜系权重 boost 系数（默认 0.2） */
  cuisineWeightBoostCoeff?: number;
  /** 渠道匹配 bonus（默认 0.1） */
  channelMatchBonus?: number;
  /** 获取难度评分映射 */
  acquisitionScoreMap?: Record<number, number>;
}

// ==================== V6.7 Phase 1-A: ScoringContext ====================

/**
 * V6.7 Phase 1-A: 统一评分上下文
 *
 * 替代 scoreFoodDetailed 的 12 个位置参数。
 * 将所有评分所需的外部信号封装为单一对象，新增信号只需扩展此接口，
 * 无需修改 scorer 签名和所有调用处。
 */
export interface ScoringContext {
  /** 待评分食物 */
  food: FoodLibrary;
  /** 目标类型 */
  goalType: string;
  /** 餐次营养目标 */
  target?: MealTarget;
  /** 健康修正上下文（过敏原、健康状况等） */
  penaltyContext?: HealthModifierContext;
  /** 餐次类型 */
  mealType?: string;
  /** 用户状态标记（如 'plateau', 'low_protein'） */
  statusFlags?: string[];
  /** 在线学习权重覆盖 */
  weightOverrides?: number[] | null;
  /** A/B 实验组餐次权重覆盖 */
  mealWeightOverrides?: Record<string, Record<string, number>> | null;
  /** 策略引擎排序策略配置 */
  rankPolicy?: RankPolicyConfig | null;
  /** 用户营养缺口列表 */
  nutritionGaps?: string[] | null;
  /** 健康修正请求级缓存 */
  healthModifierCache?: Map<string, HealthModifierResult>;
  /** 个性化营养目标 */
  nutritionTargets?: NutritionTargets | null;
  /** V6.7: 生活方式营养素优先级调整（waterContent、tryptophan 等信号） */
  lifestyleAdjustment?: LifestyleNutrientAdjustment | null;
  /** V6.7: 评分参数快照（Phase 1-B 实现，1-A 阶段 optional） */
  scoringConfig?: ScoringConfigSnapshot | null;
  /** V6.9 Phase 1-D: 当前获取渠道（用于 popularity 维度评分） */
  channel?: AcquisitionChannel;
  /** V7.0 Phase 3-C: 解析后的有效目标（含阶段权重调整） */
  effectiveGoal?: EffectiveGoal;
  /** V7.0 Phase 3-C: 用户偏好画像（菜系权重、口味偏好等） */
  preferencesProfile?: PreferencesProfile;
  /** V7.1 P3-C: 统一偏好信号（由 PreferenceProfileService.computePreferenceSignal 计算） */
  preferenceSignal?: PreferenceSignal;
  /** P0-3: 当日完整营养目标（四宏量），用于动态派生 MACRO_RANGES 奖励区间，
   *  修复 "MACRO_RANGES 硬编码与用户目标冲突导致 fat +73%" 的 Bug */
  dailyTarget?: MealTarget;
  /**
   * 区域+时区优化（阶段 1.2）：
   * 用户本地当前月份 1-12，由 PipelineContextFactory 基于 timezone 计算后传入
   * SeasonalityService.getSeasonalityScore，避免使用服务器时区。
   * P0-R2: 必填，禁止 fallback。
   */
  currentMonth: number;
  /**
   * P3-3.4：用户区域码（如 'AU' / 'AU-NSW' / 'CN-31'），
   * 透传给 SeasonalityService 用于南半球月份翻转判定。
   * 未提供时按北半球（不翻转）处理。
   */
  regionCode?: string | null;
}
