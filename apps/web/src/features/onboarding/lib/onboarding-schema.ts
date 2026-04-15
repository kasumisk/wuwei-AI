import { z } from 'zod';

export const step1Schema = z.object({
  gender: z.enum(['male', 'female']),
  birthYear: z.number().int().min(1940).max(2020),
});

export const step2Schema = z.object({
  heightCm: z.number().min(50).max(250),
  weightKg: z.number().min(20).max(300),
  goal: z.enum(['fat_loss', 'muscle_gain', 'health', 'habit']),
  targetWeightKg: z.number().min(30).max(200).optional(),
  activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active']),
});

export const step3Schema = z.object({
  mealsPerDay: z.number().int().min(1).max(6).optional(),
  dietaryRestrictions: z.array(z.string()).optional(),
  allergens: z.array(z.string()).optional(),
  foodPreferences: z.array(z.string()).optional(),
  takeoutFrequency: z.enum(['never', 'sometimes', 'often']).optional(),
  cuisinePreferences: z.array(z.string()).optional(),
  cookingSkillLevel: z.enum(['beginner', 'basic', 'intermediate', 'advanced']).optional(),
});

export const step4Schema = z.object({
  discipline: z.enum(['high', 'medium', 'low']).optional(),
  weakTimeSlots: z.array(z.string()).optional(),
  bingeTriggers: z.array(z.string()).optional(),
  canCook: z.boolean().optional(),
  healthConditions: z.array(z.string()).optional(),
});

export const schemas = [step1Schema, step2Schema, step3Schema, step4Schema] as const;
