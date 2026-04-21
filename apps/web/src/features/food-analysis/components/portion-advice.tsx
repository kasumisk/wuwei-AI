'use client';

import type { AnalysisResult } from '@/types/food';

interface PortionAdviceProps {
  result: Pick<AnalysisResult, 'optimalPortion' | 'portionAction' | 'totalCalories'>;
}

/**
 * 份量建议可视化
 * 展示 optimalPortion（推荐目标）和 portionAction（本次建议实际摄入）
 * 用弧形进度条 + 文字对比呈现。
 */
export function PortionAdvice({ result }: PortionAdviceProps) {
  const { optimalPortion, portionAction, totalCalories } = result;

  // Need at least one source with a percentage
  const optPct = optimalPortion?.recommendedPercent;
  const actPct = portionAction?.suggestedPercent;
  const optCal = optimalPortion?.recommendedCalories;
  const actCal = portionAction?.suggestedCalories;

  if (optPct == null && actPct == null && optCal == null && actCal == null) return null;

  // Use percentage for the bar; prefer portionAction (actual suggestion) as primary
  const displayPct = actPct ?? optPct ?? 100;
  const displayCal = actCal ?? optCal;

  // Clamp 0-150 for visual bar (>100 means over recommended)
  const clampedPct = Math.min(Math.max(displayPct, 0), 150);
  const isOver = displayPct > 100;

  // SVG arc parameters
  const r = 36;
  const cx = 44;
  const cy = 44;
  const circumference = Math.PI * r; // half circle
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference * (1 - Math.min(clampedPct, 100) / 100);

  return (
    <div className="bg-white/60 rounded-xl p-4 space-y-3">
      <p className="text-xs font-bold text-muted-foreground">⚖️ 份量建议</p>

      <div className="flex items-center gap-4">
        {/* Half-circle arc gauge */}
        <div className="relative shrink-0" style={{ width: 88, height: 52 }}>
          <svg width="88" height="52" viewBox="0 0 88 52">
            {/* Track */}
            <path
              d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-muted/30"
              strokeLinecap="round"
            />
            {/* Fill */}
            <path
              d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              className={isOver ? 'text-red-500' : 'text-primary'}
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>
          {/* Center label */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
            <span
              className={`text-base font-extrabold leading-none ${isOver ? 'text-red-500' : 'text-primary'}`}
            >
              {Math.round(displayPct)}%
            </span>
          </div>
        </div>

        {/* Text breakdown */}
        <div className="flex-1 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">本次摄入</span>
            <span className="font-bold">{Math.round(totalCalories)} kcal</span>
          </div>
          {displayCal != null && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">建议上限</span>
              <span className="font-bold">{Math.round(displayCal)} kcal</span>
            </div>
          )}
          {optPct != null && actPct != null && optPct !== actPct && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">理想比例</span>
              <span className="font-bold text-primary">{Math.round(optPct)}%</span>
            </div>
          )}
          {isOver && (
            <p className="text-[10px] text-red-500 font-medium pt-0.5">
              超出建议份量，下餐适当减量
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
