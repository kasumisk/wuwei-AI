import type { GoalType, ActivityLevel, Discipline, TakeoutFrequency } from '@/types/user';

// ── Step Data Types ──

export interface StepBasicData {
  gender?: string;
  birthYear?: number;
}

export interface StepBodyGoalData {
  heightCm?: number;
  weightKg?: number;
  goal?: GoalType;
  targetWeightKg?: number;
  activityLevel?: ActivityLevel;
}

export interface StepDietHabitsData {
  mealsPerDay?: number;
  dietaryRestrictions?: string[];
  allergens?: string[];
  foodPreferences?: string[];
  takeoutFrequency?: TakeoutFrequency;
  cuisinePreferences?: string[];
  cookingSkillLevel?: string;
}

export interface StepBehaviorData {
  discipline?: Discipline;
  weakTimeSlots?: string[];
  bingeTriggers?: string[];
  canCook?: boolean;
  healthConditions?: string[];
}

// ── Onboarding State ──

export interface OnboardingComputed {
  bmr?: number;
  tdee?: number;
  recommendedCalories?: number;
}

export interface OnboardingState {
  currentStep: 1 | 2 | 3 | 4;
  stepData: {
    step1: StepBasicData;
    step2: StepBodyGoalData;
    step3: StepDietHabitsData;
    step4: StepBehaviorData;
  };
  computed: OnboardingComputed | null;
  completeness: number;
  isSubmitting: boolean;
}
