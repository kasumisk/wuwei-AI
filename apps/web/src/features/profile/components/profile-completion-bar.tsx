'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { profileService } from '@/lib/api/profile';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { Progress } from '@/components/ui/progress';

/**
 * Profile 页画像完成度进度条 + 补全建议
 * 调用 GET /api/app/user-profile/completion-suggestions
 */
export function ProfileCompletionBar() {
  const { isLoggedIn } = useAuth();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['profile', 'completion-suggestions'],
    queryFn: () => profileService.getCompletionSuggestions(),
    enabled: isLoggedIn,
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="bg-card rounded-md p-4 animate-pulse">
        <div className="h-4 w-32 bg-muted rounded mb-3" />
        <div className="h-2 w-full bg-muted rounded" />
      </div>
    );
  }

  if (!data) return null;

  const { currentCompleteness, suggestions } = data;
  const completePct = Math.round(currentCompleteness * 100);
  const isComplete = completePct >= 100;

  // 只展示前3条高优建议
  const topSuggestions = suggestions.slice(0, 3);

  const priorityColors: Record<string, string> = {
    high: 'text-amber-600 bg-amber-50 border-amber-200',
    medium: 'text-blue-600 bg-blue-50 border-blue-200',
    low: 'text-muted-foreground bg-muted border-border/30',
  };

  const priorityLabels: Record<string, string> = {
    high: '重要',
    medium: '推荐',
    low: '可选',
  };

  // 根据字段名决定跳转路径
  const FIELD_TAB: Record<string, string> = {
    heightCm: 'basic',
    weightKg: 'basic',
    goal: 'basic',
    birthYear: 'basic',
    gender: 'basic',
    activityLevel: 'basic',
    allergens: 'diet',
    dietaryRestrictions: 'diet',
    cookingSkillLevel: 'diet',
    cuisinePreferences: 'diet',
    discipline: 'behavior',
    bingeTriggers: 'behavior',
    healthConditions: 'health',
    exerciseProfile: 'health',
  };

  function getSuggestionHref(field: string): string {
    const tab = FIELD_TAB[field];
    return tab ? `/profile/edit?tab=${tab}` : '/profile/edit';
  }

  return (
    <div className="bg-card rounded-md p-4 space-y-3">
      {/* 进度条头部 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <span className="text-base">📊</span>
          档案完成度
        </h3>
        <span
          className={`text-sm font-extrabold ${
            isComplete ? 'text-green-600' : completePct >= 70 ? 'text-primary' : 'text-amber-600'
          }`}
        >
          {completePct}%
        </span>
      </div>

      {/* 进度条 */}
      <Progress value={completePct} className="h-2" />

      {/* 完成状态 */}
      {isComplete ? (
        <p className="text-xs text-green-600 font-medium">
          太棒了！你的档案已经非常完善，AI 推荐将更加精准。
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">完善档案可让 AI 推荐更精准，分析更个性化</p>

          {/* 补全建议列表 */}
          {topSuggestions.length > 0 && (
            <div className="space-y-2 pt-1">
              {topSuggestions.map((s) => (
                <button
                  key={s.field}
                  onClick={() => router.push(getSuggestionHref(s.field))}
                  className="w-full flex items-center gap-3 p-2.5  bg-background hover:bg-muted/50 transition-colors active:scale-[0.99] text-left"
                >
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5  border shrink-0 ${priorityColors[s.priority]}`}
                  >
                    {priorityLabels[s.priority]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{s.reason}</p>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {s.estimatedImpact}
                    </p>
                  </div>
                  <svg
                    className="w-4 h-4 text-muted-foreground shrink-0"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
