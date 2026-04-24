/**
 * V7.5 P3-B: 餐食 / 食物 / 反馈相关类型
 *
 * 从 recommendation.types.ts 拆分，涵盖：
 * - MealTarget / Constraint / ScoredFood
 * - MealRecommendation / AssembledRecipe / RecipeNutrition
 * - DailyPlanState / FoodFeedbackStats / UserPreferenceProfile
 * - StructuredInsight / InsightType / InsightVisualization
 * - PipelineDegradation
 * - ExecutionMatchResult / EXECUTION_MATCH_SCORES
 * - CrossMealAdjustment / PreferenceSignal / ContrastiveInsight
 */

import { FoodLibrary } from '../../../../food/food.types';
import { ScoringExplanation } from './scoring-explanation.interface';
import { AcquisitionChannel } from './scene.types';
import type { ScoreDimension } from './scoring.types';
import type { MealCompositionExplanation } from './explanation.types';

// ==================== 核心餐食类型 ====================

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
  /** #fix Bug7: 饮食限制（vegetarian/vegan/pescatarian 等，用于多字段硬过滤） */
  dietaryRestrictions?: string[];
  /** #fix Bug11: 排除油炸食物（isFried=true），用于 fat_loss + high discipline */
  excludeIsFried?: boolean;
  /** #fix Bug18: 钠含量上限 (mg/100g)，用于 low_sodium / hypertension 硬过滤 */
  maxSodium?: number;
  /** #fix Bug19: 嘌呤上限 (mg/100g)，用于 gout 硬过滤 */
  maxPurine?: number;
  /** #fix Bug31: 脂肪上限 (g/100g)，用于 low_fat 饮食限制硬过滤（食物密度级） */
  maxFat?: number;
  /** P0-2: 餐级脂肪上限 (g)，用于总量硬约束。避免 MACRO_RANGES 奖励高脂 → fat +73% 偏差 */
  maxMealFat?: number;
  /** P0-2: 餐级脂肪目标 (g)，用于 MacroFit 评分维度 */
  targetMealFat?: number;
  /** P0-2: 餐级碳水目标 (g)，用于 MacroFit 评分维度 */
  targetMealCarbs?: number;
  /** P0-2: 餐级碳水上限 (g)，避免碳水过度 */
  maxMealCarbs?: number;
  /** P0-2: 餐级蛋白质目标 (g)，用于 MacroFit 评分（与 minProtein 区分：这是"贴近"目标而非"最低"） */
  targetMealProtein?: number;
  /** P0-2: 餐级热量目标 (kcal)，用于 MacroFit 评分 */
  targetMealCalories?: number;
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

// ==================== V6.9 Phase 2-A: 跨餐多样性上下文 ====================

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

// ==================== V6.9 Phase 2-B: 结构化可解释性 ====================

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

// ==================== 餐食推荐结果 ====================

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

  // ─── V7.9 Phase 3: 增长优化 ───

  /** V7.9 P3-2: 整餐数据可信度（0-1，基于食物 confidence 加权） */
  dataConfidence?: number;
  /** V7.9 P3-5: 决策价值标签（结构化的营养合规/达标提示） */
  decisionValueTags?: DecisionValueTag[];
}

/**
 * V7.9 Phase 3-5: 决策价值标签
 *
 * 在推荐返回中附加结构化的决策价值说明，
 * 帮助用户理解本餐推荐的具体价值（如"热量合规"、"蛋白质达标"）。
 */
export interface DecisionValueTag {
  /** 标签类别 */
  type: 'compliance' | 'achievement' | 'warning' | 'bonus';
  /** 标签文案 */
  label: string;
  /** 相关维度（如 calories, protein 等） */
  dimension?: string;
  /** 当前值 */
  value?: number;
  /** 目标值 */
  target?: number;
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

// ==================== V7.1 Phase 1-C: 执行匹配 ====================

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

// ==================== V7.1: 跨餐调整 / 偏好信号 / 对比解释 ====================

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
 * V7.1 方向 4B: 对比解释
 *
 * "为什么推荐 A 而不是 B"的对比解释数据，
 * 只在两者 ScoreBreakdown 差异 > 15% 时触发。
 */
export interface ContrastiveInsight {
  /** 推荐的食物名 */
  recommended: string;
  /** 对比的食物名（通常取 Top-4~10 中的一个） */
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
