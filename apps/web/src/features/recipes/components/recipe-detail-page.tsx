'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  useRecipeDetail,
  useMyRecipeRating,
  useRecipeRatingSummary,
  useRecipeRatingMutations,
} from '@/features/recipes/hooks/use-recipes';
import { useToast } from '@/lib/hooks/use-toast';

const DIFFICULTY_LABELS = ['', '入门', '简单', '中等', '较难', '专业'];

/** 星级选择器 */
function StarSelector({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(star)}
          disabled={disabled}
          className="p-0.5 transition-transform active:scale-90 disabled:opacity-50"
        >
          <svg
            className={`w-7 h-7 ${star <= value ? 'text-amber-400' : 'text-muted'}`}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function RecipeDetailPage({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { data: recipe, isLoading } = useRecipeDetail(recipeId);
  const { data: myRating } = useMyRecipeRating(recipeId);
  const { data: ratingSummary } = useRecipeRatingSummary(recipeId);
  const { rateMutation, deleteRatingMutation } = useRecipeRatingMutations(recipeId);

  const [showRatingForm, setShowRatingForm] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState('');

  const handleSubmitRating = useCallback(async () => {
    if (ratingValue === 0) {
      toast({ title: '请选择评分', variant: 'destructive' });
      return;
    }
    try {
      await rateMutation.mutateAsync({
        rating: ratingValue,
        comment: ratingComment.trim() || undefined,
      });
      toast({ title: '评分已提交' });
      setShowRatingForm(false);
    } catch {
      toast({ title: '提交失败，请重试', variant: 'destructive' });
    }
  }, [ratingValue, ratingComment, rateMutation, toast]);

  const handleDeleteRating = useCallback(async () => {
    try {
      await deleteRatingMutation.mutateAsync();
      toast({ title: '评分已删除' });
      setRatingValue(0);
      setRatingComment('');
    } catch {
      toast({ title: '删除失败', variant: 'destructive' });
    }
  }, [deleteRatingMutation, toast]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="h-56 bg-muted animate-pulse" />
        <div className="px-5 py-4 max-w-lg mx-auto space-y-4 animate-pulse">
          <div className="h-6 w-40 bg-muted rounded" />
          <div className="h-4 w-full bg-muted rounded" />
          <div className="h-4 w-2/3 bg-muted rounded" />
          <div className="h-20 bg-muted " />
        </div>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-sm text-muted-foreground">菜谱不存在</p>
          <button onClick={() => router.back()} className="mt-4 text-sm text-primary font-medium">
            返回
          </button>
        </div>
      </div>
    );
  }

  const totalTime = (recipe.prepTimeMinutes || 0) + (recipe.cookTimeMinutes || 0);
  const diffLabel = DIFFICULTY_LABELS[recipe.difficulty] || '';

  // Parse instructions (could be array of steps or string)
  const instructions: string[] = [];
  if (recipe.instructions) {
    if (Array.isArray(recipe.instructions)) {
      instructions.push(
        ...(recipe.instructions as Array<string | { step?: string; text?: string }>).map((s) =>
          typeof s === 'string' ? s : s.step || s.text || ''
        )
      );
    } else if (typeof recipe.instructions === 'object') {
      const inst = recipe.instructions as Record<string, unknown>;
      if ('steps' in inst && Array.isArray(inst.steps)) {
        instructions.push(
          ...(inst.steps as Array<string | { step?: string; text?: string }>).map((s) =>
            typeof s === 'string' ? s : s.step || s.text || ''
          )
        );
      }
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* Hero image */}
      <div className="relative h-56 bg-muted">
        {recipe.imageUrl ? (
          <Image src={recipe.imageUrl} alt={recipe.name} fill className="object-cover" priority />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-6xl text-muted-foreground">
            🍳
          </div>
        )}
        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 w-9 h-9  bg-background/80 backdrop-blur-sm flex items-center justify-center shadow-sm"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
      </div>

      <div className="px-5 max-w-lg mx-auto -mt-4 relative z-10">
        {/* 基本信息卡片 */}
        <div className="bg-card  p-4 shadow-sm space-y-3">
          <h1 className="text-xl font-extrabold">{recipe.name}</h1>

          {recipe.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{recipe.description}</p>
          )}

          {/* 元信息 */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {totalTime > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
                </svg>
                {totalTime}分钟
              </span>
            )}
            {diffLabel && <span>难度: {diffLabel}</span>}
            <span>{recipe.servings}人份</span>
            {recipe.cuisine && <span>{recipe.cuisine}</span>}
          </div>

          {/* 营养信息 */}
          {recipe.caloriesPerServing && (
            <div className="grid grid-cols-4 gap-2 bg-muted/50  p-3">
              <div className="text-center">
                <p className="text-sm font-extrabold text-primary">
                  {Math.round(recipe.caloriesPerServing)}
                </p>
                <p className="text-[10px] text-muted-foreground">千卡</p>
              </div>
              <div className="text-center border-l border-border/30">
                <p className="text-sm font-extrabold text-primary">
                  {recipe.proteinPerServing ? `${Math.round(recipe.proteinPerServing)}g` : '--'}
                </p>
                <p className="text-[10px] text-muted-foreground">蛋白质</p>
              </div>
              <div className="text-center border-l border-border/30">
                <p className="text-sm font-extrabold text-primary">
                  {recipe.fatPerServing ? `${Math.round(recipe.fatPerServing)}g` : '--'}
                </p>
                <p className="text-[10px] text-muted-foreground">脂肪</p>
              </div>
              <div className="text-center border-l border-border/30">
                <p className="text-sm font-extrabold text-primary">
                  {recipe.carbsPerServing ? `${Math.round(recipe.carbsPerServing)}g` : '--'}
                </p>
                <p className="text-[10px] text-muted-foreground">碳水</p>
              </div>
            </div>
          )}

          {/* Tags */}
          {recipe.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {recipe.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-md"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 食材列表 */}
        {recipe.ingredients.length > 0 && (
          <div className="bg-card  p-4 mt-3 space-y-2">
            <h2 className="text-sm font-bold flex items-center gap-1.5">
              <span>🥗</span> 食材
              <span className="text-[11px] text-muted-foreground font-normal">
                ({recipe.ingredients.length}种)
              </span>
            </h2>
            <div className="divide-y divide-border/20">
              {recipe.ingredients
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((ing) => (
                  <div key={ing.id} className="flex items-center justify-between py-2 text-sm">
                    <span className={ing.isOptional ? 'text-muted-foreground' : 'text-foreground'}>
                      {ing.ingredientName}
                      {ing.isOptional && (
                        <span className="text-[10px] text-muted-foreground ml-1">(可选)</span>
                      )}
                    </span>
                    {ing.amount && (
                      <span className="text-muted-foreground text-xs">
                        {ing.amount}
                        {ing.unit || ''}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* 步骤 */}
        {instructions.length > 0 && (
          <div className="bg-card  p-4 mt-3 space-y-3">
            <h2 className="text-sm font-bold flex items-center gap-1.5">
              <span>👨‍🍳</span> 做法
            </h2>
            <ol className="space-y-3">
              {instructions.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-6 h-6  bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-foreground leading-relaxed flex-1">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* 评分区域 */}
        <div className="bg-card  p-4 mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold flex items-center gap-1.5">
              <span>⭐</span> 评分
            </h2>
            {ratingSummary && ratingSummary.ratingCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {ratingSummary.averageRating.toFixed(1)} 分 · {ratingSummary.ratingCount} 人评价
              </span>
            )}
          </div>

          {/* 评分分布 */}
          {ratingSummary && ratingSummary.ratingCount > 0 && (
            <div className="space-y-1">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = ratingSummary.distribution[star] || 0;
                const pct =
                  ratingSummary.ratingCount > 0
                    ? Math.round((count / ratingSummary.ratingCount) * 100)
                    : 0;
                return (
                  <div key={star} className="flex items-center gap-2 text-xs">
                    <span className="w-3 text-right text-muted-foreground">{star}</span>
                    <svg className="w-3 h-3 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    <div className="flex-1 bg-muted  h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 "
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-muted-foreground">{pct}%</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* 我的评分 */}
          {myRating ? (
            <div className="bg-muted/50  p-3 space-y-2">
              <p className="text-xs text-muted-foreground">你的评分</p>
              <div className="flex items-center gap-2">
                <StarSelector value={myRating.rating} onChange={() => {}} disabled />
                {myRating.comment && (
                  <p className="text-xs text-foreground flex-1">{myRating.comment}</p>
                )}
              </div>
              <button
                onClick={handleDeleteRating}
                disabled={deleteRatingMutation.isPending}
                className="text-xs text-destructive font-medium disabled:opacity-50"
              >
                {deleteRatingMutation.isPending ? '删除中...' : '删除评分'}
              </button>
            </div>
          ) : showRatingForm ? (
            <div className="space-y-3">
              <StarSelector value={ratingValue} onChange={setRatingValue} />
              <textarea
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
                placeholder="写点评价（可选）"
                rows={2}
                className="w-full px-3 py-2 bg-background border border-border/30  text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSubmitRating}
                  disabled={rateMutation.isPending || ratingValue === 0}
                  className="flex-1 py-2  bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-all"
                >
                  {rateMutation.isPending ? '提交中...' : '提交评分'}
                </button>
                <button
                  onClick={() => setShowRatingForm(false)}
                  className="px-4 py-2  bg-muted text-sm text-muted-foreground"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowRatingForm(true)}
              className="w-full py-2.5  bg-primary/10 text-primary text-sm font-bold active:scale-[0.98] transition-all"
            >
              评价这道菜谱
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
