'use client';

/**
 * 饮食记录 + AI 分析 + 用户档案 API 服务
 * 对接 api-server 的 /api/app/food/* 端点
 */

import { clientGet, clientPost, clientPut, clientDelete, clientUpload } from './client-api';
import type { ApiResponse } from './http-client';

// ==================== 辅助函数 ====================

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

// ==================== 类型定义 ====================

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

export interface UserProfile {
  id: string;
  userId: string;
  // 基本信息
  gender?: string;
  birthYear?: number;
  heightCm?: number;
  weightKg?: number;
  targetWeightKg?: number;
  bodyFatPercent?: number;
  // 活动等级
  activityLevel: string;
  dailyCalorieGoal?: number;
  // 健康目标
  goal?: 'fat_loss' | 'muscle_gain' | 'health' | 'habit';
  goalSpeed?: 'aggressive' | 'steady' | 'relaxed';
  // 饮食习惯
  mealsPerDay?: number;
  takeoutFrequency?: 'never' | 'sometimes' | 'often';
  canCook?: boolean;
  foodPreferences?: string[];
  dietaryRestrictions?: string[];
  // 行为习惯
  weakTimeSlots?: string[];
  bingeTriggers?: string[];
  discipline?: 'high' | 'medium' | 'low';
  onboardingCompleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedRecords {
  items: FoodRecord[];
  total: number;
  page: number;
  limit: number;
}

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

// V2: 每日计划
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

// V3: 行为画像
export interface BehaviorProfile {
  id: string;
  userId: string;
  foodPreferences: { loves?: string[]; avoids?: string[]; frequentFoods?: string[] };
  bingeRiskHours: number[];
  failureTriggers: string[];
  avgComplianceRate: number;
  coachStyle: string;
  totalRecords: number;
  healthyRecords: number;
  streakDays: number;
  longestStreak: number;
}

export interface ProactiveReminder {
  type: 'binge_risk' | 'meal_reminder' | 'streak_warning' | 'pattern_alert';
  message: string;
  urgency: 'low' | 'medium' | 'high';
}

// V4: 游戏化
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

// V6: 营养评分
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

// ==================== API 服务 ====================

export const foodService = {
  /**
   * 上传食物图片 AI 分析
   */
  analyzeImage: async (file: File, mealType?: string): Promise<AnalysisResult> => {
    const formData = new FormData();
    formData.append('file', file);
    if (mealType) formData.append('mealType', mealType);
    return unwrap(clientUpload<AnalysisResult>('/app/food/analyze', formData));
  },

  /**
   * 保存饮食记录
   */
  saveRecord: async (data: {
    requestId?: string;
    imageUrl?: string;
    foods: FoodItem[];
    totalCalories: number;
    mealType?: string;
    advice?: string;
    isHealthy?: boolean;
    recordedAt?: string;
    // V1: 决策字段
    decision?: string;
    riskLevel?: string;
    reason?: string;
    suggestion?: string;
    insteadOptions?: string[];
    compensation?: { diet?: string; activity?: string; nextMeal?: string };
    contextComment?: string;
    encouragement?: string;
    // V6: 营养维度
    totalProtein?: number;
    totalFat?: number;
    totalCarbs?: number;
    avgQuality?: number;
    avgSatiety?: number;
    nutritionScore?: number;
  }): Promise<FoodRecord> => {
    return unwrap(clientPost<FoodRecord>('/app/food/records', data));
  },

  /**
   * 获取今日记录
   */
  getTodayRecords: async (): Promise<FoodRecord[]> => {
    return unwrap(clientGet<FoodRecord[]>('/app/food/records/today'));
  },

  /**
   * 分页查询历史记录
   */
  getRecords: async (params?: {
    page?: number;
    limit?: number;
    date?: string;
  }): Promise<PaginatedRecords> => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.date) searchParams.set('date', params.date);
    const qs = searchParams.toString();
    return unwrap(
      clientGet<PaginatedRecords>(`/app/food/records${qs ? `?${qs}` : ''}`),
    );
  },

  /**
   * 更新饮食记录
   */
  updateRecord: async (
    id: string,
    data: {
      foods?: FoodItem[];
      totalCalories?: number;
      mealType?: string;
      advice?: string;
      isHealthy?: boolean;
    },
  ): Promise<FoodRecord> => {
    return unwrap(clientPut<FoodRecord>(`/app/food/records/${id}`, data));
  },

  /**
   * 删除饮食记录
   */
  deleteRecord: async (id: string): Promise<void> => {
    await unwrap(clientDelete<null>(`/app/food/records/${id}`));
  },

  /**
   * 获取今日汇总
   */
  getTodaySummary: async (): Promise<DailySummary> => {
    return unwrap(clientGet<DailySummary>('/app/food/summary/today'));
  },

  /**
   * 获取最近 N 天汇总
   */
  getRecentSummaries: async (days: number = 7): Promise<DailySummaryRecord[]> => {
    return unwrap(
      clientGet<DailySummaryRecord[]>(`/app/food/summary/recent?days=${days}`),
    );
  },

  /**
   * 获取用户健康档案
   */
  getProfile: async (): Promise<UserProfile | null> => {
    return unwrap(clientGet<UserProfile | null>('/app/food/profile'));
  },

  /**
   * 保存用户健康档案
   */
  saveProfile: async (data: Partial<UserProfile>): Promise<UserProfile> => {
    return unwrap(clientPut<UserProfile>('/app/food/profile', data));
  },

  /**
   * 获取下一餐推荐
   */
  getMealSuggestion: async (): Promise<MealSuggestion> => {
    return unwrap(clientGet<MealSuggestion>('/app/food/meal-suggestion'));
  },

  // ── V2: 每日计划 ──

  /**
   * 获取今日饮食计划
   */
  getDailyPlan: async (): Promise<DailyPlanData> => {
    return unwrap(clientGet<DailyPlanData>('/app/food/daily-plan'));
  },

  /**
   * 触发计划调整
   */
  adjustDailyPlan: async (reason: string): Promise<{ updatedPlan: DailyPlanData; adjustmentNote: string }> => {
    return unwrap(clientPost<{ updatedPlan: DailyPlanData; adjustmentNote: string }>('/app/food/daily-plan/adjust', { reason }));
  },

  // ── V3: 行为建模 ──

  /**
   * 获取行为画像
   */
  getBehaviorProfile: async (): Promise<BehaviorProfile> => {
    return unwrap(clientGet<BehaviorProfile>('/app/food/behavior-profile'));
  },

  /**
   * 主动提醒检查
   */
  proactiveCheck: async (): Promise<{ reminder: ProactiveReminder | null }> => {
    return unwrap(clientGet<{ reminder: ProactiveReminder | null }>('/app/food/proactive-check'));
  },

  /**
   * AI 决策反馈
   */
  decisionFeedback: async (recordId: string, followed: boolean, feedback: 'helpful' | 'unhelpful' | 'wrong'): Promise<void> => {
    await unwrap(clientPost<null>('/app/food/decision-feedback', { recordId, followed, feedback }));
  },

  // ── V4: 游戏化 ──

  /**
   * 获取成就列表
   */
  getAchievements: async (): Promise<{ all: Achievement[]; unlocked: UserAchievement[] }> => {
    return unwrap(clientGet<{ all: Achievement[]; unlocked: UserAchievement[] }>('/app/achievements'));
  },

  /**
   * 获取挑战列表
   */
  getChallenges: async (): Promise<{ available: ChallengeItem[]; active: UserChallengeItem[] }> => {
    return unwrap(clientGet<{ available: ChallengeItem[]; active: UserChallengeItem[] }>('/app/challenges'));
  },

  /**
   * 参加挑战
   */
  joinChallenge: async (challengeId: string): Promise<UserChallengeItem> => {
    return unwrap(clientPost<UserChallengeItem>(`/app/challenges/${challengeId}/join`, {}));
  },

  /**
   * 获取连胜状态
   */
  getStreak: async (): Promise<StreakStatus> => {
    return unwrap(clientGet<StreakStatus>('/app/streak'));
  },

  // ── V6: 营养评分 ──

  /**
   * 获取今日营养评分详情
   */
  getNutritionScore: async (): Promise<NutritionScoreResult> => {
    return unwrap(clientGet<NutritionScoreResult>('/app/food/nutrition-score'));
  },

  // ── V5: 教练风格 ──

  /**
   * 切换教练风格
   */
  updateCoachStyle: async (style: 'strict' | 'friendly' | 'data'): Promise<{ coachStyle: string }> => {
    return unwrap(clientPut<{ coachStyle: string }>('/app/coach/style', { style }));
  },
};

export default foodService;
