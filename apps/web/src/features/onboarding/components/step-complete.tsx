'use client';

import type { OnboardingComputed } from '../types';

interface StepCompleteProps {
  computed: OnboardingComputed | null;
  onAccept: () => void;
}

export function StepComplete({ computed, onAccept }: StepCompleteProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
      <div className="text-6xl">🎉</div>
      <div>
        <h2 className="text-2xl font-extrabold font-headline">设置完成！</h2>
        <p className="text-sm text-muted-foreground mt-2">已为你准备个性化饮食方案</p>
      </div>

      {computed && (computed.bmr || computed.tdee || computed.recommendedCalories) && (
        <div className="bg-card rounded-2xl p-6 w-full max-w-sm shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-muted-foreground">你的健康参数</h3>
          <div className="grid grid-cols-3 gap-3">
            {computed.bmr && (
              <div className="text-center">
                <p className="text-2xl font-extrabold text-primary">{Math.round(computed.bmr)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">基础代谢 (BMR)</p>
              </div>
            )}
            {computed.tdee && (
              <div className="text-center">
                <p className="text-2xl font-extrabold text-primary">{Math.round(computed.tdee)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">日消耗 (TDEE)</p>
              </div>
            )}
            {computed.recommendedCalories && (
              <div className="text-center">
                <p className="text-2xl font-extrabold text-primary">
                  {Math.round(computed.recommendedCalories)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">推荐摄入</p>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">单位：kcal/天。基于你的身体数据和目标计算</p>
        </div>
      )}

      <button
        onClick={onAccept}
        className="w-full max-w-sm bg-primary text-primary-foreground font-bold py-4 rounded-full active:scale-[0.98] transition-all shadow-lg shadow-primary/20"
      >
        开始使用 →
      </button>
    </div>
  );
}
