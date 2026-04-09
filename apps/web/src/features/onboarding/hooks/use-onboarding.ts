'use client';

import { useState, useCallback } from 'react';
import { profileService } from '@/lib/api/profile';
import { STEP3_DEFAULTS, STEP4_DEFAULTS } from '../lib/onboarding-constants';
import { schemas } from '../lib/onboarding-schema';
import type {
  OnboardingState,
  StepBasicData,
  StepBodyGoalData,
  StepDietHabitsData,
  StepBehaviorData,
} from '../types';

type StepData = StepBasicData | StepBodyGoalData | StepDietHabitsData | StepBehaviorData;

const initialState: OnboardingState = {
  currentStep: 1,
  stepData: {
    step1: {},
    step2: {},
    step3: { ...STEP3_DEFAULTS },
    step4: { ...STEP4_DEFAULTS },
  },
  computed: null,
  completeness: 0,
  isSubmitting: false,
};

export function useOnboarding(startStep: number = 1) {
  const [state, setState] = useState<OnboardingState>({
    ...initialState,
    currentStep: Math.max(1, Math.min(4, startStep)) as 1 | 2 | 3 | 4,
  });

  const updateStepData = useCallback(
    <K extends keyof OnboardingState['stepData']>(
      step: K,
      data: Partial<OnboardingState['stepData'][K]>
    ) => {
      setState((prev) => ({
        ...prev,
        stepData: {
          ...prev.stepData,
          [step]: { ...prev.stepData[step], ...data },
        },
      }));
    },
    []
  );

  const validateCurrentStep = useCallback((): { success: boolean; error?: string } => {
    const stepIndex = state.currentStep - 1;
    const schema = schemas[stepIndex];
    const key = `step${state.currentStep}` as keyof OnboardingState['stepData'];
    const data = state.stepData[key];

    const result = schema.safeParse(data);
    if (!result.success) {
      const firstError = result.error.issues[0];
      return { success: false, error: firstError?.message || '请检查填写内容' };
    }
    return { success: true };
  }, [state.currentStep, state.stepData]);

  const saveStep = useCallback(async (step: number, data: StepData) => {
    setState((prev) => ({ ...prev, isSubmitting: true }));
    try {
      const result = await profileService.saveOnboardingStep(step, data as Record<string, unknown>);
      setState((prev) => ({
        ...prev,
        isSubmitting: false,
        computed: result.computed ?? prev.computed,
        completeness: result.completeness,
        currentStep: result.nextStep
          ? (Math.min(4, result.nextStep) as 1 | 2 | 3 | 4)
          : prev.currentStep,
      }));
      return result;
    } catch (err) {
      setState((prev) => ({ ...prev, isSubmitting: false }));
      throw err;
    }
  }, []);

  const skipStep = useCallback(async (step: number) => {
    setState((prev) => ({ ...prev, isSubmitting: true }));
    try {
      const result = await profileService.skipOnboardingStep(step);
      setState((prev) => ({
        ...prev,
        isSubmitting: false,
        completeness: result.completeness,
        currentStep: result.nextStep
          ? (Math.min(4, result.nextStep) as 1 | 2 | 3 | 4)
          : prev.currentStep,
      }));
      return result;
    } catch (err) {
      setState((prev) => ({ ...prev, isSubmitting: false }));
      throw err;
    }
  }, []);

  const prevStep = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.max(1, prev.currentStep - 1) as 1 | 2 | 3 | 4,
    }));
  }, []);

  const nextStep = useCallback(() => {
    setState((prev) => ({
      ...prev,
      currentStep: Math.min(4, prev.currentStep + 1) as 1 | 2 | 3 | 4,
    }));
  }, []);

  return {
    state,
    updateStepData,
    validateCurrentStep,
    saveStep,
    skipStep,
    prevStep,
    nextStep,
  };
}
