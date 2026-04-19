'use client';

import { useQuery } from '@tanstack/react-query';
import { recommendationService } from '@/lib/api/recommendation';
import { LocalizedLink } from '@/components/common/localized-link';
import { MEAL_LABELS } from '@/lib/constants/food';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * PostSaveRecommendation — 保存后展示下一餐推荐
 *
 * 消除 "保存 → 结束" 死胡同。保存后立即展示下一餐建议，
 * 引导用户继续使用（查看完整计划 / 去教练页讨论）。
 *
 * 调用 GET /api/app/food/meal-suggestion
 */

export function PostSaveRecommendation() {
  const { data: suggestion, isLoading } = useQuery({
    queryKey: ['meal-suggestion', 'post-save'],
    queryFn: () => recommendationService.getMealSuggestion(),
    staleTime: 0, // 保存后强制刷新
  });

  if (isLoading) {
    return (
      <div className="bg-card  p-4 space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }

  if (!suggestion || !suggestion.suggestion) return null;

  const mealLabel = MEAL_LABELS[suggestion.mealType] || '下一餐';

  return (
    <div className="bg-card  p-4 space-y-3 border border-primary/10">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <span className="text-primary">AI</span> {mealLabel}推荐
        </h3>
        <span className="text-[10px] px-2 py-0.5  bg-primary/10 text-primary font-medium">
          刚更新
        </span>
      </div>

      <p className="text-sm text-foreground/80 leading-relaxed">{suggestion.suggestion.foods}</p>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{suggestion.suggestion.calories} kcal</span>
        {suggestion.remainingCalories > 0 && (
          <>
            <span className="text-muted-foreground/30">|</span>
            <span>剩余预算 {suggestion.remainingCalories} kcal</span>
          </>
        )}
      </div>

      {suggestion.suggestion.tip && (
        <p className="text-xs text-muted-foreground italic">{suggestion.suggestion.tip}</p>
      )}

      {/* CTA 按钮 */}
      <div className="flex gap-2 pt-1">
        <LocalizedLink
          href="/plan"
          className="flex-1 text-center py-2 rounded-lg text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.97] transition-all"
        >
          查看完整计划
        </LocalizedLink>
        <LocalizedLink
          href="/coach"
          className="flex-1 text-center py-2 rounded-lg text-xs font-bold bg-muted text-muted-foreground hover:bg-muted/80 active:scale-[0.97] transition-all"
        >
          问问 AI 教练
        </LocalizedLink>
      </div>
    </div>
  );
}
