'use client';

import type { AnalysisResult } from '@/types/food';

const DECISION_CONFIG = {
  SAFE: {
    emoji: '🟢',
    label: '放心吃',
    bgClass: 'bg-green-50 border-green-200',
    textClass: 'text-green-800',
    badgeClass: 'bg-green-100 text-green-800',
  },
  OK: {
    emoji: '🟡',
    label: '注意份量',
    bgClass: 'bg-yellow-50 border-yellow-200',
    textClass: 'text-yellow-800',
    badgeClass: 'bg-yellow-100 text-yellow-800',
  },
  LIMIT: {
    emoji: '🟠',
    label: '建议少吃',
    bgClass: 'bg-orange-50 border-orange-200',
    textClass: 'text-orange-800',
    badgeClass: 'bg-orange-100 text-orange-800',
  },
  AVOID: {
    emoji: '🔴',
    label: '不建议',
    bgClass: 'bg-red-50 border-red-200',
    textClass: 'text-red-800',
    badgeClass: 'bg-red-100 text-red-800',
  },
} as const;

interface DecisionCardProps {
  result: AnalysisResult;
}

export function DecisionCard({ result }: DecisionCardProps) {
  const decision = result.decision || 'SAFE';
  const config = DECISION_CONFIG[decision] || DECISION_CONFIG.SAFE;

  return (
    <div className={`rounded-2xl border p-5 space-y-4 ${config.bgClass}`}>
      {/* 决策头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{config.emoji}</span>
          <span className={`text-lg font-bold ${config.textClass}`}>{config.label}</span>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${config.badgeClass}`}>
          {result.totalCalories} kcal
        </span>
      </div>

      {/* 原因 */}
      {result.reason && (
        <p className={`text-sm font-medium ${config.textClass}`}>{result.reason}</p>
      )}

      {/* 建议 */}
      {result.suggestion && (
        <div className="bg-white/60 rounded-xl p-3">
          <p className="text-xs font-bold text-muted-foreground mb-1">💡 建议</p>
          <p className="text-sm">{result.suggestion}</p>
        </div>
      )}

      {/* 替代方案 */}
      {result.insteadOptions && result.insteadOptions.length > 0 && (
        <div className="bg-white/60 rounded-xl p-3">
          <p className="text-xs font-bold text-muted-foreground mb-2">🔄 替代方案</p>
          <div className="flex flex-wrap gap-2">
            {result.insteadOptions.map((option, i) => (
              <span
                key={i}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${config.bgClass}`}
              >
                {option}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 补救策略 */}
      {result.compensation &&
        (result.compensation.diet ||
          result.compensation.activity ||
          result.compensation.nextMeal) && (
          <div className="bg-white/60 rounded-xl p-3">
            <p className="text-xs font-bold text-muted-foreground mb-2">🛟 补救策略</p>
            <div className="space-y-1.5">
              {result.compensation.diet && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs">🍽️</span>
                  <span>{result.compensation.diet}</span>
                </div>
              )}
              {result.compensation.activity && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs">🏃</span>
                  <span>{result.compensation.activity}</span>
                </div>
              )}
              {result.compensation.nextMeal && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs">⏭️</span>
                  <span>{result.compensation.nextMeal}</span>
                </div>
              )}
            </div>
          </div>
        )}

      {/* 今日状态点评 */}
      {result.contextComment && (
        <p className="text-xs text-muted-foreground italic">📊 {result.contextComment}</p>
      )}

      {/* 鼓励语 */}
      {result.encouragement && (
        <p className="text-sm font-medium text-center pt-2 border-t border-current/10">
          ✨ {result.encouragement}
        </p>
      )}
    </div>
  );
}
