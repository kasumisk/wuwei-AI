'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useFoodAnalysis } from '@/features/food-analysis/hooks/use-food-analysis';
import { useToast } from '@/lib/hooks/use-toast';
import { DecisionCard } from './decision-card';
import type { AnalysisResult, FoodItem } from '@/types/food';

type MealTypeOption = 'breakfast' | 'lunch' | 'dinner' | 'snack';
type Step = 'upload' | 'analyzing' | 'result' | 'saved';

const mealTypeLabels: Record<MealTypeOption, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

export function AnalyzePage() {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const { analyzeImage, saveRecord, analyzing, isSaving } = useFoodAnalysis();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [mealType, setMealType] = useState<MealTypeOption>('lunch');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [editedFoods, setEditedFoods] = useState<FoodItem[]>([]);

  useEffect(() => {
    if (!isLoggedIn) router.push('/login');
  }, [isLoggedIn, router]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 10 * 1024 * 1024) {
        toast({ title: '图片不能超过 10MB', variant: 'destructive' });
        return;
      }

      setSelectedFile(file);
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);
    },
    [toast]
  );

  const handleAnalyze = useCallback(async () => {
    if (!selectedFile) return;
    setStep('analyzing');

    try {
      const res = await analyzeImage(selectedFile, mealType);
      setResult(res);
      setEditedFoods(res.foods);
      setStep('result');
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'AI 分析失败',
        variant: 'destructive',
      });
      setStep('upload');
    }
  }, [selectedFile, mealType, analyzeImage, toast]);

  const handleSave = useCallback(async () => {
    if (!result) return;
    try {
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
      });
      setStep('saved');
      toast({ title: '记录已保存！' });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : '保存失败',
        variant: 'destructive',
      });
    }
  }, [result, editedFoods, mealType, saveRecord, toast]);

  const handleRemoveFood = useCallback((index: number) => {
    setEditedFoods((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleReset = useCallback(() => {
    setStep('upload');
    setPreviewUrl(null);
    setSelectedFile(null);
    setResult(null);
    setEditedFoods([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const editedTotal = editedFoods.reduce((sum, f) => sum + f.calories, 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="flex items-center px-6 py-4 max-w-lg mx-auto">
          <button
            onClick={() => router.back()}
            className="mr-4 text-foreground/70 hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>
          <h1 className="text-xl font-extrabold font-headline tracking-tight">食物分析</h1>
        </div>
      </nav>

      <main className="px-6 py-6 max-w-lg mx-auto pb-32">
        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-6">
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

            {/* Upload area */}
            <div
              className="bg-card rounded-2xl border-2 border-dashed border-(--color-outline-variant)/30 p-8 flex flex-col items-center gap-4 cursor-pointer active:scale-[0.98] transition-transform"
              onClick={() => fileInputRef.current?.click()}
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
                onClick={handleAnalyze}
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
                >
                  <path d="M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3z" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <h2 className="text-xl font-headline font-bold">AI 正在分析...</h2>
              <p className="text-muted-foreground text-sm mt-2">识别食物、计算热量，请稍候</p>
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {step === 'result' && result && (
          <div className="space-y-6">
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="食物"
                className="w-full max-h-48 object-cover rounded-2xl"
              />
            )}

            <DecisionCard result={result} />

            <div className="space-y-3">
              <h3 className="font-bold text-sm px-1">识别的食物（点击 × 可删除）</h3>
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
                重新上传
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || editedFoods.length === 0}
                className="flex-1 bg-primary text-primary-foreground font-bold py-4 rounded-full active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
              >
                {isSaving ? '保存中...' : '确认保存'}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Saved */}
        {step === 'saved' && (
          <div className="flex flex-col items-center justify-center py-20 gap-6">
            <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="40"
                height="40"
                className="text-primary"
              >
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-xl font-headline font-bold">记录已保存 🎉</h2>
              <p className="text-muted-foreground text-sm mt-2">饮食记录已添加到今日数据中</p>
            </div>
            <div className="flex gap-3 w-full max-w-xs">
              <button
                onClick={handleReset}
                className="flex-1 bg-muted text-foreground font-bold py-3 rounded-full active:scale-[0.98]"
              >
                继续记录
              </button>
              <button
                onClick={() => router.push('/')}
                className="flex-1 bg-primary text-primary-foreground font-bold py-3 rounded-full active:scale-[0.98]"
              >
                返回首页
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
