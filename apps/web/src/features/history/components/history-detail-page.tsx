'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useAnalysisDetail,
  useFoodAnalysis,
} from '@/features/food-analysis/hooks/use-food-analysis';
import { useToast } from '@/lib/hooks/use-toast';
import {
  DECISION_CONFIG,
  MEAL_LABELS,
  SCORE_LABELS,
  getScoreColor,
  getScoreLabel,
} from '@/lib/constants/food';
import type { AnalysisResult, NutritionScoreBreakdown } from '@/types/food';

function formatDetailDate(dateStr: string): string {
  const date = new Date(dateStr);
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}

// ── Props ──
interface HistoryDetailPageProps {
  analysisId: string;
}

export function HistoryDetailPage({ analysisId }: HistoryDetailPageProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { deleteRecord, isDeleting } = useFoodAnalysis();
  const { data: result, isLoading, error } = useAnalysisDetail(analysisId);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = async () => {
    try {
      await deleteRecord(analysisId);
      toast({ title: '已删除', description: '分析记录已删除' });
      router.back();
    } catch {
      toast({ title: '删除失败', description: '请稍后再试', variant: 'destructive' });
    }
    setShowDeleteConfirm(false);
  };

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Header onBack={() => router.back()} />
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">加载详情中...</p>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error || !result) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Header onBack={() => router.back()} />
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-7 h-7 text-red-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : '无法加载分析详情'}
          </p>
          <button
            onClick={() => router.back()}
            className="px-5 py-2 bg-primary text-primary-foreground rounded-full text-sm font-bold active:scale-[0.97] transition-all"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  const decision = result.decision || 'SAFE';
  const config = DECISION_CONFIG[decision] || DECISION_CONFIG.SAFE;
  const hasNutritionScore = result.nutritionScore != null;
  const hasBreakdown = result.scoreBreakdown != null;
  const protein = result.totalProtein ?? 0;
  const fat = result.totalFat ?? 0;
  const carbs = result.totalCarbs ?? 0;
  const macroTotal = protein + fat + carbs;
  const hasMacros = macroTotal > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header onBack={() => router.back()} onDelete={() => setShowDeleteConfirm(true)} />

      <main className="px-6 py-4 max-w-lg mx-auto pb-32 space-y-5">
        {/* 图片（如有） */}
        {result.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.imageUrl}
            alt="食物图片"
            className="w-full rounded-2xl object-cover max-h-60"
          />
        )}

        {/* 决策头卡 */}
        <div className={`rounded-2xl border p-5 space-y-3 ${config.bgClass}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{config.emoji}</span>
              <span className={`text-lg font-bold ${config.textClass}`}>{config.label}</span>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${config.badgeClass}`}>
              {result.totalCalories} kcal
            </span>
          </div>

          {/* 餐型 + 时间 */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {result.mealType && (
              <span className="px-2 py-0.5 bg-white/50 rounded-full font-medium">
                {MEAL_LABELS[result.mealType] || result.mealType}
              </span>
            )}
          </div>

          {result.reason && (
            <p className={`text-sm font-medium ${config.textClass}`}>{result.reason}</p>
          )}
        </div>

        {/* 食物清单 */}
        {result.foods && result.foods.length > 0 && (
          <section className="bg-card rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-muted-foreground">
              识别食物（{result.foods.length} 种）
            </h3>
            <div className="divide-y divide-border">
              {result.foods.map((food, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium">{food.name}</p>
                    {food.quantity && (
                      <p className="text-xs text-muted-foreground mt-0.5">{food.quantity}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-primary">{food.calories} kcal</p>
                    {(food.protein != null || food.fat != null || food.carbs != null) && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {food.protein != null && `蛋白${food.protein}g `}
                        {food.fat != null && `脂肪${food.fat}g `}
                        {food.carbs != null && `碳水${food.carbs}g`}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 营养评分 */}
        {hasNutritionScore && (
          <NutritionScoreSection
            score={result.nutritionScore!}
            breakdown={hasBreakdown ? result.scoreBreakdown! : undefined}
            highlights={result.highlights}
          />
        )}

        {/* 宏量素分布 */}
        {hasMacros && (
          <MacroDistribution protein={protein} fat={fat} carbs={carbs} total={macroTotal} />
        )}

        {/* 建议 */}
        {result.suggestion && (
          <section className="bg-card rounded-2xl p-4">
            <h3 className="text-xs font-bold text-muted-foreground mb-2">建议</h3>
            <p className="text-sm leading-relaxed">{result.suggestion}</p>
          </section>
        )}

        {/* 替代方案 */}
        {result.insteadOptions && result.insteadOptions.length > 0 && (
          <section className="bg-card rounded-2xl p-4">
            <h3 className="text-xs font-bold text-muted-foreground mb-2">替代方案</h3>
            <div className="flex flex-wrap gap-2">
              {result.insteadOptions.map((opt, i) => (
                <span
                  key={i}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-primary/5 border border-primary/10"
                >
                  {opt}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* 补救策略 */}
        {result.compensation &&
          (result.compensation.diet ||
            result.compensation.activity ||
            result.compensation.nextMeal) && (
            <section className="bg-card rounded-2xl p-4 space-y-2">
              <h3 className="text-xs font-bold text-muted-foreground">补救策略</h3>
              {result.compensation.diet && (
                <p className="text-sm flex items-start gap-2">
                  <span className="shrink-0">🍽️</span>
                  <span>{result.compensation.diet}</span>
                </p>
              )}
              {result.compensation.activity && (
                <p className="text-sm flex items-start gap-2">
                  <span className="shrink-0">🏃</span>
                  <span>{result.compensation.activity}</span>
                </p>
              )}
              {result.compensation.nextMeal && (
                <p className="text-sm flex items-start gap-2">
                  <span className="shrink-0">⏭️</span>
                  <span>{result.compensation.nextMeal}</span>
                </p>
              )}
            </section>
          )}

        {/* 今日状态 + 鼓励 */}
        {(result.contextComment || result.encouragement) && (
          <section className="bg-card rounded-2xl p-4 space-y-2">
            {result.contextComment && (
              <p className="text-xs text-muted-foreground italic">📊 {result.contextComment}</p>
            )}
            {result.encouragement && (
              <p className="text-sm font-medium text-center pt-1">✨ {result.encouragement}</p>
            )}
          </section>
        )}

        {/* AI 建议（advice） */}
        {result.advice && (
          <section className="bg-card rounded-2xl p-4">
            <h3 className="text-xs font-bold text-muted-foreground mb-2">AI 综合建议</h3>
            <p className="text-sm leading-relaxed text-foreground/80">{result.advice}</p>
          </section>
        )}
      </main>

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-end justify-center animate-in fade-in">
          <div className="w-full max-w-lg bg-card rounded-t-3xl p-6 space-y-4 animate-in slide-in-from-bottom duration-200">
            <h3 className="text-lg font-bold text-center">确认删除</h3>
            <p className="text-sm text-muted-foreground text-center">
              删除后无法恢复，确定要删除这条分析记录吗？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="flex-1 py-3 rounded-2xl bg-muted text-sm font-bold active:scale-[0.97] transition-all"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 py-3 rounded-2xl bg-red-500 text-white text-sm font-bold active:scale-[0.97] transition-all disabled:opacity-60"
              >
                {isDeleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Header ──
function Header({ onBack, onDelete }: { onBack: () => void; onDelete?: () => void }) {
  return (
    <nav className="sticky top-0 z-50 glass-morphism">
      <div className="flex items-center justify-between px-6 py-4 max-w-lg mx-auto">
        <div className="flex items-center">
          <button onClick={onBack} className="mr-4 text-foreground/70 hover:text-foreground">
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>
          <h1 className="text-xl font-extrabold font-headline tracking-tight">分析详情</h1>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-red-400 hover:text-red-500 transition-colors p-1"
            title="删除"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </nav>
  );
}

// ── 营养评分段 ──
function NutritionScoreSection({
  score,
  breakdown,
  highlights,
}: {
  score: number;
  breakdown?: NutritionScoreBreakdown;
  highlights?: string[];
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  return (
    <section className="bg-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-muted-foreground">营养评分</h3>
        <div className="flex items-center gap-1.5">
          <span className="text-xl font-extrabold">{score}</span>
          <span className="text-xs text-muted-foreground">/100</span>
          <span
            className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${getScoreColor(score)}`}
          >
            {getScoreLabel(score)}
          </span>
        </div>
      </div>

      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getScoreColor(score)}`}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>

      {/* 六维详情 */}
      {breakdown && (
        <>
          <button
            onClick={() => setShowBreakdown((v) => !v)}
            className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{showBreakdown ? '收起详情' : '查看六维评分详情'}</span>
            <span
              className={`transition-transform duration-200 ${showBreakdown ? 'rotate-90' : ''}`}
            >
              ▸
            </span>
          </button>
          {showBreakdown && (
            <div className="space-y-2">
              {(Object.entries(breakdown) as [keyof NutritionScoreBreakdown, number][]).map(
                ([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-16 shrink-0 text-right">
                      {SCORE_LABELS[key]}
                    </span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${getScoreColor(value)}`}
                        style={{ width: `${Math.min(value, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold w-7 text-right">{value}</span>
                  </div>
                )
              )}
            </div>
          )}
        </>
      )}

      {/* Highlights */}
      {highlights && highlights.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {highlights.map((h, i) => (
            <span
              key={i}
              className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/5 border border-primary/10 text-foreground/70"
            >
              {h}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

// ── 宏量素分布 ──
function MacroDistribution({
  protein,
  fat,
  carbs,
  total,
}: {
  protein: number;
  fat: number;
  carbs: number;
  total: number;
}) {
  return (
    <section className="bg-card rounded-2xl p-4 space-y-2">
      <h3 className="text-xs font-bold text-muted-foreground">宏量素分布</h3>
      <div className="h-3 rounded-full overflow-hidden flex">
        <div
          className="bg-blue-500 transition-all duration-300"
          style={{ width: `${(protein / total) * 100}%` }}
        />
        <div
          className="bg-amber-500 transition-all duration-300"
          style={{ width: `${(fat / total) * 100}%` }}
        />
        <div
          className="bg-emerald-500 transition-all duration-300"
          style={{ width: `${(carbs / total) * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
          蛋白质 {protein}g ({Math.round((protein / total) * 100)}%)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
          脂肪 {fat}g ({Math.round((fat / total) * 100)}%)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          碳水 {carbs}g ({Math.round((carbs / total) * 100)}%)
        </span>
      </div>
    </section>
  );
}
