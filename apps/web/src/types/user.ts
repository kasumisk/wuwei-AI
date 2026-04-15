/**
 * 用户相关类型定义（统一）
 */

// ── 枚举类型 ──
export type GoalType = 'fat_loss' | 'muscle_gain' | 'health' | 'habit';
export type GoalSpeed = 'aggressive' | 'steady' | 'relaxed';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';
export type Discipline = 'high' | 'medium' | 'low';
export type TakeoutFrequency = 'never' | 'sometimes' | 'often';

// ── 用户信息 ──
export interface AppUserInfo {
  id: string;
  authType: string;
  email?: string;
  phone?: string;
  nickname?: string;
  avatar?: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppLoginResponse {
  user: AppUserInfo;
  token: string;
}

// ── 厨房画像 ──
export interface KitchenProfile {
  hasOven: boolean;
  hasMicrowave: boolean;
  hasAirFryer: boolean;
  hasRiceCooker: boolean;
  hasSteamer: boolean;
  primaryStove: 'gas' | 'induction' | 'none';
}

// ── 用户档案 ──
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
  goal?: GoalType;
  goalSpeed?: GoalSpeed;
  // 饮食习惯
  mealsPerDay?: number;
  takeoutFrequency?: TakeoutFrequency;
  canCook?: boolean;
  foodPreferences?: string[];
  dietaryRestrictions?: string[];
  allergens?: string[];
  healthConditions?: string[];
  cuisinePreferences?: string[];
  cookingSkillLevel?: 'beginner' | 'basic' | 'intermediate' | 'advanced';
  // 生活方式
  sleepQuality?: 'poor' | 'fair' | 'good';
  stressLevel?: 'low' | 'medium' | 'high';
  hydrationGoal?: number;
  supplementsUsed?: string[];
  mealTimingPreference?: 'early_bird' | 'standard' | 'late_eater';
  // 厨房画像
  kitchenProfile?: KitchenProfile;
  // 行为习惯
  weakTimeSlots?: string[];
  bingeTriggers?: string[];
  discipline?: Discipline;
  // 元数据
  onboardingCompleted?: boolean;
  onboardingStep?: number;
  dataCompleteness?: number;
  createdAt: string;
  updatedAt: string;
}

// ── 画像收集提醒 ──
export interface CollectionReminder {
  type: 'popup' | 'toast' | 'card' | 'settings_guide';
  field: string;
  title: string;
  message: string;
  priority: 'high' | 'medium' | 'low';
  dismissable: boolean;
  nextReminderDays: number | null;
}

// ── 推荐偏好 ──
export type PopularityPreference = 'popular' | 'balanced' | 'adventurous';
export type CookingEffort = 'quick' | 'moderate' | 'elaborate';
export type BudgetSensitivity = 'budget' | 'moderate' | 'unlimited';

export interface RecommendationPreferences {
  popularityPreference?: PopularityPreference;
  cookingEffort?: CookingEffort;
  budgetSensitivity?: BudgetSensitivity;
  cuisineWeights?: Record<string, number>;
  diversityTolerance?: 'low' | 'medium' | 'high';
  dietaryPhilosophy?: 'omnivore' | 'pescatarian' | 'vegetarian' | 'vegan' | 'none';
  mealPattern?: 'frequent_small' | 'standard_three' | 'intermittent_fasting';
  flavorOpenness?: 'conservative' | 'moderate' | 'adventurous';
  realismLevel?: 'strict' | 'normal' | 'relaxed' | 'off';
}

export interface UpdateRecommendationPreferencesDto {
  popularityPreference?: PopularityPreference;
  cookingEffort?: CookingEffort;
  budgetSensitivity?: BudgetSensitivity;
  realismLevel?: 'strict' | 'normal' | 'relaxed' | 'off';
  diversityTolerance?: 'low' | 'medium' | 'high';
  dietaryPhilosophy?: 'omnivore' | 'pescatarian' | 'vegetarian' | 'vegan' | 'none';
  mealPattern?: 'frequent_small' | 'standard_three' | 'intermittent_fasting';
  flavorOpenness?: 'conservative' | 'moderate' | 'adventurous';
  cuisineWeights?: Record<string, number>;
}

// ── 行为画像 ──
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
