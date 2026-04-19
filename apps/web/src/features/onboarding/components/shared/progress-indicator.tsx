'use client';

import { STEP_CONFIG } from '../../lib/onboarding-constants';

interface ProgressIndicatorProps {
  currentStep: 1 | 2 | 3 | 4;
}

export function ProgressIndicator({ currentStep }: ProgressIndicatorProps) {
  return (
    <div className="flex items-center gap-2 px-2">
      {STEP_CONFIG.map(({ step, title }) => {
        const isActive = step === currentStep;
        const isCompleted = step < currentStep;

        return (
          <div key={step} className="flex-1 flex flex-col items-center gap-1.5">
            <div
              className={`h-1.5 w-full  transition-all duration-300 ${
                isCompleted ? 'bg-primary' : isActive ? 'bg-primary/60' : 'bg-muted'
              }`}
            />
            <span
              className={`text-[10px] font-medium transition-colors ${
                isActive
                  ? 'text-primary font-bold'
                  : isCompleted
                    ? 'text-primary/70'
                    : 'text-muted-foreground'
              }`}
            >
              {title}
            </span>
          </div>
        );
      })}
    </div>
  );
}
