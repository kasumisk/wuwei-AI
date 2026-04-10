'use client';

import { useState } from 'react';
import { LocalizedLink } from '@/components/common/localized-link';
import type { AnalysisResult, NutritionScoreBreakdown } from '@/types/food';

const DECISION_CONFIG = {
  SAFE: {
    emoji: '🟢',
    label: '放心吃',
    bgClass: 'bg-green-50 border-green-200',
    textClass: 'text-green-800',
    badgeClass: 'bg-green-100 text-green-800',
    barClass: 'bg-green-500',
  },
  OK: {
    emoji: '🟡',
    label: '注意份量',
    bgClass: 'bg-yellow-50 border-yellow-200',
    textClass: 'text-yellow-800',
    badgeClass: 'bg-yellow-100 text-yellow-800',
    barClass: 'bg-yellow-500',
  },
  LIMIT: {
    emoji: '🟠',
    label: '建议少吃',
    bgClass: 'bg-orange-50 border-orange-200',
    textClass: 'text-orange-800',
    badgeClass: 'bg-orange-100 text-orange-800',
    barClass: 'bg-orange-500',
  },
  AVOID: {
    emoji: '🔴',
    label: '不建议',
    bgClass: 'bg-red-50 border-red-200',
    textClass: 'text-red-800',
    badgeClass: 'bg-red-100 text-red-800',
    barClass: 'bg-red-500',
  },
} as const;

const SCORE_LABELS: Record<keyof NutritionScoreBreakdown, string> = {
  energy: '能量',
  proteinRatio: '蛋白质比',
  macroBalance: '宏量素平衡',
  foodQuality: '食物品质',
  satiety: '饱腹感',
  stability: '稳定性',
};

function getScoreColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

function getScoreLabel(score: number): string {
  if (score >= 90) return '优秀';
  if (score >= 75) return '良好';
  if (score >= 60) return '一般';
  if (score >= 40) return '较差';
  return '不达标';
}

interface DecisionCardProps {
  result: AnalysisResult;
}

export function DecisionCard({ result }: DecisionCardProps) {
  const decision = result.decision || 'SAFE';
  const config = DECISION_CONFIG[decision] || DECISION_CONFIG.SAFE;
  const [showBreakdown, setShowBreakdown] = useState(false);

  const hasNutritionScore = result.nutritionScore != null;
  const hasBreakdown = result.scoreBreakdown != null;
  const hasMacros =
    result.totalProtein != null || result.totalFat != null || result.totalCarbs != null;
  const protein = result.totalProtein ?? 0;
  const fat = result.totalFat ?? 0;
  const carbs = result.totalCarbs ?? 0;
  const macroTotal = protein + fat + carbs;

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

      {/* V6: 营养评分总分 */}
      {hasNutritionScore && (
        <div className="bg-white/60 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-muted-foreground">📈 营养评分</p>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-extrabold">{result.nutritionScore}</span>
              <span className="text-xs text-muted-foreground">/100</span>
              <span
                className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${getScoreColor(result.nutritionScore!)}`}
              >
                {getScoreLabel(result.nutritionScore!)}
              </span>
            </div>
          </div>
          <div className="h-2 bg-black/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getScoreColor(result.nutritionScore!)}`}
              style={{ width: `${Math.min(result.nutritionScore!, 100)}%` }}
            />
          </div>

          {/* 六维评分折叠 */}
          {hasBreakdown && (
            <>
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
              >
                <span>{showBreakdown ? '收起详情' : '查看六维评分详情'}</span>
                <span
                  className={`transition-transform duration-200 ${showBreakdown ? 'rotate-90' : ''}`}
                >
                  ▸
                </span>
              </button>
              {showBreakdown && (
                <div className="space-y-2 pt-1">
                  {(
                    Object.entries(result.scoreBreakdown!) as [
                      keyof NutritionScoreBreakdown,
                      number,
                    ][]
                  ).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16 shrink-0 text-right">
                        {SCORE_LABELS[key]}
                      </span>
                      <div className="flex-1 h-1.5 bg-black/5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${getScoreColor(value)}`}
                          style={{ width: `${Math.min(value, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold w-7 text-right">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* AI highlights */}
          {result.highlights && result.highlights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {result.highlights.map((h, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/80 border border-current/10 text-foreground/70"
                >
                  {h}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* V6: 宏量素分布条 */}
      {hasMacros && macroTotal > 0 && (
        <div className="bg-white/60 rounded-xl p-3 space-y-2">
          <p className="text-xs font-bold text-muted-foreground">🥗 宏量素分布</p>
          <div className="h-3 rounded-full overflow-hidden flex">
            <div
              className="bg-blue-500 transition-all duration-300"
              style={{ width: `${(protein / macroTotal) * 100}%` }}
              title={`蛋白质 ${protein}g`}
            />
            <div
              className="bg-amber-500 transition-all duration-300"
              style={{ width: `${(fat / macroTotal) * 100}%` }}
              title={`脂肪 ${fat}g`}
            />
            <div
              className="bg-emerald-500 transition-all duration-300"
              style={{ width: `${(carbs / macroTotal) * 100}%` }}
              title={`碳水 ${carbs}g`}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              蛋白质 {protein}g ({Math.round((protein / macroTotal) * 100)}%)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
              脂肪 {fat}g ({Math.round((fat / macroTotal) * 100)}%)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              碳水 {carbs}g ({Math.round((carbs / macroTotal) * 100)}%)
            </span>
          </div>
        </div>
      )}

      {/* 建议 */}
      {result.suggestion && (
        <div className="bg-white/60 rounded-xl p-3">
          <p className="text-xs font-bold text-muted-foreground mb-1">💡 建议</p>
          <p className="text-sm">{result.suggestion}</p>
        </div>
      )}

      {/* 替代方案（可点击跳转食物库） */}
      {result.insteadOptions && result.insteadOptions.length > 0 && (
        <div className="bg-white/60 rounded-xl p-3">
          <p className="text-xs font-bold text-muted-foreground mb-2">🔄 替代方案</p>
          <div className="flex flex-wrap gap-2">
            {result.insteadOptions.map((option, i) => (
              <LocalizedLink
                key={i}
                href={`/foods/${encodeURIComponent(option)}`}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${config.bgClass} hover:opacity-80 active:scale-[0.97] transition-all inline-flex items-center gap-1`}
              >
                {option}
                <svg
                  className="w-3 h-3 opacity-50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </LocalizedLink>
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
