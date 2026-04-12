import { FoodLibrary } from '../../../food/food.types';
import { GoalType } from '../nutrition-score.service';
import { ScoringExplanation } from './scoring-explanation.interface';
import { ShortTermProfile } from '../../../user/app/realtime-profile.service';
import { ScoredRecipe } from '../../../recipe/recipe.types';
import {
  ResolvedStrategy,
  RankPolicyConfig,
} from '../../../strategy/strategy.types';
import { ContextualProfile } from '../../../user/app/contextual-profile.service';
import { AnalysisShortTermProfile } from '../../../food/app/analysis-event.listener';
import type { MealCompositionExplanation } from './explanation-generator.service';
import type { HealthModifierContext } from './health-modifier-engine.service';
import type { HealthModifierResult } from './health-modifier-engine.service';
import type { NutritionTargets } from './nutrition-target.service';
import type { LifestyleNutrientAdjustment } from './lifestyle-scoring-adapter.service';
import type { EffectiveGoal } from '../../../user/app/goal-phase.service';
import type { GoalProgress } from '../../../user/app/goal-tracker.service';
import type { DomainProfiles } from '../../../user/domain/profile-factory';
import type { PreferencesProfile } from '../../../user/domain/preferences-profile';
import type { KitchenProfile } from '../../../user/user.types';

// ==================== 类型 ====================

// -------------------- V6.9 Phase 1-A: 场景化推荐 --------------------

/**
 * V6.9 Phase 1-A: 场景类型枚举
 *
 * 12 种用餐场景，由 SceneResolver 根据 (渠道 × 餐次 × 行为学习) 推断。
 * 每种场景携带默认的时间/烹饪/标签约束（见 SceneConstraints）。
 */
export type SceneType =
  | 'quick_breakfast'
  | 'leisurely_brunch'
  | 'office_lunch'
  | 'home_cooking'
  | 'eating_out'
  | 'convenience_meal'
  | 'canteen_meal'
  | 'post_workout'
  | 'late_night_snack'
  | 'family_dinner'
  | 'meal_prep'
  | 'general';

/**
 * V6.9 Phase 1-A: 场景约束
 *
 * 每种 SceneType 对应一组默认约束（可被 ScoringConfigSnapshot 覆盖）。
 * 约束字段均为可选 — null 表示"不限制"。
 */
export interface SceneConstraints {
  /** 最大备料时间（分钟），null=不限 */
  maxPrepTime?: number | null;
  /** 最大烹饪时间（分钟），null=不限 */
  maxCookTime?: number | null;
  /** 偏好的烹饪方式 */
  preferredCookingMethods?: string[];
  /** 偏好的食物标签 */
  preferredTags?: string[];
  /** 排除的食物标签 */
  excludedTags?: string[];
  /** 份数（1=单人，3=家庭，5=批量备餐） */
  servingCount?: number;
  /** 是否要求便携（如带饭） */
  portable?: boolean;
}

/**
 * V6.9 Phase 1-A: 场景上下文
 *
 * SceneResolver.resolve() 的返回值。
 * 替代原有的 AcquisitionChannel 单一值，包含渠道+场景+置信度+约束。
 * 下游消费者：RealisticFilter、FoodScorer(executability)、ExplanationGenerator。
 */
export interface SceneContext {
  /** 获取渠道 */
  channel: AcquisitionChannel;
  /** 场景类型 */
  sceneType: SceneType;
  /** 现实性严格度 — strict: 严格过滤 / normal: 标准 / relaxed: 宽松 / off: 关闭 (V7.2) */
  realismLevel: RealismLevel;
  /** 推断置信度 [0,1]，<0.6 时应退化到 'general' */
  confidence: number;
  /** 推断来源 */
  source: 'user_explicit' | 'behavior_learned' | 'rule_inferred' | 'default';
  /** 该场景下的食物约束 */
  sceneConstraints: SceneConstraints;
}

// -------------------- END V6.9 Phase 1-A --------------------

// -------------------- V6.9 Phase 1-C: 渠道可获得性 --------------------

/**
 * V6.9 Phase 1-C: 渠道可获得性评分结果
 *
 * 由 AvailabilityScorerService 计算。
 * 替代静态 commonalityScore，提供渠道感知的可获得性。
 */
export interface AvailabilityScore {
  /** 在当前渠道下的可获得性 0-1（0=几乎买不到，1=随处可见） */
  channelAvailability: number;
  /** 综合可获得性（考虑渠道+季节+地区，Phase 3-E 扩展） */
  overallAvailability: number;
  /** 评分来源: food_data=食物有渠道标注, channel_default=渠道×品类矩阵, regional_enhanced=区域/季节增强, time_aware=时段感知, time_region_enhanced=时段+区域综合, fallback=兜底 */
  source:
    | 'food_data'
    | 'channel_default'
    | 'regional_enhanced'
    | 'time_aware'
    | 'time_region_enhanced'
    | 'fallback';
}

// -------------------- END V6.9 Phase 1-C --------------------

// -------------------- V6.9 Phase 2-A: 跨餐多样性上下文 --------------------

/**
 * V6.9 Phase 2-A: 日计划状态
 *
 * 在推荐多餐时追踪已推荐食物，对跨餐重复施加惩罚。
 * 由 DailyPlanContextService 管理生命周期（createEmpty → updateAfterMeal）。
 */
export interface DailyPlanState {
  /** 当日已推荐的食物 ID 集合 */
  usedFoodIds: Set<string>;
  /** 当日已推荐的食物名集合 */
  usedFoodNames: Set<string>;
  /** 当日已推荐的品类计数 */
  categoryCounts: Record<string, number>;
  /** 当日已推荐的烹饪方式计数 */
  cookingMethodCounts: Record<string, number>;
  /** 当日已推荐的主食材集合 */
  usedMainIngredients: Set<string>;
  /** 当日已累计的营养素 */
  accumulatedNutrition: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
  };

  // ─── V7.1 Phase 1-D: 多样性追踪扩展 ───

  /** V7.1: 风味统计（spicy, sweet, sour, savory, bland 等） */
  flavorCounts: Record<string, number>;
  /** V7.1: 温度统计（hot, cold, warm, room_temp） */
  temperatureCounts: Record<string, number>;
  /** V7.1: 已用菜系集合（用于跨餐菜系多样性） */
  usedCuisines: Set<string>;
  /** V7.1: 已完成餐数（用于跨餐联动计算） */
  mealCount: number;
}

// -------------------- END V6.9 Phase 2-A --------------------

// -------------------- V6.9 Phase 2-B: 结构化可解释性 --------------------

/**
 * V6.9 Phase 2-B: 洞察类型枚举
 */
export type InsightType =
  | 'nutrient_contribution' // 营养素贡献（如"提供 35% 蛋白质目标"）
  | 'goal_alignment' // 目标匹配度（如"符合减脂低碳策略"）
  | 'health_benefit' // 健康收益（如"富含膳食纤维，有助消化"）
  | 'diversity_note' // 多样性提示（如"今日首次出现海鲜类"）
  | 'scene_match' // 场景匹配（如"适合快手早餐，仅需 10 分钟"）
  | 'execution_tip' // 执行建议（如"可在前一天晚上备好食材"）
  | 'goal_progress' // V7.0 Phase 3-D: 目标进度洞察（如"已完成减脂阶段 85%"）
  | 'substitution_rationale' // V7.1 方向 4A: 替换解释（如"你常用烤鸡胸替代煎鸡胸"）
  | 'cross_meal_context' // V7.1 方向 4A: 跨餐补偿（如"午餐蛋白不足，晚餐加强"）
  | 'actionable_tip' // V7.1 方向 4A: 行动建议（如"建议搭配一份绿叶蔬菜"）
  | 'contrastive'; // V7.1 方向 4B: 对比解释（如"推荐 A 而非 B，因为..."）

/**
 * V6.9 Phase 2-B: 洞察可视化数据
 */
export interface InsightVisualization {
  /** 可视化类型 */
  chartType: 'progress_bar' | 'pie_chart' | 'comparison' | 'badge';
  /** 可视化数据 */
  data: Record<string, number | string>;
}

/**
 * V6.9 Phase 2-B: 结构化推荐洞察
 *
 * 在现有自然语言解释基础上，输出结构化的 insights 数据，前端可做可视化展示。
 */
export interface StructuredInsight {
  /** 洞察类型 */
  type: InsightType;
  /** 洞察标题（i18n key） */
  titleKey: string;
  /** 洞察内容（i18n key + vars） */
  contentKey: string;
  /** 模板变量 */
  vars: Record<string, string | number>;
  /** 可视化数据（可选） */
  visualization?: InsightVisualization;
  /** 重要性 0-1 */
  importance: number;
}

// -------------------- END V6.9 Phase 2-B --------------------

/**
 * V6.4 Phase 3.2: 食物获取渠道枚举
 * 用于场景化推荐 — 根据用户当前场景过滤可获取的食物/菜谱
 */
export enum AcquisitionChannel {
  /** 在家烹饪 */
  HOME_COOK = 'home_cook',
  /** 餐厅堂食 */
  RESTAURANT = 'restaurant',
  /** 外卖配送 */
  DELIVERY = 'delivery',
  /** 便利店/即食 */
  CONVENIENCE = 'convenience',
  /** 食堂/团餐（V6.6 Phase 2-D） */
  CANTEEN = 'canteen',
  /** 未知/不限 */
  UNKNOWN = 'unknown',
}

/** 所有有效渠道值（用于校验） */
export const ALL_CHANNELS: AcquisitionChannel[] =
  Object.values(AcquisitionChannel);

/**
 * V6.4 Phase 3.2: 根据用户画像推断当前最可能的获取渠道
 *
 * 推断逻辑优先级:
 * 1. 显式传入的 channel 参数（客户端指定）
 * 2. 上下文画像场景推断（工作日午餐 → delivery/restaurant，周末 → home_cook）
 * 3. 用户声明的 canCook + takeoutFrequency
 * 4. 默认 unknown（不过滤）
 */
export function inferAcquisitionChannel(
  explicitChannel?: string | null,
  contextualProfile?: { scene?: string; dayType?: string } | null,
  declaredProfile?: {
    canCook?: boolean;
    takeoutFrequency?: string;
    /** V6.6 Phase 2-D: 主要用餐地点（'canteen'|'home'|'restaurant' 等） */
    primaryEatingLocation?: string | null;
  } | null,
  mealType?: string,
): AcquisitionChannel {
  // 1. 显式指定
  if (
    explicitChannel &&
    ALL_CHANNELS.includes(explicitChannel as AcquisitionChannel)
  ) {
    return explicitChannel as AcquisitionChannel;
  }

  // 2. 食堂场景推断（V6.6 Phase 2-D）：
  //    用户声明主要用餐地点为食堂，或工作日午餐且未开启外卖
  if (declaredProfile?.primaryEatingLocation === 'canteen') {
    return AcquisitionChannel.CANTEEN;
  }

  // 3. 上下文场景推断
  if (contextualProfile) {
    const { scene, dayType } = contextualProfile;
    const isWeekend = dayType === 'weekend';

    // 工作日午餐/晚餐 → 大概率外卖或餐厅
    if (!isWeekend && (mealType === 'lunch' || mealType === 'dinner')) {
      if (scene === 'working') return AcquisitionChannel.DELIVERY;
    }

    // 深夜场景 → 便利店/外卖
    if (scene === 'late_night') return AcquisitionChannel.CONVENIENCE;

    // 周末 → 在家烹饪概率高
    if (
      isWeekend &&
      (mealType === 'breakfast' ||
        mealType === 'lunch' ||
        mealType === 'dinner')
    ) {
      return AcquisitionChannel.HOME_COOK;
    }
  }

  // 4. 声明画像推断
  if (declaredProfile) {
    const { canCook, takeoutFrequency } = declaredProfile;
    if (canCook === false) return AcquisitionChannel.DELIVERY;
    if (takeoutFrequency === 'always' || takeoutFrequency === 'often') {
      return AcquisitionChannel.DELIVERY;
    }
    if (
      canCook &&
      (takeoutFrequency === 'rarely' || takeoutFrequency === 'never')
    ) {
      return AcquisitionChannel.HOME_COOK;
    }
  }

  // 5. 默认不限
  return AcquisitionChannel.UNKNOWN;
}

/**
 * 标准健康状况枚举 (V4)
 * 统一 constraint-generator 和 health-modifier-engine 使用的健康状况命名
 */
export enum HealthCondition {
  DIABETES_TYPE2 = 'diabetes_type2',
  HYPERTENSION = 'hypertension',
  HYPERLIPIDEMIA = 'hyperlipidemia',
  GOUT = 'gout',
  KIDNEY_DISEASE = 'kidney_disease',
  FATTY_LIVER = 'fatty_liver',
  /** V5 2.8: 乳糜泻（麸质不耐受） */
  CELIAC_DISEASE = 'celiac_disease',
  /** V5 2.8: 肠易激综合征 */
  IBS = 'ibs',
  /** V5 2.8: 缺铁性贫血 */
  IRON_DEFICIENCY_ANEMIA = 'iron_deficiency_anemia',
  /** V5 2.8: 骨质疏松症 */
  OSTEOPOROSIS = 'osteoporosis',
}

/**
 * 旧命名 → 标准命名映射（向后兼容）
 * 用于读取 DB 中已存储的旧格式值
 */
export const HEALTH_CONDITION_ALIASES: Record<string, HealthCondition> = {
  diabetes: HealthCondition.DIABETES_TYPE2,
  diabetes_type2: HealthCondition.DIABETES_TYPE2,
  hypertension: HealthCondition.HYPERTENSION,
  high_cholesterol: HealthCondition.HYPERLIPIDEMIA,
  hyperlipidemia: HealthCondition.HYPERLIPIDEMIA,
  gout: HealthCondition.GOUT,
  kidney_disease: HealthCondition.KIDNEY_DISEASE,
  fatty_liver: HealthCondition.FATTY_LIVER,
  // V5 2.8: 新增健康条件别名
  celiac_disease: HealthCondition.CELIAC_DISEASE,
  celiac: HealthCondition.CELIAC_DISEASE,
  gluten_intolerance: HealthCondition.CELIAC_DISEASE,
  ibs: HealthCondition.IBS,
  irritable_bowel: HealthCondition.IBS,
  iron_deficiency_anemia: HealthCondition.IRON_DEFICIENCY_ANEMIA,
  anemia: HealthCondition.IRON_DEFICIENCY_ANEMIA,
  iron_deficiency: HealthCondition.IRON_DEFICIENCY_ANEMIA,
  osteoporosis: HealthCondition.OSTEOPOROSIS,
};

/**
 * 将可能的旧命名标准化为 HealthCondition 枚举值
 */
export function normalizeHealthCondition(raw: string): HealthCondition | null {
  return HEALTH_CONDITION_ALIASES[raw] ?? null;
}

/**
 * 将健康状况列表标准化（去重 + 过滤无效值）
 */
export function normalizeHealthConditions(raw: string[]): HealthCondition[] {
  const result = new Set<HealthCondition>();
  for (const r of raw) {
    const normalized = normalizeHealthCondition(r);
    if (normalized) result.add(normalized);
  }
  return [...result];
}

export interface MealTarget {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  /** V5 2.2: 膳食纤维目标 (g)，可选 */
  fiber?: number;
  /** V5 2.2: 血糖负荷上限 (GL)，可选 */
  glycemicLoad?: number;
}

export interface Constraint {
  includeTags: string[];
  excludeTags: string[];
  maxCalories: number;
  minProtein: number;
  /** V6.8 Phase 3-A: 用户健康状况（用于硬约束排除） */
  healthConditions?: string[];
  /** V6.8 Phase 3-A: 就餐渠道（外卖/便利店/在家做） */
  channel?: string;
  /** V6.8 Phase 3-A: 用户烹饪技能等级（1-5） */
  skillLevel?: number;
}

export interface ScoredFood {
  food: FoodLibrary;
  score: number;
  /** 按标准份量计算的营养 */
  servingCalories: number;
  servingProtein: number;
  servingFat: number;
  servingCarbs: number;
  /** V5 2.2: 按标准份量计算的膳食纤维 (g) */
  servingFiber: number;
  /** V5 2.2: 该食物的血糖负荷 (GL)，来自 food.glycemicLoad */
  servingGL: number;
  /** V4: 评分解释（仅对 Top-K 食物生成） */
  explanation?: ScoringExplanation;
}

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
  factorAdjustments?: import('./factor-learner.service').FactorAdjustmentMap;
}

export interface MealRecommendation {
  foods: ScoredFood[];
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  displayText: string;
  tip: string;
  /** V6.3 P3-1: 整餐层面的搭配解释 */
  /** V6.5 Phase 2E: 升级为结构化整餐分析 */
  mealExplanation?: MealCompositionExplanation;
  /** V5 2.1: 该餐的候选池（所有角色的 Top-N 合并），供全局优化器替换用 */
  candidates?: ScoredFood[];
  /** V6.5 Phase 2D: 整餐组合评分 */
  compositionScore?: {
    ingredientDiversity: number;
    cookingMethodDiversity: number;
    /** V6.7 Phase 1-D: 替代原 flavorBalance */
    flavorHarmony: number;
    nutritionComplementarity: number;
    /** V6.7 Phase 2-C: 质感多样性 */
    textureDiversity: number;
    overall: number;
  };
  /** V6.8 Phase 3-F: 管道降级记录（如有阶段降级则记录） */
  degradations?: PipelineDegradation[];
  /** V6.9 Phase 1-B: 菜谱方案（如果成功组装） */
  recipes?: AssembledRecipe[];
  /** V6.9 Phase 1-B: 方案主题标签（如 "快手早餐"、"家常菜"） */
  planTheme?: string;
  /** V6.9 Phase 1-B: 执行难度 0-1（0=零准备，1=专业厨师级） */
  executionDifficulty?: number;
  /** V6.9 Phase 2-B: 结构化洞察列表 */
  insights?: StructuredInsight[];
  /** V7.0 Phase 3-D: 目标进度提示（如 "本周热量合规率 92%，继续保持"） */
  goalProgressTip?: string;
  /** V7.0 Phase 3-D: 阶段转换提示（如 "减脂期第 3 周，即将进入维持期"） */
  phaseTransitionHint?: string;
  /** V7.3 P3-D: 使用的模板 ID（如果匹配到模板） */
  templateId?: string;
  /** V7.3 P3-D: 每道菜的自然语言推荐理由 */
  dishExplanations?: Array<{
    primaryReason: string;
    nutritionNote?: string;
    sceneNote?: string;
    narrative: string;
  }>;
}

/**
 * V6.9 Phase 1-B: 组装后的菜谱方案
 *
 * 由 RecipeAssemblerService 生成。可以是：
 * - 数据库匹配的菜谱（isAssembled=false）：食材匹配率 >= 60%
 * - 智能组装方案（isAssembled=true）：基于食材角色模板自动生成
 */
export interface AssembledRecipe {
  /** 菜谱 ID（如果匹配到数据库菜谱） */
  recipeId?: string;
  /** 菜谱名称 */
  name: string;
  /** 组成食材（来自 ScoredFood） */
  ingredients: ScoredFood[];
  /** 总热量 */
  totalCalories: number;
  /** 总蛋白质 */
  totalProtein: number;
  /** 预估烹饪时间（分钟） */
  estimatedCookTime: number;
  /** 所需技能等级 */
  skillLevel: string;
  /** 适合的渠道 */
  suitableChannels: AcquisitionChannel[];
  /** 菜谱评分（综合营养+可执行性+匹配度） */
  recipeScore: number;
  /** 是否是智能组装的（vs 数据库匹配的） */
  isAssembled: boolean;
  /** V7.3 P2-D: 菜谱营养聚合（组合食材的总营养） */
  recipeNutrition?: RecipeNutrition;
}

/**
 * V7.3 P2-D: 菜谱组合营养数据
 *
 * 将菜谱中所有食材的营养素按份量加权聚合。
 * 所有值基于食材的实际用量（非 per 100g）。
 */
export interface RecipeNutrition {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  sodium: number;
  saturatedFat: number;
  transFat: number;
  sugar: number;
  addedSugar: number;
  vitaminA: number;
  vitaminC: number;
  vitaminD: number;
  vitaminE: number;
  calcium: number;
  iron: number;
  potassium: number;
  zinc: number;
  magnesium: number;
  cholesterol: number;
}

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
    /** V6.8 Phase 1-B: 运动强度（'low'|'medium'|'high'） */
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
 * V6.8 Phase 3-F: 管道阶段降级记录
 *
 * 当管道的某个阶段（Recall/Rank/Rerank 等）执行失败时，
 * 记录降级信息供 trace/调试使用，而不是让整个推荐流程崩溃。
 */
export interface PipelineDegradation {
  /** 降级的管道阶段 */
  stage: string;
  /** 降级原因（错误信息） */
  reason: string;
  /** 使用的降级策略 */
  fallbackUsed: string;
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
  /** V6.8 Phase 3-B: 运动强度 */
  exerciseIntensity?: 'none' | 'light' | 'moderate' | 'high' | null;
  /** V6.8 Phase 3-B: 饮酒频率 */
  alcoholFrequency?: 'never' | 'occasional' | 'frequent' | null;
  /** V6.8 Phase 3-B: 年龄 */
  age?: number | null;
}

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

/**
 * 单个食物的反馈统计 — 用于 Thompson Sampling
 * α = accepted + 1 (Beta 先验)
 * β = rejected + 1 (Beta 先验)
 * 新食物无记录 → 默认 α=1, β=1 → Beta(1,1) = 均匀分布 → 最大探索
 */
export interface FoodFeedbackStats {
  accepted: number;
  rejected: number;
}

/**
 * 用户偏好画像 — 从 RecommendationFeedback 聚合统计
 * 每个维度记录接受率乘数 (0.3~1.3)：
 *   接受率高 → >1.0（加分）
 *   接受率低 → <1.0（减分）
 *   数据不足 → 不出现在 map 中
 */
export interface UserPreferenceProfile {
  /** 按分类（category）的接受率乘数 */
  categoryWeights: Record<string, number>;
  /** 按主料（mainIngredient）的接受率乘数 */
  ingredientWeights: Record<string, number>;
  /** 按食物组（foodGroup）的接受率乘数 */
  foodGroupWeights: Record<string, number>;
  /** 按食物名的偏好乘数（指数衰减加权，映射到 0.7~1.2） */
  foodNameWeights: Record<string, number>;
}

// ==================== 评分权重 ====================

/** 维度名称 — 与 SCORE_WEIGHTS 数组索引对应 (V6.9: 12→13维，新增 popularity) */
export const SCORE_DIMENSIONS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'quality',
  'satiety',
  'glycemic',
  'nutrientDensity',
  'inflammation',
  'fiber', // V5 2.6: 膳食纤维评分维度
  'seasonality', // V6.4 Phase 3.4: 时令感知评分维度
  'executability', // V6.5: 可执行性评分维度
  'popularity', // V6.9 Phase 1-D: 大众化/常见度评分维度
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/** 基础权重 — 按目标类型 (V6.9: 12→13 维，新增 popularity) */
export const SCORE_WEIGHTS: Record<GoalType, number[]> = {
  //                    [cal,  prot, carbs, fat,  qual, sat,  glyc, nDens, inflam, fiber, season, exec, popul]
  fat_loss: [
    0.15, 0.14, 0.07, 0.05, 0.05, 0.06, 0.1, 0.08, 0.06, 0.04, 0.03, 0.1, 0.07,
  ],
  muscle_gain: [
    0.14, 0.18, 0.09, 0.05, 0.05, 0.04, 0.08, 0.07, 0.04, 0.03, 0.03, 0.11,
    0.09,
  ],
  health: [
    0.06, 0.05, 0.04, 0.04, 0.13, 0.06, 0.09, 0.15, 0.09, 0.07, 0.05, 0.1, 0.07,
  ],
  habit: [
    0.09, 0.07, 0.05, 0.05, 0.11, 0.1, 0.07, 0.07, 0.06, 0.04, 0.04, 0.13, 0.12,
  ],
};

/**
 * 餐次权重修正系数
 * >1.0 表示该维度在此餐次更重要, <1.0 表示不太重要
 * 所有修正后会重新归一化
 */
export const MEAL_WEIGHT_MODIFIERS: Record<
  string,
  Partial<Record<ScoreDimension, number>>
> = {
  breakfast: {
    glycemic: 1.3, // 早餐血糖影响更大（空腹后第一餐）
    satiety: 1.2, // 早餐饱腹感重要（影响上午工作）
    calories: 0.9, // 早餐热量可以稍宽松
    fiber: 1.2, // V5 2.6: 早餐纤维有助于稳定上午血糖
  },
  lunch: {
    // 午餐基本保持基准权重
  },
  dinner: {
    calories: 1.2, // 晚餐更注重热量控制
    glycemic: 1.1, // 晚餐血糖稳定有助睡眠
    satiety: 0.8, // 晚餐饱腹感需求较低
    fiber: 1.1, // V5 2.6: 晚餐纤维有助消化健康
  },
  snack: {
    calories: 1.3, // 加餐热量严格控制
    quality: 1.2, // 加餐品质需要保证
    protein: 0.8, // 加餐蛋白质要求较低
    fiber: 0.8, // V5 2.6: 加餐纤维要求较低
  },
};

/**
 * 用户状态权重修正系数
 * 基于用户行为画像中的长期趋势触发
 */
export const STATUS_WEIGHT_MODIFIERS: Record<
  string,
  Partial<Record<ScoreDimension, number>>
> = {
  /** 体重平台期：严格热量+提高蛋白 */
  plateau: {
    calories: 1.3,
    protein: 1.2,
    quality: 0.9,
  },
  /** 长期蛋白不足 */
  low_protein: {
    protein: 1.4,
    satiety: 1.1,
  },
  /** 高加工倾向 */
  high_processed: {
    quality: 1.3,
    nutrientDensity: 1.2,
    inflammation: 1.2,
    fiber: 1.2, // V5 2.6: 高加工饮食通常缺纤维，提升纤维权重
  },
  /** 血糖波动大（如糖尿病前期/已确诊） */
  glycemic_risk: {
    glycemic: 1.5,
    calories: 1.1,
  },
};

/**
 * 计算三维叠加权重: BASE × MEAL_MODIFIER × STATUS_MODIFIER
 * 返回归一化后的权重数组 (和=1.0)
 *
 * V6 2.2: 新增 rankPolicy 参数，优先级: rankPolicy > baseOverrides > 系统默认
 * V6.2 3.2: 新增 runtimeBaseWeights 参数（运行时可配置权重）
 *
 * 合并规则:
 *   - baseWeights: rankPolicy.baseWeights[goalType] > baseOverrides > runtimeBaseWeights > SCORE_WEIGHTS[goalType]
 *   - mealModifiers: rankPolicy.mealModifiers[mealType] > mealWeightOverrides[mealType] > MEAL_WEIGHT_MODIFIERS[mealType]
 *   - statusModifiers: rankPolicy.statusModifiers[flag] > STATUS_WEIGHT_MODIFIERS[flag]
 *
 * @param goalType 目标类型
 * @param mealType 餐次（可选）
 * @param statusFlags 用户状态标记（可选）
 * @param baseOverrides A/B 实验组覆盖的基础权重（可选，Phase 3.8）
 * @param mealWeightOverrides A/B 实验组覆盖的餐次权重修正（可选，V5 4.8）
 * @param rankPolicy V6 2.2: 策略引擎的排序策略配置（优先级最高）
 * @param runtimeBaseWeights V6.2 3.2: 运行时配置的基础权重（优先级介于 baseOverrides 和硬编码之间）
 */
export function computeWeights(
  goalType: GoalType,
  mealType?: string,
  statusFlags?: string[],
  baseOverrides?: number[] | null,
  mealWeightOverrides?: Record<string, Record<string, number>> | null,
  rankPolicy?: RankPolicyConfig | null,
  runtimeBaseWeights?: number[] | null,
): number[] {
  // 基础权重优先级: rankPolicy.baseWeights > baseOverrides > runtimeBaseWeights > 系统硬编码
  const strategyBaseWeights = rankPolicy?.baseWeights?.[goalType];
  const base = strategyBaseWeights
    ? [...strategyBaseWeights]
    : baseOverrides
      ? [...baseOverrides]
      : runtimeBaseWeights
        ? [...runtimeBaseWeights]
        : [...(SCORE_WEIGHTS[goalType] || SCORE_WEIGHTS.health)];

  // 应用餐次修正 — V6 2.2: 优先级 rankPolicy.mealModifiers > mealWeightOverrides > 系统硬编码
  if (mealType) {
    const strategyMealMod = rankPolicy?.mealModifiers?.[mealType];
    const mealMod =
      strategyMealMod ??
      mealWeightOverrides?.[mealType] ??
      MEAL_WEIGHT_MODIFIERS[mealType];
    if (mealMod) {
      SCORE_DIMENSIONS.forEach((dim, i) => {
        if (mealMod[dim] !== undefined) {
          base[i] *= mealMod[dim]!;
        }
      });
    }
  }

  // 应用状态修正（多个状态可叠加）
  // V6 2.2: rankPolicy.statusModifiers 覆盖对应 flag 的系统默认修正
  if (statusFlags?.length) {
    for (const flag of statusFlags) {
      const strategyStatusMod = rankPolicy?.statusModifiers?.[flag];
      const statusMod = strategyStatusMod ?? STATUS_WEIGHT_MODIFIERS[flag];
      if (!statusMod) continue;
      SCORE_DIMENSIONS.forEach((dim, i) => {
        if (statusMod[dim] !== undefined) {
          base[i] *= statusMod[dim]!;
        }
      });
    }
  }

  // 重新归一化: 确保权重和 = 1.0
  const sum = base.reduce((s, w) => s + w, 0);
  if (sum > 0) {
    for (let i = 0; i < base.length; i++) {
      base[i] /= sum;
    }
  }

  return base;
}

// ==================== 食物品质/饱腹分推导 ====================

export const CATEGORY_QUALITY: Record<string, number> = {
  veggie: 8,
  fruit: 7,
  dairy: 7,
  protein: 6,
  grain: 5,
  composite: 4,
  snack: 2,
  beverage: 3,
  fat: 3,
  condiment: 3,
};

export const CATEGORY_SATIETY: Record<string, number> = {
  protein: 7,
  grain: 7,
  dairy: 6,
  veggie: 5,
  composite: 5,
  fruit: 3,
  snack: 2,
  beverage: 2,
  fat: 3,
  condiment: 1,
};

// ==================== 餐次偏好策略 ====================

/**
 * V4: 目标自适应宏量营养素评分范围 (修复 E2)
 * 不同目标类型使用不同的碳水/脂肪供能比理想范围
 */
export const MACRO_RANGES: Record<
  string,
  { carb: [number, number]; fat: [number, number] }
> = {
  fat_loss: { carb: [0.3, 0.45], fat: [0.2, 0.35] },
  muscle_gain: { carb: [0.4, 0.6], fat: [0.15, 0.3] },
  health: { carb: [0.45, 0.55], fat: [0.2, 0.3] },
  habit: { carb: [0.4, 0.55], fat: [0.2, 0.35] },
};

/**
 * V4: 目标自适应餐次比例 (修复 E3)
 * 不同目标类型使用不同的热量分配比例
 */
export const MEAL_RATIOS: Record<string, Record<string, number>> = {
  fat_loss: { breakfast: 0.3, lunch: 0.35, dinner: 0.25, snack: 0.1 },
  muscle_gain: { breakfast: 0.25, lunch: 0.3, dinner: 0.25, snack: 0.2 },
  health: { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 },
  habit: { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 },
};

export const MEAL_PREFERENCES: Record<
  string,
  { includeTags: string[]; excludeTags: string[] }
> = {
  breakfast: {
    includeTags: ['breakfast', 'high_carb', 'easy_digest'],
    excludeTags: ['fried', 'heavy_flavor'],
  },
  lunch: {
    includeTags: ['balanced'],
    excludeTags: [],
  },
  dinner: {
    includeTags: ['low_carb', 'high_protein', 'light'],
    excludeTags: ['high_carb', 'dessert'],
  },
  snack: {
    includeTags: ['low_calorie', 'snack', 'fruit'],
    excludeTags: ['fried', 'high_fat'],
  },
};

// ==================== 角色模板 ====================

export const MEAL_ROLES: Record<string, string[]> = {
  breakfast: ['carb', 'protein', 'side'],
  lunch: ['carb', 'protein', 'veggie'],
  dinner: ['protein', 'veggie', 'side'],
  snack: ['snack1', 'snack2'],
};

export const ROLE_CATEGORIES: Record<string, string[]> = {
  carb: ['grain', 'composite'],
  protein: ['protein', 'dairy'],
  veggie: ['veggie'],
  side: ['veggie', 'dairy', 'beverage', 'fruit'],
  snack1: ['fruit', 'snack'],
  snack2: ['beverage', 'snack', 'fruit'],
};

// ==================== V5 2.7: 微量营养素品类均值插补 ====================

/**
 * 微量营养素默认值 — 用于插补缺失数据
 * 字段对应 NRF 11.4 评分所需的 11 个鼓励项和 4 个限制项中的微量元素
 */
export interface MicroNutrientDefaults {
  vitaminA: number; // ug RAE / 100g
  vitaminC: number; // mg / 100g
  vitaminD: number; // ug / 100g
  vitaminE: number; // mg / 100g
  calcium: number; // mg / 100g
  iron: number; // mg / 100g
  potassium: number; // mg / 100g
  fiber: number; // g / 100g
  zinc: number; // V7.3 NRF11.4: mg / 100g
  magnesium: number; // V7.3 NRF11.4: mg / 100g
}

/** 需要插补的微量营养素字段名列表 */
const MICRO_FIELDS: (keyof MicroNutrientDefaults)[] = [
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'calcium',
  'iron',
  'potassium',
  'fiber',
  'zinc',
  'magnesium',
];

/**
 * V5 2.7: 从食物列表构建品类微量营养素均值表
 *
 * 对每个 category，计算各微量营养素字段的均值（仅统计有数据的食物）。
 * 如果某个品类某字段完全没有数据，则使用全局均值。
 *
 * @param foods 食物库全量列表
 * @returns 品类 → 微量营养素均值映射
 */
export function buildCategoryMicroAverages(
  foods: FoodLibrary[],
): Map<string, MicroNutrientDefaults> {
  // 按品类分组
  const groups = new Map<string, FoodLibrary[]>();
  for (const food of foods) {
    const cat = food.category || 'unknown';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(food);
  }

  // 计算全局均值（作为兜底）
  const globalDefaults = calcGroupAverage(foods);

  // 计算每个品类的均值
  const result = new Map<string, MicroNutrientDefaults>();
  for (const [category, groupFoods] of groups) {
    const avg = calcGroupAverage(groupFoods);
    // 对没有数据的字段，回退到全局均值
    for (const field of MICRO_FIELDS) {
      if (avg[field] === 0) {
        avg[field] = globalDefaults[field];
      }
    }
    result.set(category, avg);
  }

  // 设置一个 'unknown' 兜底条目
  if (!result.has('unknown')) {
    result.set('unknown', globalDefaults);
  }

  return result;
}

/** 计算一组食物的微量营养素均值 */
function calcGroupAverage(foods: FoodLibrary[]): MicroNutrientDefaults {
  const sums: Record<keyof MicroNutrientDefaults, number> = {
    vitaminA: 0,
    vitaminC: 0,
    vitaminD: 0,
    vitaminE: 0,
    calcium: 0,
    iron: 0,
    potassium: 0,
    fiber: 0,
    zinc: 0,
    magnesium: 0,
  };
  const counts: Record<keyof MicroNutrientDefaults, number> = {
    vitaminA: 0,
    vitaminC: 0,
    vitaminD: 0,
    vitaminE: 0,
    calcium: 0,
    iron: 0,
    potassium: 0,
    fiber: 0,
    zinc: 0,
    magnesium: 0,
  };

  for (const food of foods) {
    for (const field of MICRO_FIELDS) {
      const val = Number(food[field]) || 0;
      if (val > 0) {
        sums[field] += val;
        counts[field]++;
      }
    }
  }

  const result = {} as MicroNutrientDefaults;
  for (const field of MICRO_FIELDS) {
    result[field] = counts[field] > 0 ? sums[field] / counts[field] : 0;
  }
  return result;
}

// ==================== V6.7 Phase 2-B: RecallMetadata ====================

/**
 * V6.7 Phase 2-B: 三路召回元数据
 *
 * 记录每个召回候选的来源信息，用于：
 * - RecallMerger 合并去重时确定 ruleWeight
 * - rankCandidates 阶段读取 semanticScore / cfScore 做精细化加分
 * - 调试追踪（recommendation-trace）
 */
export interface RecallMetadata {
  foodId: string;
  /** 候选来源集合：rule / semantic / cf */
  sources: Set<'rule' | 'semantic' | 'cf'>;
  /** 语义召回相似度 (0-1)，未命中则为 0 */
  semanticScore: number;
  /** CF 推荐分 (0-1)，未命中则为 0 */
  cfScore: number;
  /** 最终权重乘数（规则路 = 1.0，非规则路折扣） */
  ruleWeight: number;
}

/**
 * V6.7 Phase 2-B: CF 召回结果
 */
export interface CFRecallResult {
  foodId: string;
  cfScore: number;
}

// ==================== V6.7 Phase 1-A: ScoringContext ====================

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
}

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
}

// -------------------- V7.1 Phase 1-C: 新增类型定义 --------------------

/**
 * V7.1 方向 1A: 执行匹配结果
 *
 * 语义执行匹配的三级匹配结果，替代原有的纯 ID 精确匹配。
 * - exact:           食物 ID 完全一致 → 1.0
 * - same_ingredient: 主食材相同（如烤鸡胸 vs 煎鸡胸）→ 0.7
 * - same_category:   同品类（如不同蛋白质食物）→ 0.4
 * - same_food_group: 同食物组 → 0.2
 * - none:            完全不匹配 → 0.0
 */
export interface ExecutionMatchResult {
  /** 推荐的食物 ID */
  recommendedFoodId: string;
  /** 实际执行的食物 ID（none 时为 null） */
  executedFoodId: string | null;
  /** 匹配级别 */
  matchLevel:
    | 'exact'
    | 'same_ingredient'
    | 'same_category'
    | 'same_food_group'
    | 'none';
  /** 匹配得分 */
  matchScore: number;
}

/** V7.1 方向 1A: 匹配级别 → 得分映射 */
export const EXECUTION_MATCH_SCORES: Record<
  ExecutionMatchResult['matchLevel'],
  number
> = {
  exact: 1.0,
  same_ingredient: 0.7,
  same_category: 0.4,
  same_food_group: 0.2,
  none: 0.0,
};

/**
 * V7.1 方向 2A: 跨餐调整
 *
 * 基于前序餐次的营养累计，对后续餐次的推荐目标和权重进行补偿调整。
 * 由 DailyPlanContextService.computeCrossMealAdjustment() 产出。
 */
export interface CrossMealAdjustment {
  /** 热量目标倍数（0.9 ~ 1.15），1.0 = 不调整 */
  calorieMultiplier: number;
  /** 权重覆盖（仅包含需要调整的维度） */
  weightOverrides: Partial<Record<ScoreDimension, number>>;
  /** 菜系多样性加分（0 ~ 0.1），前餐菜系单一时触发 */
  cuisineDiversityBonus: number;
  /** 调整原因（用于可解释性） */
  reason: string;
}

/**
 * V7.1 方向 3B: 统一偏好信号
 *
 * 将 Thompson Sampling 探索信号和 PreferenceProfile 利用信号
 * 统一为一个综合信号，避免两套独立机制。
 */
export interface PreferenceSignal {
  /** Thompson Sampling 探索系数（Beta 分布采样） */
  explorationMultiplier: number;
  /** 品类偏好 boost（来自反馈统计，0.3 ~ 1.3） */
  categoryBoost: number;
  /** 食材偏好 boost（来自反馈统计，0.3 ~ 1.3） */
  ingredientBoost: number;
  /** 替换模式 boost（来自替换追踪，0 ~ 0.1） */
  substitutionBoost: number;
  /** 菜系偏好 boost（来自 PreferencesProfile，±10%） */
  cuisineBoost: number;
  /** 综合乘数 = 各信号加权合成 */
  combined: number;
}

/**
 * V7.1 方向 5B: 渠道时段可获得性
 *
 * 不同渠道在不同时段的可获得性分数，
 * 如：便利店深夜高，食堂深夜为 0，外卖凌晨低。
 */
export interface ChannelTimeAvailability {
  /** 早上 06:00-10:00 */
  morning: number;
  /** 中午 10:00-14:00 */
  midday: number;
  /** 下午/晚上 14:00-21:00 */
  evening: number;
  /** 深夜 21:00-06:00 */
  lateNight: number;
}

// -------------------- V7.2 Phase 1-B: 现实策略可配置化 --------------------

/**
 * V7.2: 现实性级别枚举
 *
 * 控制 RealisticFilter 的过滤严格度。
 * 场景→默认级别映射：
 * - HOME_COOK: normal
 * - RESTAURANT: relaxed
 * - DELIVERY: relaxed
 * - CANTEEN: strict
 * - CONVENIENCE: strict
 * - UNKNOWN: normal
 */
export type RealismLevel = 'strict' | 'normal' | 'relaxed' | 'off';

/**
 * V7.2: 现实性级别预设参数
 *
 * 每个 RealismLevel 对应一组完整的过滤阈值，
 * 替代 RealisticFilter 中的硬编码逻辑。
 */
export interface RealismPreset {
  /** 大众化最低阈值（commonalityScore 低于此值被过滤；0 = 不过滤） */
  commonalityThreshold: number;
  /** 是否启用预算过滤 */
  budgetFilterEnabled: boolean;
  /** 烹饪时间上限（分钟；Infinity = 不限） */
  cookTimeCap: number;
  /** 是否启用食堂模式过滤 */
  canteenFilterEnabled: boolean;
  /** 最高允许的烹饪技能等级（1-5；Infinity = 不限） */
  maxSkillLevel: number;
  /** 是否启用设备过滤 */
  equipmentFilterEnabled: boolean;
}

/**
 * V7.2: 四档现实性预设
 */
export const REALISM_PRESETS: Record<RealismLevel, RealismPreset> = {
  strict: {
    commonalityThreshold: 40,
    budgetFilterEnabled: true,
    cookTimeCap: 45,
    canteenFilterEnabled: true,
    maxSkillLevel: 2,
    equipmentFilterEnabled: true,
  },
  normal: {
    commonalityThreshold: 30,
    budgetFilterEnabled: true,
    cookTimeCap: 60,
    canteenFilterEnabled: true,
    maxSkillLevel: 3,
    equipmentFilterEnabled: true,
  },
  relaxed: {
    commonalityThreshold: 10,
    budgetFilterEnabled: false,
    cookTimeCap: 120,
    canteenFilterEnabled: false,
    maxSkillLevel: 5,
    equipmentFilterEnabled: false,
  },
  off: {
    commonalityThreshold: 0,
    budgetFilterEnabled: false,
    cookTimeCap: Infinity,
    canteenFilterEnabled: false,
    maxSkillLevel: Infinity,
    equipmentFilterEnabled: false,
  },
};

/**
 * V7.2: 场景→默认现实级别映射
 */
export const SCENE_DEFAULT_REALISM: Record<AcquisitionChannel, RealismLevel> = {
  [AcquisitionChannel.HOME_COOK]: 'normal',
  [AcquisitionChannel.RESTAURANT]: 'relaxed',
  [AcquisitionChannel.DELIVERY]: 'relaxed',
  [AcquisitionChannel.CANTEEN]: 'strict',
  [AcquisitionChannel.CONVENIENCE]: 'strict',
  [AcquisitionChannel.UNKNOWN]: 'normal',
};

// -------------------- END V7.2 Phase 1-B --------------------

/**
 * V7.1 方向 4B: 对比解释
 *
 * "为什么推荐 A 而不是 B"的对比解释数据，
 * 只在两者 ScoreBreakdown 差异 > 15% 时触发。
 */
export interface ContrastiveInsight {
  /** 推荐的食物名 */
  recommended: string;
  /** 对比的食物名（通常取 Top-6~10 中的一个） */
  alternative: string;
  /** 推荐食物的优势维度 */
  advantageDimension: ScoreDimension;
  /** 推荐食物在该维度的得分 */
  advantageValue: number;
  /** 对比食物在该维度的得分 */
  alternativeValue: number;
  /** 差异百分比 */
  differencePercent: number;
}
