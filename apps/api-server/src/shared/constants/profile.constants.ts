/** UserProfile 字段约束 */
export const PROFILE_CONSTRAINTS = {
  heightCm: { min: 50, max: 250 },
  weightKg: { min: 20, max: 300 },
  targetWeightKg: { min: 20, max: 300 },
  birthYear: { min: 1900, max: 2025 },
  bodyFatPercent: { min: 3, max: 60 },
  dailyCalorieGoal: { min: 800, max: 5000 },
  mealsPerDay: { min: 1, max: 6 },
} as const;

/** 引导流步骤字段映射 */
export const ONBOARDING_STEPS: Record<number, { required: string[]; optional: string[] }> = {
  1: { required: ['gender', 'birthYear'], optional: [] },
  2: { required: ['heightCm', 'weightKg', 'goal', 'activityLevel'], optional: ['targetWeightKg', 'goalSpeed', 'bodyFatPercent'] },
  3: { required: [], optional: ['mealsPerDay', 'dietaryRestrictions', 'foodPreferences', 'takeoutFrequency'] },
  4: { required: [], optional: ['discipline', 'weakTimeSlots', 'bingeTriggers', 'canCook'] },
};

/** 画像完整度权重 */
export const COMPLETENESS_WEIGHTS: Record<string, number> = {
  gender: 10,
  birthYear: 10,
  heightCm: 15,
  weightKg: 15,
  goal: 15,
  activityLevel: 10,
  mealsPerDay: 5,
  dietaryRestrictions: 5,
  foodPreferences: 5,
  discipline: 5,
  weakTimeSlots: 3,
  bingeTriggers: 2,
};

/** 画像状态阈值 */
export const PROFILE_STATE_THRESHOLDS = {
  COLD: 0,
  WARM: 30,
  HOT: 60,
  MATURE: 85,
  STALE_DAYS: 30,
} as const;

/** TDEE 活动因子 */
export const ACTIVITY_FACTORS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

/** 目标热量调整乘数 */
export const DEFICIT_MULTIPLIERS: Record<string, Record<string, number>> = {
  fat_loss: { aggressive: 0.75, steady: 0.85, relaxed: 0.92 },
  muscle_gain: { aggressive: 1.15, steady: 1.10, relaxed: 1.05 },
  health: { aggressive: 1.0, steady: 1.0, relaxed: 1.0 },
  habit: { aggressive: 1.0, steady: 1.0, relaxed: 1.0 },
};
