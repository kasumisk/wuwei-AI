'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useFoodAnalysis } from '@/features/food-analysis/hooks/use-food-analysis';
import { useToast } from '@/lib/hooks/use-toast';
import { useSubscription } from '@/features/subscription/hooks/use-subscription';
import { handlePaywallError } from '@/features/subscription/hooks/use-subscription';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { foodLibraryClientAPI } from '@/lib/api/food-library';
import { foodRecordService } from '@/lib/api/food-record';
import { DecisionCard } from './decision-card';
import { SavedImpact } from './saved-impact';
import { InputTabs, type InputTabType } from './input-tabs';
import { FrequentInput } from './frequent-input';
import { SearchInput } from './search-input';
import { LocalizedLink } from '@/components/common/localized-link';
import type { AnalysisResult, FoodItem } from '@/types/food';

type MealTypeOption = 'breakfast' | 'lunch' | 'dinner' | 'snack';
type Step = 'upload' | 'analyzing' | 'result' | 'saved';

const mealTypeLabels: Record<MealTypeOption, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

const TEXT_MAX_LENGTH = 500;
const ANALYZE_TIMEOUT_MS = 30_000; // 30秒超时

type QualityLevel = 'high' | 'medium' | 'low';

type ResultQuality = {
  score: number;
  level: QualityLevel;
  macroCoveragePercent: number;
  hasBreakdown: boolean;
  hasAlternatives: boolean;
  tips: string[];
};

const BREAKDOWN_DIMENSION_LABELS: Record<string, string> = {
  energy: '热量',
  proteinRatio: '蛋白质比例',
  macroBalance: '三大营养素均衡',
  foodQuality: '食物质量',
  satiety: '饱腹感',
  stability: '稳定性',
  glycemicImpact: '血糖影响',
  mealQuality: '进餐质量',
};

function normalizeToPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  // 兼容 0-1 比例和 0-100 百分比两种返回格式
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(Math.round(pct), 100));
}

function normalizeScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(Math.round(n), 100));
}

function buildCoachPromptFromAnalysis(params: {
  mealLabel: string;
  foodNames: string;
  totalCalories: number;
  decision?: string;
  nutritionScore?: number;
  riskLevel?: string;
  advice?: string;
}): string {
  const scorePart = params.nutritionScore != null ? `营养评分 ${params.nutritionScore}/100。` : '';
  const riskPart = params.riskLevel ? `风险等级 ${params.riskLevel}。` : '';
  const advicePart = params.advice ? `系统建议：${params.advice}。` : '';

  return [
    `我刚完成${params.mealLabel}分析：${params.foodNames}，总热量约 ${params.totalCalories}kcal。`,
    `当前判定：${params.decision || 'OK'}。`,
    scorePart,
    riskPart,
    advicePart,
    '请你按“这餐是否需要调整 -> 如何补救 -> 下一餐怎么搭配”的结构，给我一个可执行方案。',
  ]
    .filter(Boolean)
    .join(' ');
}

function hasQuantityHint(text: string): boolean {
  return /(\d|半|一份|一碗|一盘|克|g|ml|个|块|勺|杯)/i.test(text);
}

function hasCookingHint(text: string): boolean {
  return /(炸|煎|炒|蒸|煮|烤|焗|拌|红烧|清蒸|水煮|油炸)/.test(text);
}

function computeResultQuality(result: AnalysisResult, foods: FoodItem[]): ResultQuality {
  const foodCount = foods.length;
  const macroCoveredCount = foods.filter(
    (f) => f.protein != null && f.fat != null && f.carbs != null
  ).length;
  const macroCoveragePercent =
    foodCount > 0 ? Math.round((macroCoveredCount / foodCount) * 100) : 0;
  const hasBreakdown = !!result.scoreBreakdown;
  const hasAlternatives = (result.insteadOptions || []).length > 0;

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (foodCount >= 3 ? 35 : foodCount === 2 ? 25 : foodCount === 1 ? 15 : 0) +
          macroCoveragePercent * 0.35 +
          (hasBreakdown ? 20 : 0) +
          (hasAlternatives ? 10 : 0)
      )
    )
  );

  const level: QualityLevel = score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low';

  const tips: string[] = [];
  if (foodCount <= 1) {
    tips.push('可补充同餐其他食物（饮料/酱料/加餐），让结果更接近真实摄入。');
  }
  if (macroCoveragePercent < 70) {
    tips.push('部分食物缺少宏量估算，建议在文字描述中补充做法和份量。');
  }
  if (!hasBreakdown) {
    tips.push('当前缺少分维度评分，可重新分析或在教练中请求“分项复盘”。');
  }
  if (!hasAlternatives) {
    tips.push('可让 AI 教练基于本餐给出替代搭配，提升下一餐可执行性。');
  }

  return {
    score,
    level,
    macroCoveragePercent,
    hasBreakdown,
    hasAlternatives,
    tips: tips.slice(0, 3),
  };
}

function buildEnhancedTextInput(text: string): string {
  let next = text.trim();
  if (!hasQuantityHint(next)) {
    next = `${next}${next ? '，' : ''}每种食物请按常见份量估算`;
  }
  if (!hasCookingHint(next)) {
    next = `${next}${next ? '，' : ''}并注明主要做法（如清蒸/红烧/油炸）`;
  }
  return next.slice(0, TEXT_MAX_LENGTH);
}

function buildCompletenessCoachPrompt(params: {
  quality: ResultQuality;
  mealLabel: string;
  totalCalories: number;
  foodNames: string;
  decision?: string;
}): string {
  const keyGap = params.quality.macroCoveragePercent < 70 ? '宏量估算覆盖不足' : '执行动作不够明确';

  return [
    `请帮我做一次“分析完整度复盘”。这顿是${params.mealLabel}，${params.foodNames}，总热量约 ${params.totalCalories}kcal。`,
    `系统判定：${params.decision || 'OK'}，当前完整度 ${params.quality.score} 分。`,
    `主要缺口：${keyGap}。`,
    '请按三段输出：1) 这份分析还缺什么 2) 我该怎么补充信息重分析 3) 不重分析时如何先做稳妥决策。',
  ].join(' ');
}

export function AnalyzePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn } = useAuth();
  const {
    analyzeImage,
    analyzeText,
    saveRecord,
    saveAnalysis,
    analyzing,
    isSaving,
    isSavingAnalysis,
  } = useFoodAnalysis();
  const { toast } = useToast();
  const { isFree } = useSubscription();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyzeAbortRef = useRef(false);
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('upload');
  const [inputMode, setInputMode] = useState<InputTabType>(() => {
    const tab = searchParams.get('tab');
    if (tab === 'image' || tab === 'text' || tab === 'frequent' || tab === 'search') return tab;
    return 'image';
  });
  const [mealType, setMealType] = useState<MealTypeOption>(() => {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 10) return 'breakfast';
    if (hour >= 10 && hour < 14) return 'lunch';
    if (hour >= 14 && hour < 17) return 'snack';
    if (hour >= 17 && hour < 21) return 'dinner';
    return 'snack'; // 深夜默认加餐
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [textInput, setTextInput] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('analyze_text_draft') || '';
    }
    return '';
  });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [editedFoods, setEditedFoods] = useState<FoodItem[]>([]);
  const [analyzeElapsed, setAnalyzeElapsed] = useState(0);
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  const [preSaveSummary, setPreSaveSummary] = useState<import('@/types/food').DailySummary | null>(
    null
  );

  console.log('result', JSON.stringify(result));
  useEffect(() => {
    if (!isLoggedIn) router.push('/login');
  }, [isLoggedIn, router]);

  // ── 文字输入暂存到 sessionStorage ──
  useEffect(() => {
    if (textInput) {
      sessionStorage.setItem('analyze_text_draft', textInput);
    } else {
      sessionStorage.removeItem('analyze_text_draft');
    }
  }, [textInput]);

  // ── ObjectURL 清理：避免内存泄漏 ──
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // ── 分析计时器 ──
  useEffect(() => {
    if (step !== 'analyzing') return;
    const start = Date.now();
    const timer = setInterval(() => {
      setAnalyzeElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [step]);

  // ── 图片选择 ──
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 10 * 1024 * 1024) {
        toast({ title: '图片不能超过 10MB', variant: 'destructive' });
        return;
      }

      setSelectedFile(file);
      // 释放旧的 ObjectURL 再创建新的
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
    },
    [toast, previewUrl]
  );

  // ── 图片分析（带超时） ──
  const handleAnalyzeImage = useCallback(async () => {
    if (!selectedFile) return;
    setAnalyzeElapsed(0);
    setStep('analyzing');
    analyzeAbortRef.current = false;

    try {
      const res = await Promise.race([
        analyzeImage(selectedFile, mealType),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('分析超时，请重试')), ANALYZE_TIMEOUT_MS)
        ),
      ]);
      if (analyzeAbortRef.current) return; // 用户已取消
      setResult(res);
      setEditedFoods(res.foods);
      setStep('result');
    } catch (err) {
      if (analyzeAbortRef.current) return; // 用户已取消
      // 检查是否是 paywall 错误
      if (err && typeof err === 'object' && handlePaywallError(err as Record<string, unknown>)) {
        setStep('upload');
        return;
      }
      toast({
        title: err instanceof Error ? err.message : 'AI 分析失败',
        variant: 'destructive',
      });
      setStep('upload');
    }
  }, [selectedFile, mealType, analyzeImage, toast]);

  // ── 文字分析（带超时） ──
  const analyzeTextByContent = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        toast({ title: '请输入食物描述', variant: 'destructive' });
        return;
      }
      if (trimmed.length > TEXT_MAX_LENGTH) {
        toast({ title: `描述不能超过 ${TEXT_MAX_LENGTH} 字`, variant: 'destructive' });
        return;
      }
      setAnalyzeElapsed(0);
      setStep('analyzing');
      analyzeAbortRef.current = false;

      try {
        const res = await Promise.race([
          analyzeText(trimmed, mealType),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('分析超时，请重试')), ANALYZE_TIMEOUT_MS)
          ),
        ]);
        if (analyzeAbortRef.current) return;
        setResult(res);
        setEditedFoods(res.foods);
        setStep('result');
      } catch (err) {
        if (analyzeAbortRef.current) return;
        if (err && typeof err === 'object' && handlePaywallError(err as Record<string, unknown>)) {
          setStep('upload');
          return;
        }
        toast({
          title: err instanceof Error ? err.message : 'AI 分析失败',
          variant: 'destructive',
        });
        setStep('upload');
      }
    },
    [analyzeText, mealType, toast]
  );

  const handleAnalyzeText = useCallback(async () => {
    const trimmed = textInput.trim();
    if (!trimmed) {
      toast({ title: '请输入食物描述', variant: 'destructive' });
      return;
    }
    await analyzeTextByContent(trimmed);
  }, [textInput, analyzeTextByContent, toast]);

  // ── 从食物库/常吃直接添加记录 ──
  const addFromLibraryMutation = useMutation({
    mutationFn: ({
      foodId,
      servingGrams,
    }: {
      foodId: string;
      name: string;
      servingGrams: number;
    }) => foodLibraryClientAPI.addFromLibrary(foodId, servingGrams, mealType),
    onSuccess: (_data, variables) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['nutrition-score'] });
      queryClient.invalidateQueries({ queryKey: ['meal-suggestion'] });
      queryClient.invalidateQueries({ queryKey: ['daily-plan'] });
      toast({ title: `已将「${variables.name}」记录到${mealTypeLabels[mealType]}` });
    },
    onError: (err) => {
      // 检查是否是 paywall 错误
      if (
        err &&
        typeof err === 'object' &&
        handlePaywallError(err as unknown as Record<string, unknown>)
      ) {
        return;
      }
      toast({
        title: err instanceof Error ? err.message : '添加失败',
        variant: 'destructive',
      });
    },
  });

  const handleAddFromLibrary = useCallback(
    (foodId: string, name: string, servingGrams: number) => {
      addFromLibraryMutation.mutate({ foodId, name, servingGrams });
    },
    [addFromLibraryMutation]
  );

  // ── 保存（优先使用 saveAnalysis 简化接口） ──
  const handleSave = useCallback(async () => {
    if (!result) return;
    try {
      // 保存前先快照当前 summary（用于 before/after 对比动画）
      try {
        const snap = await foodRecordService.getTodaySummary();
        setPreSaveSummary(snap);
      } catch {
        /* ignore snapshot errors */
      }
      let savedResult: { id?: string } | null = null;
      if (result.requestId) {
        savedResult = await saveAnalysis({
          analysisId: result.requestId,
          mealType,
        });
      } else {
        const totalCalories = editedFoods.reduce((sum, f) => sum + f.calories, 0);
        savedResult = await saveRecord({
          requestId: result.requestId,
          imageUrl: result.imageUrl,
          foods: editedFoods,
          totalCalories,
          mealType,
          advice: result.advice,
          isHealthy: result.isHealthy,
          decision: result.decision,
          riskLevel: result.riskLevel,
          reason: result.reason,
          suggestion: result.suggestion,
          insteadOptions: result.insteadOptions,
          compensation: result.compensation,
          contextComment: result.contextComment,
          encouragement: result.encouragement,
          totalProtein: result.totalProtein,
          totalFat: result.totalFat,
          totalCarbs: result.totalCarbs,
          avgQuality: undefined,
          avgSatiety: undefined,
          nutritionScore: result.nutritionScore,
        });
      }
      // 提取 recordId（用于反馈组件）
      const recordId = savedResult?.id || null;
      if (recordId) setSavedRecordId(recordId);
      setStep('saved');
      sessionStorage.removeItem('analyze_text_draft');
      toast({ title: '记录已保存！' });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : '保存失败',
        variant: 'destructive',
      });
    }
  }, [result, editedFoods, mealType, saveAnalysis, saveRecord, toast]);

  const handleRemoveFood = useCallback((index: number) => {
    setEditedFoods((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleReset = useCallback(() => {
    setStep('upload');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setSelectedFile(null);
    setTextInput('');
    sessionStorage.removeItem('analyze_text_draft');
    setResult(null);
    setEditedFoods([]);
    setSavedRecordId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [previewUrl]);

  const goToCoachWithAnalysis = useCallback(
    (
      analysis: AnalysisResult,
      foods: FoodItem[],
      totalCalories: number,
      currentMeal: MealTypeOption,
      customPrompt?: string
    ) => {
      const foodNames = foods.map((f) => f.name).join('、') || '本餐食物';
      const prompt =
        customPrompt ||
        buildCoachPromptFromAnalysis({
          mealLabel: mealTypeLabels[currentMeal],
          foodNames,
          totalCalories,
          decision: analysis.decision,
          nutritionScore: analysis.nutritionScore,
          riskLevel: analysis.riskLevel,
          advice: analysis.advice,
        });

      try {
        const decisionFactors = analysis.scoreBreakdown
          ? Object.entries(analysis.scoreBreakdown).map(([dimension, score]) => ({
              dimension,
              score,
              impact: score >= 70 ? 'positive' : score >= 45 ? 'neutral' : 'negative',
              message: `${dimension} 评分 ${score}`,
            }))
          : undefined;

        sessionStorage.setItem(
          'coach_analysis_context',
          JSON.stringify({
            foods: foods.map((f) => ({
              name: f.name,
              calories: f.calories,
              protein: f.protein,
              fat: f.fat,
              carbs: f.carbs,
            })),
            totalCalories,
            totalProtein: analysis.totalProtein,
            totalFat: analysis.totalFat,
            totalCarbs: analysis.totalCarbs,
            decision: analysis.decision,
            riskLevel: analysis.riskLevel,
            nutritionScore: analysis.nutritionScore,
            advice: analysis.advice,
            mealType: currentMeal,
            breakdown: analysis.scoreBreakdown,
            decisionFactors,
            nextMealAdvice: analysis.compensation?.nextMeal
              ? {
                  targetCalories: Math.max(200, 600 - Math.round(totalCalories * 0.2)),
                  targetProtein: Math.max(20, Math.round((analysis.totalProtein ?? 0) * 0.6)),
                  emphasis: '控热量 + 补蛋白',
                  suggestion: analysis.compensation.nextMeal,
                }
              : undefined,
            timestamp: new Date().toISOString(),
          })
        );

        // 教练页优先读取自动首问，避免 URL 过长并保证首问模板统一。
        sessionStorage.setItem('coach_auto_prompt', prompt);
      } catch {
        /* ignore */
      }

      router.push(`/coach?q=${encodeURIComponent(prompt)}`);
    },
    [router]
  );

  // ── Tab 切换 ──
  const handleSwitchMode = useCallback(
    (mode: InputTabType) => {
      if (step !== 'upload') return; // 分析中/结果中不允许切换
      setInputMode(mode);
      // 清除之前模式的状态
      if (mode !== 'image') {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      if (mode !== 'text') {
        setTextInput('');
      }
    },
    [step, previewUrl]
  );

  // ── 取消分析 ──
  const handleCancelAnalyze = useCallback(() => {
    analyzeAbortRef.current = true;
    setStep('upload');
    toast({ title: '已取消分析' });
  }, [toast]);

  const handleQuickReanalyze = useCallback(async () => {
    if (inputMode !== 'text') {
      toast({ title: '图片模式请补充拍摄信息后重新分析' });
      setStep('upload');
      return;
    }

    const enhanced = buildEnhancedTextInput(textInput);
    if (!enhanced.trim()) {
      toast({ title: '请先输入食物描述', variant: 'destructive' });
      setStep('upload');
      return;
    }

    setTextInput(enhanced);
    await analyzeTextByContent(enhanced);
  }, [inputMode, textInput, analyzeTextByContent, toast]);

  const handleCoachCompletenessReview = useCallback(() => {
    if (!result) return;

    const currentEditedTotal = editedFoods.reduce((sum, f) => sum + f.calories, 0);
    const currentResultQuality = computeResultQuality(result, editedFoods);

    const foodNames = editedFoods.map((f) => f.name).join('、') || '本餐食物';
    const prompt = buildCompletenessCoachPrompt({
      quality: currentResultQuality,
      mealLabel: mealTypeLabels[mealType],
      totalCalories: currentEditedTotal,
      foodNames,
      decision: result.decision,
    });

    goToCoachWithAnalysis(result, editedFoods, currentEditedTotal, mealType, prompt);
  }, [result, editedFoods, mealType, goToCoachWithAnalysis]);

  const editedTotal = editedFoods.reduce((sum, f) => sum + f.calories, 0);
  const resultQuality = result ? computeResultQuality(result, editedFoods) : null;
  const saving = isSaving || isSavingAnalysis;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="flex items-center justify-between px-6 py-4 max-w-lg mx-auto">
          <div className="flex items-center">
            <button
              onClick={() => router.back()}
              className="mr-4 text-foreground/70 hover:text-foreground"
              aria-label="返回"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
            <h1 className="text-xl font-extrabold font-headline tracking-tight">食物分析</h1>
          </div>
          {/* 历史入口 */}
          <LocalizedLink
            href="/history"
            className="text-xs text-primary font-medium flex items-center gap-1 hover:opacity-80"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
            </svg>
            历史
          </LocalizedLink>
        </div>
      </nav>

      <main className="px-6 py-6 max-w-lg mx-auto pb-32">
        {/* Step 1: Upload / Text / Frequent / Search Input */}
        {step === 'upload' && (
          <div className="space-y-5">
            {/* Input Mode Tabs — 4 tabs */}
            <InputTabs activeTab={inputMode} onTabChange={handleSwitchMode} />

            {/* Meal type selector */}
            <div className="flex gap-2">
              {(Object.entries(mealTypeLabels) as [MealTypeOption, string][]).map(
                ([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setMealType(key)}
                    className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                      mealType === key
                        ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {label}
                  </button>
                )
              )}
            </div>

            {/* 免费用户提示 — 仅在 AI 模式(image/text)下显示 */}
            {isFree && (inputMode === 'image' || inputMode === 'text') && (
              <div className="bg-linear-to-r from-primary/5 to-primary/10 border border-primary/15 rounded-xl px-4 py-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">
                    {inputMode === 'image' ? '📸 图片分析' : '✏️ 文字分析'}
                  </span>
                  <LocalizedLink
                    href="/pricing"
                    className="text-xs text-primary font-bold shrink-0 px-3 py-1 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors"
                  >
                    升级解锁更多
                  </LocalizedLink>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {inputMode === 'image'
                    ? '免费版每天 3 次图片分析 · 升级 Pro 可达 20 次/天'
                    : '免费版每天 20 次文字分析 · 升级 Pro 无限制'}
                </p>
              </div>
            )}

            {/* ═══ Image Upload Mode ═══ */}
            {inputMode === 'image' && (
              <>
                <div
                  className="bg-card rounded-2xl border-2 border-dashed border-(--color-outline-variant)/30 p-8 flex flex-col items-center gap-4 cursor-pointer active:scale-[0.98] transition-transform"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="点击上传食物图片"
                >
                  {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt="预览"
                      className="w-full max-h-64 object-contain rounded-xl"
                    />
                  ) : (
                    <>
                      <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center">
                        <svg
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          width="40"
                          height="40"
                          className="text-primary"
                        >
                          <path d="M3 4V1h2v3h3v2H5v3H3V6H0V4h3zm3 6V7h3V4h7l1.83 2H21c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V10h3zm7 9c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-3.2-5c0 1.77 1.43 3.2 3.2 3.2s3.2-1.43 3.2-3.2-1.43-3.2-3.2-3.2-3.2 1.43-3.2 3.2z" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="font-bold">拍照或上传外卖截图</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          支持 JPG、PNG、WebP，最大 10MB
                        </p>
                      </div>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>

                {selectedFile && (
                  <>
                    <div className="bg-card border border-border rounded-xl p-3 space-y-1.5">
                      <p className="text-xs font-bold">提升图片分析准确度</p>
                      <p className="text-[11px] text-muted-foreground">
                        1) 尽量一次拍全餐食 2) 保证光线清晰 3) 酱料和饮料尽量入镜
                      </p>
                    </div>
                    <button
                      onClick={handleAnalyzeImage}
                      disabled={analyzing}
                      className="w-full bg-primary text-primary-foreground font-bold py-4 rounded-full flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                    >
                      {analyzing ? (
                        <>
                          <span className="animate-spin inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
                          AI 分析中...
                        </>
                      ) : (
                        '开始 AI 分析'
                      )}
                    </button>
                  </>
                )}
              </>
            )}

            {/* ═══ Text Input Mode ═══ */}
            {inputMode === 'text' && (
              <>
                <div className="bg-card rounded-2xl p-4 space-y-3">
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value.slice(0, TEXT_MAX_LENGTH))}
                    placeholder="描述你吃了什么，例如：&#10;一碗白米饭、红烧肉三块、炒青菜一盘、紫菜蛋花汤"
                    className="w-full min-h-35 bg-transparent resize-none text-sm leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
                    autoFocus
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>AI 会自动识别食物并计算营养</span>
                    <span
                      className={
                        textInput.length > TEXT_MAX_LENGTH * 0.9 ? 'text-destructive font-bold' : ''
                      }
                    >
                      {textInput.length}/{TEXT_MAX_LENGTH}
                    </span>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold">输入完善建议</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p className={hasQuantityHint(textInput) ? 'text-emerald-600' : ''}>
                      {hasQuantityHint(textInput)
                        ? '已包含份量信息'
                        : '建议补充份量（如 100g / 半碗 / 2个）'}
                    </p>
                    <p className={hasCookingHint(textInput) ? 'text-emerald-600' : ''}>
                      {hasCookingHint(textInput)
                        ? '已包含做法信息'
                        : '建议补充做法（如油炸/清蒸/红烧）'}
                    </p>
                  </div>
                  {!hasQuantityHint(textInput) && (
                    <button
                      onClick={() =>
                        setTextInput(
                          (prev) => `${prev}${prev.trim() ? '，' : ''}每种食物请按常见份量估算`
                        )
                      }
                      className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                    >
                      一键补充“份量提示”
                    </button>
                  )}
                </div>

                {/* 快捷输入示例 */}
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium px-1">快捷输入</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      '一碗白米饭+红烧肉',
                      '全麦面包+牛奶+鸡蛋',
                      '麻辣烫一份',
                      '沙拉+鸡胸肉',
                      '饺子10个',
                      '外卖黄焖鸡',
                    ].map((example) => (
                      <button
                        key={example}
                        onClick={() => setTextInput(example)}
                        className="px-3 py-1.5 bg-muted rounded-full text-xs text-muted-foreground hover:bg-muted/80 active:scale-[0.97] transition-all"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleAnalyzeText}
                  disabled={analyzing || !textInput.trim()}
                  className="w-full bg-primary text-primary-foreground font-bold py-4 rounded-full flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                >
                  {analyzing ? (
                    <>
                      <span className="animate-spin inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
                      AI 分析中...
                    </>
                  ) : (
                    '开始 AI 分析'
                  )}
                </button>
              </>
            )}

            {/* ═══ Frequent Foods Mode ═══ */}
            {inputMode === 'frequent' && (
              <FrequentInput
                mealType={mealType}
                onAddFromLibrary={handleAddFromLibrary}
                isAdding={addFromLibraryMutation.isPending}
              />
            )}

            {/* ═══ Food Library Search Mode ═══ */}
            {inputMode === 'search' && (
              <SearchInput
                mealType={mealType}
                onAddFromLibrary={handleAddFromLibrary}
                isAdding={addFromLibraryMutation.isPending}
              />
            )}
          </div>
        )}

        {/* Step 2: Analyzing */}
        {step === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <div className="relative w-20 h-20 rounded-full bg-primary flex items-center justify-center">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="32"
                  height="32"
                  className="text-primary-foreground"
                  aria-hidden="true"
                >
                  <path d="M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3z" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <h2 className="text-xl font-headline font-bold">AI 正在分析...</h2>
              <p className="text-muted-foreground text-sm mt-2">
                {analyzeElapsed < 3
                  ? '上传中...'
                  : analyzeElapsed < 8
                    ? inputMode === 'text'
                      ? '解析食物描述...'
                      : '识别食物中...'
                    : analyzeElapsed < 20
                      ? '计算营养数据...'
                      : '即将完成...'}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">已用时 {analyzeElapsed}s</p>
            </div>
            <button
              onClick={handleCancelAnalyze}
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors mt-2"
            >
              取消分析
            </button>
          </div>
        )}

        {/* Step 3: Result */}
        {step === 'result' && result && (
          <div className="space-y-6">
            {/* 图片模式：显示预览 */}
            {inputMode === 'image' && previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="食物"
                className="w-full max-h-48 object-cover rounded-2xl"
              />
            )}

            {/* 文字模式：显示输入内容 */}
            {inputMode === 'text' && textInput && (
              <div className="bg-card rounded-2xl p-4">
                <p className="text-xs text-muted-foreground font-medium mb-1">你的描述</p>
                <p className="text-sm">{textInput}</p>
              </div>
            )}

            {/* Verdict Hero — 头条摘要 + 关键问题 */}
            {(result.headline ||
              (result.topIssues && result.topIssues.length > 0) ||
              (result.topStrengths && result.topStrengths.length > 0)) && (
              <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
                {result.headline && (
                  <h2 className="text-sm font-bold leading-snug">{result.headline}</h2>
                )}
                {result.topStrengths && result.topStrengths.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide">
                      优点
                    </p>
                    {result.topStrengths.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="text-emerald-500 mt-0.5">✓</span>
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                )}
                {result.topIssues && result.topIssues.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-rose-500 uppercase tracking-wide">
                      问题
                    </p>
                    {result.topIssues.map((issue, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="text-rose-400 mt-0.5">!</span>
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                )}
                {result.actionItems && result.actionItems.length > 0 && (
                  <div className="space-y-1 pt-1 border-t border-border">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                      行动建议
                    </p>
                    {result.actionItems.map((a, i) => (
                      <p key={i} className="text-xs text-foreground/80">
                        • {a}
                      </p>
                    ))}
                  </div>
                )}
              </section>
            )}

            <DecisionCard
              result={result}
              recordId={savedRecordId ?? undefined}
              onAnalyzeAlternative={(foodName) => {
                setTextInput(foodName);
                setStep('upload');
              }}
            />

            {/* 宏量完成度 — completionRatio */}
            {result.completionRatio && Object.keys(result.completionRatio).length > 0 && (
              <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <h3 className="text-sm font-bold">餐后今日完成率</h3>
                <div className="space-y-2">
                  {Object.entries(result.completionRatio).map(([key, ratio]) => {
                    const pct = normalizeToPercent(ratio);
                    const labels: Record<string, string> = {
                      calories: '热量',
                      protein: '蛋白质',
                      fat: '脂肪',
                      carbs: '碳水',
                    };
                    const colors: Record<string, string> = {
                      calories: 'bg-orange-400',
                      protein: 'bg-blue-400',
                      fat: 'bg-yellow-400',
                      carbs: 'bg-purple-400',
                    };
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground">{labels[key] ?? key}</span>
                          <span
                            className={`font-bold ${pct >= 90 ? 'text-emerald-500' : pct >= 60 ? 'text-amber-500' : 'text-foreground'}`}
                          >
                            {pct}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${colors[key] ?? 'bg-primary'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 替代品候选 */}
            {result.replacementCandidates && result.replacementCandidates.length > 0 && (
              <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <h3 className="text-sm font-bold">推荐替代方案</h3>
                <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
                  {result.replacementCandidates.map((c, i) => (
                    <div
                      key={i}
                      className="shrink-0 snap-start w-44 bg-muted/60 rounded-xl p-3 space-y-1.5"
                    >
                      <p className="text-xs font-bold leading-tight">{c.name}</p>
                      {c.reason && (
                        <p className="text-[11px] text-muted-foreground leading-snug">{c.reason}</p>
                      )}
                      {c.comparison && (
                        <div className="text-[11px] space-y-0.5 pt-1 border-t border-border">
                          {c.comparison.caloriesDiff != null && (
                            <p
                              className={
                                c.comparison.caloriesDiff < 0 ? 'text-emerald-600' : 'text-rose-500'
                              }
                            >
                              热量 {c.comparison.caloriesDiff > 0 ? '+' : ''}
                              {c.comparison.caloriesDiff} kcal
                            </p>
                          )}
                          {c.comparison.proteinDiff != null && (
                            <p
                              className={
                                c.comparison.proteinDiff > 0
                                  ? 'text-blue-600'
                                  : 'text-muted-foreground'
                              }
                            >
                              蛋白质 {c.comparison.proteinDiff > 0 ? '+' : ''}
                              {c.comparison.proteinDiff}g
                            </p>
                          )}
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setTextInput(c.name);
                          setStep('upload');
                        }}
                        className="w-full text-[11px] font-bold text-primary hover:text-primary/80 text-left mt-1"
                      >
                        分析此替代 →
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 8维评分详解 */}
            {result.breakdownExplanations && result.breakdownExplanations.length > 0 && (
              <details className="bg-card border border-border rounded-2xl group">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none select-none">
                  <span className="text-sm font-bold">8维评分详解</span>
                  <svg
                    className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </summary>
                <div className="px-4 pb-4 space-y-2.5">
                  {result.breakdownExplanations.map((b, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 text-xs font-bold text-foreground">
                        {normalizeScore(b.score)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold">
                          {b.label || BREAKDOWN_DIMENSION_LABELS[b.dimension || ''] || b.dimension}
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                          {b.message || b.label}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* 推理链 */}
            {result.decisionChain && result.decisionChain.length > 0 && (
              <details className="bg-card border border-border rounded-2xl group">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none select-none">
                  <span className="text-sm font-bold">决策推理链</span>
                  <svg
                    className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </summary>
                <div className="px-4 pb-4 space-y-3">
                  {result.decisionChain.map((chain, i) => (
                    <div key={i} className="relative pl-6">
                      <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-bold text-primary">
                        {i + 1}
                      </div>
                      {i < result.decisionChain!.length - 1 && (
                        <div className="absolute left-1.75 top-5 w-px h-full bg-border" />
                      )}
                      <p className="text-xs font-bold">{chain.step}</p>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                        {chain.input}
                      </p>
                      <p className="text-[11px] font-medium text-primary mt-1">→ {chain.output}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* 下餐补救方向 */}
            {result.recoveryAction &&
              (result.recoveryAction.nextMealDirection ||
                result.recoveryAction.todayAdjustment) && (
                <section className="bg-card border border-border rounded-2xl p-4 space-y-2">
                  <h3 className="text-sm font-bold">下餐补救方向</h3>
                  {result.recoveryAction.nextMealDirection && (
                    <p className="text-xs text-foreground/80">
                      <span className="font-medium text-muted-foreground">下一餐：</span>
                      {result.recoveryAction.nextMealDirection}
                    </p>
                  )}
                  {result.recoveryAction.todayAdjustment && (
                    <p className="text-xs text-foreground/80">
                      <span className="font-medium text-muted-foreground">今日调整：</span>
                      {result.recoveryAction.todayAdjustment}
                    </p>
                  )}
                </section>
              )}

            {resultQuality && (
              <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold">分析完整度</h3>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      resultQuality.level === 'high'
                        ? 'bg-emerald-100 text-emerald-700'
                        : resultQuality.level === 'medium'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {resultQuality.level === 'high'
                      ? '高'
                      : resultQuality.level === 'medium'
                        ? '中'
                        : '低'}
                    （{resultQuality.score}分）
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-muted/60 rounded-lg px-3 py-2">
                    <p className="text-muted-foreground">宏量覆盖率</p>
                    <p className="font-bold mt-0.5">{resultQuality.macroCoveragePercent}%</p>
                  </div>
                  <div className="bg-muted/60 rounded-lg px-3 py-2">
                    <p className="text-muted-foreground">分维度评分</p>
                    <p className="font-bold mt-0.5">
                      {resultQuality.hasBreakdown ? '已生成' : '未完整'}
                    </p>
                  </div>
                </div>

                {resultQuality.tips.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold text-muted-foreground">建议你这样补强结果</p>
                    {resultQuality.tips.map((tip, i) => (
                      <p key={i} className="text-[12px] leading-relaxed text-foreground/80">
                        {i + 1}. {tip}
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  {resultQuality.level !== 'high' && (
                    <button
                      onClick={handleQuickReanalyze}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-primary/10 text-primary hover:bg-primary/15 active:scale-[0.98] transition-all"
                    >
                      {inputMode === 'text' ? '一键补全后重分析' : '返回补充后重分析'}
                    </button>
                  )}
                  <button
                    onClick={handleCoachCompletenessReview}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-muted text-foreground hover:bg-muted/80 active:scale-[0.98] transition-all"
                  >
                    让教练做分项复盘
                  </button>
                </div>
              </section>
            )}

            {/* 免费用户：结果页 contextual CTA — 提示升级可获得更精准分析 */}
            {isFree && (
              <div className="bg-linear-to-br from-primary/5 via-primary/8 to-violet-500/5 border border-primary/15 rounded-2xl p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <svg
                      className="w-5 h-5 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">解锁完整分析</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      升级可获得深度营养评分、个性化替代方案和更精准的宏量素分析
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    深度营养评分
                  </span>
                  <span className="text-border">·</span>
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    替代方案
                  </span>
                  <span className="text-border">·</span>
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    数据导出
                  </span>
                </div>
                <LocalizedLink
                  href="/pricing"
                  className="block w-full text-center bg-primary text-primary-foreground text-sm font-bold py-2.5 rounded-xl active:scale-[0.98] transition-all shadow-sm"
                  asButton
                >
                  查看升级方案 · Pro ¥19.9/月起
                </LocalizedLink>
              </div>
            )}

            <div className="space-y-3">
              <h3 className="font-bold text-sm px-1">识别的食物（点击 x 可删除）</h3>
              {editedFoods.map((food, i) => (
                <div key={i} className="bg-card rounded-xl p-4 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm">{food.name}</h4>
                      {'confidence' in food &&
                        typeof (food as { confidence?: number }).confidence === 'number' && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              ((food as { confidence?: number }).confidence ?? 0) >= 0.8
                                ? 'bg-emerald-100 text-emerald-700'
                                : ((food as { confidence?: number }).confidence ?? 0) >= 0.5
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-rose-100 text-rose-700'
                            }`}
                          >
                            {Math.round(((food as { confidence?: number }).confidence ?? 0) * 100)}%
                          </span>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {food.quantity || '1份'} • {food.category || '未分类'}
                    </p>
                    {(food.protein != null || food.fat != null || food.carbs != null) && (
                      <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                        {food.protein != null && `蛋白 ${food.protein}g`}
                        {food.fat != null && ` 脂肪 ${food.fat}g`}
                        {food.carbs != null && ` 碳水 ${food.carbs}g`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-bold text-primary">{food.calories} kcal</span>
                    <button
                      onClick={() => handleRemoveFood(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              {editedFoods.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-4">无识别结果</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="flex-1 bg-muted text-foreground font-bold py-4 rounded-full active:scale-[0.98] transition-all"
              >
                重新分析
              </button>
              <button
                onClick={handleSave}
                disabled={saving || editedFoods.length === 0}
                className="flex-1 bg-primary text-primary-foreground font-bold py-4 rounded-full active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
              >
                {saving ? '保存中...' : '确认保存'}
              </button>
            </div>

            {/* P1-6: 分析→教练无缝衔接（结构化摘要） */}
            <button
              onClick={() => {
                goToCoachWithAnalysis(result, editedFoods, editedTotal, mealType);
              }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-card border border-border text-sm font-medium text-foreground hover:bg-muted active:scale-[0.98] transition-all"
            >
              <svg
                className="w-4 h-4 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              问 AI 教练：这餐怎么吃更好？
            </button>
          </div>
        )}

        {/* Step 4: Saved — 今日影响预览 */}
        {step === 'saved' && (
          <SavedImpact
            mealType={mealType}
            beforeSummary={preSaveSummary}
            onReset={handleReset}
            onGoHome={() => router.push('/')}
            onGoToPlan={() => router.push('/plan')}
            onGoToCoach={() => {
              if (result) {
                goToCoachWithAnalysis(result, editedFoods, editedTotal, mealType);
                return;
              }
              const fallbackPrompt = `我刚记录了${mealTypeLabels[mealType]}，请根据我今天的饮食数据，给我下一餐的搭配建议。`;
              try {
                sessionStorage.setItem('coach_auto_prompt', fallbackPrompt);
              } catch {
                /* ignore */
              }
              router.push(`/coach?q=${encodeURIComponent(fallbackPrompt)}`);
            }}
          />
        )}
      </main>
    </div>
  );
}
