'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '../hooks/use-onboarding';
import { useToast } from '@/lib/hooks/use-toast';
import { STEP_CONFIG } from '../lib/onboarding-constants';
import { ProgressIndicator } from './shared/progress-indicator';
import { StepBasic } from './step-basic';
import { StepBodyGoal } from './step-body-goal';
import { StepDietHabits } from './step-diet-habits';
import { StepBehavior } from './step-behavior';
import { StepComplete } from './step-complete';

interface OnboardingWizardProps {
  startStep?: number;
}

export function OnboardingWizard({ startStep = 1 }: OnboardingWizardProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { state, updateStepData, validateCurrentStep, saveStep, skipStep, prevStep } =
    useOnboarding(startStep);
  const [completed, setCompleted] = useState(false);

  const currentConfig = STEP_CONFIG[state.currentStep - 1];

  const handleNext = async () => {
    const { success, error } = validateCurrentStep();
    if (!success) {
      toast({ title: error || '请完善必填信息', variant: 'destructive' });
      return;
    }

    try {
      const key = `step${state.currentStep}` as keyof typeof state.stepData;
      const result = await saveStep(state.currentStep, state.stepData[key]);

      // Step 4 完成或 nextStep 为 null → 进入完成页
      if (state.currentStep === 4 || result.nextStep === null) {
        setCompleted(true);
      }
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : '保存失败，请重试',
        variant: 'destructive',
      });
    }
  };

  const handleSkip = async () => {
    try {
      const result = await skipStep(state.currentStep);
      if (result.nextStep === null || state.currentStep === 4) {
        setCompleted(true);
      }
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : '操作失败',
        variant: 'destructive',
      });
    }
  };

  const handleComplete = () => {
    router.replace('/');
  };

  if (completed) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="px-6 py-6 max-w-lg mx-auto">
          <StepComplete computed={state.computed} onAccept={handleComplete} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 顶部导航 */}
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="px-6 py-4 max-w-lg mx-auto">
          <ProgressIndicator currentStep={state.currentStep} />
        </div>
      </nav>

      {/* 步骤内容 */}
      <main className="px-6 py-6 max-w-lg mx-auto pb-32">
        {state.currentStep === 1 && (
          <StepBasic data={state.stepData.step1} onChange={(d) => updateStepData('step1', d)} />
        )}
        {state.currentStep === 2 && (
          <StepBodyGoal data={state.stepData.step2} onChange={(d) => updateStepData('step2', d)} />
        )}
        {state.currentStep === 3 && (
          <StepDietHabits
            data={state.stepData.step3}
            onChange={(d) => updateStepData('step3', d)}
          />
        )}
        {state.currentStep === 4 && (
          <StepBehavior data={state.stepData.step4} onChange={(d) => updateStepData('step4', d)} />
        )}
      </main>

      {/* 底部操作按钮 */}
      <div className="fixed bottom-0 left-0 w-full glass-morphism z-50">
        <div className="px-6 py-4 pb-8 max-w-lg mx-auto space-y-3">
          <button
            onClick={handleNext}
            disabled={state.isSubmitting}
            className="w-full bg-primary text-primary-foreground font-bold py-4 rounded-full active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            {state.isSubmitting ? '保存中...' : state.currentStep === 4 ? '完成设置' : '下一步 →'}
          </button>

          <div className="flex items-center justify-between">
            {state.currentStep > 1 ? (
              <button
                onClick={prevStep}
                disabled={state.isSubmitting}
                className="text-sm text-muted-foreground font-medium py-2 px-4 hover:text-foreground transition-colors"
              >
                ← 上一步
              </button>
            ) : (
              <div />
            )}

            {currentConfig?.skippable && (
              <button
                onClick={handleSkip}
                disabled={state.isSubmitting}
                className="text-sm text-muted-foreground font-medium py-2 px-4 hover:text-foreground transition-colors"
              >
                跳过此步 ↓
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
