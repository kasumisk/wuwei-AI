'use client';

import { useState } from 'react';
import { DECISION_CONFIG, SCORE_LABELS, getScoreColor, getScoreLabel } from '@/lib/constants/food';
import { DecisionFeedback } from './decision-feedback';
import { AlternativeCarousel } from './alternative-carousel';
import { foodPlanService } from '@/lib/api/food-plan';
import type { AnalysisResult, NutritionScoreBreakdown } from '@/types/food';

/** P1-3: 风险等级标签配置 */
const RISK_LEVEL_CONFIG: Record<string, { label: string; className: string }> = {
  low: { label: '低风险', className: 'bg-green-100 text-green-700' },
  medium: { label: '中风险', className: 'bg-amber-100 text-amber-700' },
  high: { label: '高风险', className: 'bg-red-100 text-red-700' },
};

interface DecisionCardProps {
  result: AnalysisResult;
  /** recordId — 保存后回传，用于启用决策反馈 */
  recordId?: string;
  /** P2-4: 点击替代方案时触发新分析 */
  onAnalyzeAlternative?: (foodName: string) => void;
}

export function DecisionCard({ result, recordId, onAnalyzeAlternative }: DecisionCardProps) {
  const decision = result.decision || 'SAFE';
  const config = DECISION_CONFIG[decision] || DECISION_CONFIG.SAFE;
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [explainLoading, setExplainLoading] = useState<string | null>(null);
  const [explainResult, setExplainResult] = useState<string | null>(null);

  const hasNutritionScore = result.nutritionScore != null;
  const hasBreakdown = result.scoreBreakdown != null;
  const hasMacros =
    result.totalProtein != null || result.totalFat != null || result.totalCarbs != null;
  const protein = result.totalProtein ?? 0;
  const fat = result.totalFat ?? 0;
  const carbs = result.totalCarbs ?? 0;
  const macroTotal = protein + fat + carbs;

  /** P1-5: 查询"为什么不推荐" */
  const handleExplainWhyNot = async (foodName: string) => {
    try {
      setExplainLoading(foodName);
      const res = await foodPlanService.explainWhyNot(foodName, result.mealType || 'lunch');
      setExplainResult(res.explanation || res.reasons?.join('；') || '暂无详细解释');
    } catch {
      setExplainResult('暂时无法获取解释');
    } finally {
      setExplainLoading(null);
    }
  };

  return (
    <div className={` border overflow-hidden ${config.bgClass}`}>
      {/* V3: 决策横幅 — 更大更醒目的头部 */}
      <div className={`px-5 pt-5 pb-4 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12  bg-white/40 flex items-center justify-center shadow-sm">
            <span className="text-2xl leading-none">{config.emoji}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-xl font-extrabold leading-tight ${config.textClass}`}>
                {config.label}
              </span>
              {/* P1-3: 风险等级标签 */}
              {result.riskLevel && RISK_LEVEL_CONFIG[result.riskLevel] && (
                <span
                  className={`px-2 py-0.5  text-[10px] font-bold ${RISK_LEVEL_CONFIG[result.riskLevel].className}`}
                >
                  {RISK_LEVEL_CONFIG[result.riskLevel].label}
                </span>
              )}
            </div>
            {result.foods && result.foods.length > 0 && (
              <p className={`text-xs mt-0.5 opacity-70 ${config.textClass}`}>
                {result.foods.map((f: any) => (typeof f === 'string' ? f : f.name)).join('、')}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`px-3 py-1  text-sm font-extrabold ${config.badgeClass}`}>
            {result.totalCalories} kcal
          </span>
          {hasNutritionScore && (
            <span className={`text-[10px] font-bold opacity-70 ${config.textClass}`}>
              营养分 {result.nutritionScore}
            </span>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* 原因 */}
        {result.reason && (
          <p className={`text-sm font-medium ${config.textClass}`}>{result.reason}</p>
        )}

        {/* P1-3: 行动建议 */}
        {result.advice && (
          <div className="bg-white/70  p-3 border border-current/5">
            <p className="text-xs font-bold text-muted-foreground mb-1">🎯 行动建议</p>
            <p className="text-sm font-medium">{result.advice}</p>
          </div>
        )}

        {/* P1-5: caution/avoid 时显示"为什么不推荐"按钮 */}
        {(decision === 'LIMIT' || decision === 'AVOID') &&
          result.foods &&
          result.foods.length > 0 && (
            <div className="space-y-2">
              {!explainResult ? (
                <button
                  onClick={() => handleExplainWhyNot(result.foods[0]?.name || '')}
                  disabled={explainLoading !== null}
                  className="w-full py-2 rounded-lg text-xs font-bold bg-white/60 border border-current/10 hover:bg-white/80 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {explainLoading ? '分析中...' : `🤔 为什么不推荐「${result.foods[0]?.name}」？`}
                </button>
              ) : (
                <div className="bg-white/60  p-3">
                  <p className="text-xs font-bold text-muted-foreground mb-1">🔍 详细解释</p>
                  <p className="text-sm">{explainResult}</p>
                </div>
              )}
            </div>
          )}

        {/* V6: 营养评分总分 */}
        {hasNutritionScore && (
          <div className="bg-white/60  p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-muted-foreground">📈 营养评分</p>
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-extrabold">{result.nutritionScore}</span>
                <span className="text-xs text-muted-foreground">/100</span>
                <span
                  className={`ml-1 px-2 py-0.5  text-[10px] font-bold text-white ${getScoreColor(result.nutritionScore!)}`}
                >
                  {getScoreLabel(result.nutritionScore!)}
                </span>
              </div>
            </div>
            <div className="h-2 bg-black/5  overflow-hidden">
              <div
                className={`h-full  transition-all duration-500 ${getScoreColor(result.nutritionScore!)}`}
                style={{ width: `${Math.min(result.nutritionScore!, 100)}%` }}
              />
            </div>

            {/* 多维评分折叠 */}
            {hasBreakdown && (
              <>
                <button
                  onClick={() => setShowBreakdown((v) => !v)}
                  className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
                >
                  <span>{showBreakdown ? '收起详情' : '查看评分详情'}</span>
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
                        <div className="flex-1 h-1.5 bg-black/5  overflow-hidden">
                          <div
                            className={`h-full  transition-all duration-300 ${getScoreColor(value)}`}
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
                    className="px-2 py-0.5  text-[10px] font-medium bg-white/80 border border-current/10 text-foreground/70"
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
          <div className="bg-white/60  p-3 space-y-2">
            <p className="text-xs font-bold text-muted-foreground">🥗 宏量素分布</p>
            <div className="h-3  overflow-hidden flex">
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
                <span className="inline-block w-2 h-2  bg-blue-500" />
                蛋白质 {protein}g ({Math.round((protein / macroTotal) * 100)}%)
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2  bg-amber-500" />
                脂肪 {fat}g ({Math.round((fat / macroTotal) * 100)}%)
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2  bg-emerald-500" />
                碳水 {carbs}g ({Math.round((carbs / macroTotal) * 100)}%)
              </span>
            </div>
          </div>
        )}

        {/* 建议 */}
        {result.suggestion && (
          <div className="bg-white/60  p-3">
            <p className="text-xs font-bold text-muted-foreground mb-1">💡 建议</p>
            <p className="text-sm">{result.suggestion}</p>
          </div>
        )}

        {/* P2-4 / V3: 替代方案 — 横向滑动 Carousel */}
        {result.insteadOptions && result.insteadOptions.length > 0 && (
          <AlternativeCarousel
            options={result.insteadOptions}
            onAnalyze={onAnalyzeAlternative}
            bgClass={config.bgClass}
          />
        )}

        {/* 补救策略 */}
        {result.compensation &&
          (result.compensation.diet ||
            result.compensation.activity ||
            result.compensation.nextMeal) && (
            <div className="bg-white/60  p-3">
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

        {/* 决策反馈闭环 */}
        <DecisionFeedback recordId={recordId} decision={decision} />
      </div>
    </div>
  );
}
