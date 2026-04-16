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
  const [mealType, setMealType] = useState<MealTypeOption>('lunch');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [textInput, setTextInput] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [editedFoods, setEditedFoods] = useState<FoodItem[]>([]);
  const [analyzeElapsed, setAnalyzeElapsed] = useState(0);

  useEffect(() => {
    if (!isLoggedIn) router.push('/login');
  }, [isLoggedIn, router]);

  // ── ObjectURL 清理：避免内存泄漏 ──
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // ── 分析计时器 ──
  useEffect(() => {
    if (step !== 'analyzing') {
      setAnalyzeElapsed(0);
      return;
    }
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
  const handleAnalyzeText = useCallback(async () => {
    const trimmed = textInput.trim();
    if (!trimmed) {
      toast({ title: '请输入食物描述', variant: 'destructive' });
      return;
    }
    if (trimmed.length > TEXT_MAX_LENGTH) {
      toast({ title: `描述不能超过 ${TEXT_MAX_LENGTH} 字`, variant: 'destructive' });
      return;
    }
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
  }, [textInput, mealType, analyzeText, toast]);

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
      if (result.requestId) {
        // 优先用 saveAnalysis，后端自动关联分析结果
        await saveAnalysis({
          analysisId: result.requestId,
          mealType,
        });
      } else {
        // fallback: 手动传全部字段
        const totalCalories = editedFoods.reduce((sum, f) => sum + f.calories, 0);
        await saveRecord({
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
          avgQuality: result.avgQuality,
          avgSatiety: result.avgSatiety,
          nutritionScore: result.nutritionScore,
        });
      }
      setStep('saved');
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
    setResult(null);
    setEditedFoods([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [previewUrl]);

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

  const editedTotal = editedFoods.reduce((sum, f) => sum + f.calories, 0);
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
              <div className="bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/15 rounded-xl px-4 py-3 space-y-1">
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
                    className="w-full min-h-[140px] bg-transparent resize-none text-sm leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
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

            <DecisionCard
              result={result}
              onAnalyzeAlternative={(foodName) => {
                setTextInput(foodName);
                setStep('upload');
              }}
            />

            {/* 免费用户：结果页 contextual CTA — 提示升级可获得更精准分析 */}
            {isFree && (
              <div className="bg-gradient-to-br from-primary/5 via-primary/8 to-violet-500/5 border border-primary/15 rounded-2xl p-4 space-y-3">
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
                  <div>
                    <h4 className="font-bold text-sm">{food.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      {food.quantity || '1份'} • {food.category || '未分类'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
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
                const foodNames = editedFoods.map((f) => f.name).join('、');
                const scoreInfo =
                  result.nutritionScore != null ? `营养评分${result.nutritionScore}/100，` : '';
                const riskInfo = result.riskLevel ? `风险等级${result.riskLevel}，` : '';
                const adviceInfo = result.advice ? `AI建议：${result.advice}。` : '';
                const coachQuery = encodeURIComponent(
                  `我刚分析了一餐${mealTypeLabels[mealType]}，包含${foodNames}，共${editedTotal}kcal。${scoreInfo}${riskInfo}AI判定为「${result.decision || 'SAFE'}」。${adviceInfo}请给我针对性的饮食建议。`
                );
                // P2-5: 通过 sessionStorage 传递结构化上下文
                try {
                  sessionStorage.setItem(
                    'coach_analysis_context',
                    JSON.stringify({
                      foods: editedFoods.map((f) => ({ name: f.name, calories: f.calories })),
                      totalCalories: editedTotal,
                      decision: result.decision,
                      riskLevel: result.riskLevel,
                      nutritionScore: result.nutritionScore,
                      advice: result.advice,
                      mealType,
                      timestamp: new Date().toISOString(),
                    })
                  );
                } catch {
                  /* ignore */
                }
                router.push(`/coach?q=${coachQuery}`);
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
            onReset={handleReset}
            onGoHome={() => router.push('/')}
            onGoToPlan={() => router.push('/plan')}
            onGoToCoach={() => {
              const coachQuery = encodeURIComponent(
                `我刚记录了${mealTypeLabels[mealType]}，请根据我今天的饮食数据，给我下一餐的搭配建议。`
              );
              router.push(`/coach?q=${coachQuery}`);
            }}
          />
        )}
      </main>
    </div>
  );
}
