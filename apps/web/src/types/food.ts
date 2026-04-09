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

// ── 分析结果 ──
export interface AnalysisResult {
  requestId: string;
  foods: FoodItem[];
  totalCalories: number;
  mealType: string;
  advice: string;
  isHealthy: boolean;
  imageUrl?: string;
  // V1: 决策字段
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
  riskLevel: string;
  reason: string;
  suggestion: string;
  insteadOptions: string[];
  compensation: {
    diet?: string;
    activity?: string;
    nextMeal?: string;
  };
  contextComment: string;
  encouragement: string;
  // V6: 营养维度
  totalProtein?: number;
  totalFat?: number;
  totalCarbs?: number;
  avgQuality?: number;
  avgSatiety?: number;
  nutritionScore?: number;
  scoreBreakdown?: NutritionScoreBreakdown;
  highlights?: string[];
}

// ── 饮食记录 ──
export interface FoodRecord {
  id: string;
  userId: string;
  imageUrl?: string;
  source: 'screenshot' | 'camera' | 'manual';
  recognizedText?: string;
  foods: FoodItem[];
  totalCalories: number;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  advice?: string;
  isHealthy?: boolean;
  // V1: 决策字段
  decision?: string;
  riskLevel?: string;
  reason?: string;
  suggestion?: string;
  insteadOptions?: string[];
  compensation?: { diet?: string; activity?: string; nextMeal?: string };
  contextComment?: string;
  encouragement?: string;
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
}

export interface MealSuggestion {
  mealType: string;
  remainingCalories: number;
  suggestion: {
    foods: string;
    calories: number;
    tip: string;
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
