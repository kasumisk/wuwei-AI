'use client';

import Link from 'next/link';
import { useProfileCompletion } from '@/features/profile/hooks/use-profile-completion';

export function CompletionPrompt({ onDismiss }: { onDismiss?: () => void }) {
  const { completeness, suggestions, shouldShowPrompt } = useProfileCompletion();

  if (!shouldShowPrompt) return null;

  const pct = Math.round(completeness * 100);

  return (
    <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-2xl p-5 mb-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-extrabold text-foreground mb-1">📋 完善你的档案</p>
          <p className="text-xs text-muted-foreground">
            当前完成度 {pct}%，完善档案可获得更精准的推荐
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 text-muted-foreground/50 text-xs ml-3 mt-0.5"
          >
            稍后
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {suggestions?.suggestions && suggestions.suggestions.length > 0 && (
        <p className="text-[11px] text-muted-foreground/70 mt-2">
          缺少：
          {suggestions.suggestions
            .slice(0, 3)
            .map((s) => s.field)
            .join('、')}
          {suggestions.suggestions.length > 3 && ` 等${suggestions.suggestions.length}项`}
        </p>
      )}

      <Link
        href="/profile/edit"
        className="block mt-3 text-center w-full bg-primary text-primary-foreground text-sm font-bold py-2.5 rounded-xl active:scale-[0.98] transition-all"
      >
        去完善
      </Link>
    </div>
  );
}
