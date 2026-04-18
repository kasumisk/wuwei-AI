/**
 * 食物相关类型定义（统一）
 */

// ── 食物基础 ──
export interface FoodItem {
  name: string;
  calories: number;
  quantity?: string;
  category?: string;
  protein?: number;
  fat?: number;
  carbs?: number;
  quality?: number;
  satiety?: number;
}

// ── 分析结果中的食物项（富数据） ──
export interface AnalysisFoodItem {
  name: string;
  normalizedName?: string;
  foodLibraryId?: string;
  quantity?: string;
  estimatedWeightGrams?: number;
  category?: string;
  confidence?: number;
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  saturatedFat?: number;
  addedSugar?: number;
}

// ── 决策推理链步骤（API 真实结构） ──
export interface DecisionChainStep {
  step?: string;
  input?: string;
  output?: string;
  confidence?: number;
}

// ── 维度评分详解（API 真实结构） ──
export interface ScoreBreakdownExplanation {
  dimension?: string;
  label?: string;
  score?: number;
  impact?: string;
  message?: string;
  suggestion?: string;
}

// ── 决策因子（API 真实结构） ──
export interface DecisionFactor {
  dimension?: string;
  score?: number;
  impact?: string;
  message?: string;
}

// ── 识别问题条目（API 真实结构） ──
export interface IdentifiedIssue {
  type?: string;
  severity?: string;
  metric?: number;
  threshold?: number;
  implication?: string;
}

// ── 替代品候选（API 真实结构） ──
export interface ReplacementCandidate {
  name: string;
  foodLibraryId?: string;
  source?: string;
  score?: number;
  reason?: string;
  comparison?: {
    caloriesDiff?: number;
    proteinDiff?: number;
    scoreDiff?: number;
  };
  scenarioType?: string;
  rankScore?: number;
  rankReasons?: string[];
}

// ── 分析结果（直接映射 API data 字段） ──
export interface AnalysisResult {
  // ── 基础 ──
  requestId: string;
  inputType?: 'text' | 'image';
  mealType: string;
  imageUrl?: string;
  isHealthy: boolean;

  // ── 食物列表 ──
  foods: AnalysisFoodItem[];

  // ── 合计 ──
  totalCalories: number;
  totalProtein?: number;
  totalFat?: number;
  totalCarbs?: number;
  totalSaturatedFat?: number;
  totalAddedSugar?: number;

  // ── 评分 ──
  healthScore?: number;
  nutritionScore?: number;
  confidenceScore?: number;
  scoreBreakdown?: NutritionScoreBreakdown;

  // ── 决策（映射为枚举，供旧 UI 兼容） ──
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
  riskLevel: string;
  reason: string;
  /** decision.advice */
  decisionAdvice?: string;
  shouldEat?: boolean;

  // ── 决策富数据 ──
  decisionFactors?: DecisionFactor[];
  decisionChain?: DecisionChainStep[];
  breakdownExplanations?: ScoreBreakdownExplanation[];
  optimalPortion?: { recommendedPercent?: number; recommendedCalories?: number };
  nextMealAdvice?: {
    targetCalories?: number;
    targetProtein?: number;
    targetFat?: number;
    targetCarbs?: number;
    emphasis?: string;
    suggestion?: string;
  };

  // ── Summary 模块 ──
  advice: string; // explanation.summary
  headline?: string;
  topIssues?: string[];
  topStrengths?: string[];
  actionItems?: string[];
  quantitativeHighlight?: string;
  contextSignals?: string[];
  alternativeSummary?: string;
  dynamicDecisionHint?: string;
  healthConstraintNote?: string;
  decisionGuardrails?: string[];
  coachFocus?: string;

  // ── shouldEatAction ──
  suggestion: string; // shouldEatAction.primaryReason fallback
  insteadOptions: string[]; // alternatives[].name
  replacementCandidates?: ReplacementCandidate[];
  portionAction?: { suggestedPercent?: number; suggestedCalories?: number };
  recoveryAction?: { nextMealDirection?: string; todayAdjustment?: string };

  // ── 旧格式兼容 ──
  compensation: { diet?: string; activity?: string; nextMeal?: string };
  contextComment: string;
  encouragement: string;
  highlights?: string[];

  // ── 上下文分析 ──
  completionRatio?: Record<string, number>;
  identifiedIssues?: IdentifiedIssue[];
  issues?: AnalysisIssue[];

  // ── 置信度诊断 ──
  confidenceDiagnostics?: {
    overallConfidence?: number;
    analysisQualityBand?: string;
    analysisCompletenessScore?: number;
  };
}

// ── 旧 issue 类型（兼容旧组件） ──
export interface AnalysisIssue {
  issue: string;
  severity: 'low' | 'medium' | 'high';
  detail?: string;
}

// ── 饮食记录 ──
export interface FoodRecord {
  id: string;
  userId: string;
  imageUrl?: string;
  source:
    | 'screenshot'
    | 'camera'
    | 'manual'
    | 'text_analysis'
    | 'image_analysis'
    | 'recommend'
    | 'decision';
  recognizedText?: string;
  foods: FoodItem[];
  totalCalories: number;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  advice?: string;
  isHealthy?: boolean;
  // V6: 宏量营养
  totalProtein?: number;
  totalFat?: number;
  totalCarbs?: number;
  avgQuality?: number;
  avgSatiety?: number;
  nutritionScore?: number;
  // V1: 决策字段
  decision?: string;
  riskLevel?: string;
  reason?: string;
  suggestion?: string;
  insteadOptions?: string[];
  compensation?: { diet?: string; activity?: string; nextMeal?: string };
  contextComment?: string;
  encouragement?: string;
  // V8: 来源追溯
  analysisId?: string;
  recommendationTraceId?: string;
  isExecuted?: boolean;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedRecords {
  items: FoodRecord[];
  total: number;
  page: number;
  limit: number;
}

// ── 每日汇总 ──
export interface DailySummary {
  totalCalories: number;
  calorieGoal: number | null;
  mealCount: number;
  remaining: number;
  // V6: 营养维度
  totalProtein?: number;
  totalFat?: number;
  totalCarbs?: number;
  avgQuality?: number;
  avgSatiety?: number;
  nutritionScore?: number;
  proteinGoal?: number;
  fatGoal?: number;
  carbsGoal?: number;
}

export interface DailySummaryRecord {
  id: string;
  userId: string;
  date: string;
  totalCalories: number;
  calorieGoal?: number;
  mealCount: number;
}

// ── 推荐 ──
export interface MealScenario {
  scenario: string;
  foods: string;
  calories: number;
  tip: string;
  totalProtein?: number;
  totalFat?: number;
  totalCarbs?: number;
}

export interface MealSuggestion {
  mealType: string;
  remainingCalories: number;
  suggestion: {
    foods: string;
    calories: number;
    tip: string;
    totalProtein?: number;
    totalFat?: number;
    totalCarbs?: number;
  };
  scenarios?: MealScenario[];
}

// ── 每日计划 ──
export interface MealPlan {
  foods: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  tip: string;
}

export interface DailyPlanData {
  id: string;
  date: string;
  morningPlan: MealPlan | null;
  lunchPlan: MealPlan | null;
  dinnerPlan: MealPlan | null;
  snackPlan: MealPlan | null;
  adjustments: Array<{ time: string; reason: string; newPlan: Record<string, MealPlan> }>;
  strategy: string;
  totalBudget: number;
  adjustmentNote?: string;
}

// ── 主动提醒 ──
export interface ProactiveReminder {
  type: 'binge_risk' | 'meal_reminder' | 'streak_warning' | 'pattern_alert';
  message: string;
  urgency: 'low' | 'medium' | 'high';
}

// ── 游戏化 ──
export interface Achievement {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  threshold: number;
  rewardType: string;
  rewardValue: number;
}

export interface UserAchievement {
  id: string;
  userId: string;
  achievementId: string;
  unlockedAt: string;
}

export interface ChallengeItem {
  id: string;
  title: string;
  description: string;
  type: string;
  durationDays: number;
  rules: Record<string, any>;
  isActive: boolean;
}

export interface UserChallengeItem {
  id: string;
  userId: string;
  challengeId: string;
  startedAt: string;
  currentProgress: number;
  maxProgress: number;
  status: string;
  completedAt: string | null;
}

export interface StreakStatus {
  current: number;
  longest: number;
  todayStatus: 'on_track' | 'at_risk' | 'exceeded';
}

// ── 营养评分 ──
export interface NutritionScoreBreakdown {
  energy: number;
  proteinRatio: number;
  macroBalance: number;
  foodQuality: number;
  satiety: number;
  stability: number;
  glycemicImpact: number;
}

export interface NutritionScoreResult {
  totalScore: number;
  breakdown: NutritionScoreBreakdown;
  highlights: string[];
  feedback: string;
  goals: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
  };
  intake: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
  };
}

// ── 周计划 ──
export interface MealFoodItem {
  foodId: string;
  name: string;
  servingDesc: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  category: string;
}

export interface MealFoodExplanation {
  reason: string;
  benefits: string[];
}

export interface MealPlanDetailed extends MealPlan {
  foodItems?: MealFoodItem[];
  explanations?: Record<string, MealFoodExplanation>;
}

export interface DailyPlanSummary {
  date: string;
  isNew: boolean;
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  meals: {
    morning: MealPlanDetailed | null;
    lunch: MealPlanDetailed | null;
    dinner: MealPlanDetailed | null;
    snack: MealPlanDetailed | null;
  };
}

export interface WeeklyNutritionSummary {
  avgCalories: number;
  avgProtein: number;
  avgFat: number;
  avgCarbs: number;
  calorieCV: number;
  uniqueFoodCount: number;
}

export interface WeeklyPlanData {
  weekStart: string;
  weekEnd: string;
  plans: DailyPlanSummary[];
  weeklyNutrition: WeeklyNutritionSummary;
}

// ── 文字分析请求 ──
export interface AnalyzeTextRequest {
  text: string; // 1-500 chars
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
}

// ── 保存分析到记录 ──
export interface SaveAnalysisRequest {
  analysisId: string; // UUID
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  recordedAt?: string; // ISO date string
}

// ── 分析历史 ──
export interface AnalysisHistoryItem {
  id: string;
  inputType: 'text' | 'image';
  inputText?: string;
  imageUrl?: string;
  mealType?: string;
  totalCalories: number;
  foodCount: number;
  decision?: string;
  isHealthy?: boolean;
  createdAt: string;
}

export interface AnalysisHistoryResponse {
  items: AnalysisHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ── 食物替代 ──
export interface SubstituteItem {
  foodId: string;
  name: string;
  category: string;
  subCategory: string;
  mainIngredient: string;
  servingDesc: string;
  servingCalories: number;
  servingProtein: number;
  servingFat: number;
  servingCarbs: number;
  substituteScore: number;
  similarity: number;
  nutritionProximity: number;
  historicalCount: number;
  imageUrl: string;
  thumbnailUrl: string;
}

// ── "为什么不推荐" 解释 ──
export interface ExplainWhyNotResult {
  foodName: string;
  mealType: string;
  explanation: string;
  reasons: string[];
  alternatives: string[];
}

// ── 推荐反馈 ──
export type FeedbackAction = 'accepted' | 'replaced' | 'skipped';

export interface FeedbackRatings {
  taste?: number;
  portion?: number;
  price?: number;
  timing?: number;
  comment?: string;
}

// ── 反馈统计（多维度） ──
export interface FeedbackDimensionStats {
  avgTaste: number | null;
  avgPortion: number | null;
  avgPrice: number | null;
  avgTiming: number | null;
  ratedCount: number;
}

export interface FeedbackStats {
  perFood: Record<string, FeedbackDimensionStats>;
  global: FeedbackDimensionStats;
  days: number;
}

// ── 菜谱 ──
export interface RecipeSummary {
  id: string;
  name: string;
  description: string | null;
  cuisine: string | null;
  difficulty: number;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number;
  tags: string[];
  imageUrl: string | null;
  source: string;
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  fatPerServing: number | null;
  carbsPerServing: number | null;
  fiberPerServing: number | null;
  qualityScore: number;
  usageCount: number;
  averageRating: number | null;
  ratingCount: number;
}

export interface RecipeIngredientItem {
  id: string;
  foodId: string | null;
  ingredientName: string;
  amount: number | null;
  unit: string | null;
  isOptional: boolean;
  sortOrder: number;
}

export interface RecipeDetail extends RecipeSummary {
  instructions: Record<string, unknown> | null;
  ingredients: RecipeIngredientItem[];
  createdAt: string;
  updatedAt: string;
}

export interface RecipeRating {
  id: string;
  recipeId: string;
  userId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeRatingSummary {
  recipeId: string;
  averageRating: number;
  ratingCount: number;
  distribution: Record<number, number>;
}

export interface SearchRecipesParams {
  q?: string;
  cuisine?: string;
  difficulty?: number;
  tags?: string;
  maxCookTime?: number;
  limit?: number;
  offset?: number;
}
