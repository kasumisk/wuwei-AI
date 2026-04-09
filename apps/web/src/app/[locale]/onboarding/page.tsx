'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OnboardingWizard } from '@/features/onboarding/components/onboarding-wizard';

function OnboardingContent() {
  const searchParams = useSearchParams();
  const stepParam = searchParams.get('step');
  const startStep = stepParam ? Math.max(1, Math.min(4, parseInt(stepParam))) : 1;

  return <OnboardingWizard startStep={startStep} />;
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">加载中...</div>
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
