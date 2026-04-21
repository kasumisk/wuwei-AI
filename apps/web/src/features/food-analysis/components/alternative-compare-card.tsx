'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { LocalizedLink } from '@/components/common/localized-link';
import type { ReplacementCandidate } from '@/types/food';

interface AlternativeCompareCardProps {
  /** 富结构替代品（来自 result.replacementCandidates） */
  candidates?: ReplacementCandidate[];
  /** 降级：纯字符串列表（来自 result.insteadOptions） */
  fallbackOptions?: string[];
  /** 点击"分析"回调 */
  onAnalyze?: (name: string) => void;
}

/**
 * DiffBadge — formats a diff value with color semantics.
 * @param positive - whether positive diff is good (green) or bad (red)
 */
function DiffBadge({
  value,
  unit,
  positiveIsGood = false,
}: {
  value: number;
  unit: string;
  positiveIsGood?: boolean;
}) {
  const positive = value > 0;
  const label = `${positive ? '+' : ''}${Math.round(value)}${unit}`;
  const isGood = positiveIsGood ? positive : !positive;
  return (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
        isGood
          ? 'bg-green-50 text-green-600 border border-green-200'
          : 'bg-red-50 text-red-600 border border-red-200'
      }`}
    >
      {label}
    </span>
  );
}

export function AlternativeCompareCard({
  candidates,
  fallbackOptions,
  onAnalyze,
}: AlternativeCompareCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // Prefer rich candidates, fall back to plain strings
  const hasCandidates = candidates && candidates.length > 0;
  const hasFallback = fallbackOptions && fallbackOptions.length > 0;
  if (!hasCandidates && !hasFallback) return null;

  const items: ReplacementCandidate[] = hasCandidates
    ? candidates!
    : fallbackOptions!.map((name) => ({ name }));

  // Track scroll position to update active dot
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0) return;
    const cardWidth = el.scrollWidth / items.length;
    const idx = Math.round(el.scrollLeft / cardWidth);
    setActiveIdx(Math.max(0, Math.min(idx, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <div className="bg-white/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted-foreground">🔄 替代方案</p>
        <span className="text-[10px] text-muted-foreground">
          {items.length} 个建议 · 左右滑动
        </span>
      </div>

      {/* Horizontal scroll */}
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item, i) => {
          const { name, reason, comparison, rankReasons, score } = item;
          const calDiff = comparison?.caloriesDiff;
          const protDiff = comparison?.proteinDiff;
          const scoreDiff = comparison?.scoreDiff;

          return (
            <div
              key={`${name}-${i}`}
              className="flex-none w-48 snap-start border border-white/40 p-3 space-y-2 bg-white/50 hover:bg-white/70 transition-all rounded-md"
            >
              {/* Name */}
              <div className="flex items-start gap-2">
                <span className="text-xl leading-none shrink-0">🍽️</span>
                <span className="text-sm font-semibold leading-tight line-clamp-2">{name}</span>
              </div>

              {/* Diff badges row */}
              {(calDiff != null || protDiff != null || scoreDiff != null) && (
                <div className="flex flex-wrap gap-1">
                  {/* Calories: positive = more calories = bad (red) */}
                  {calDiff != null && <DiffBadge value={calDiff} unit=" kcal" positiveIsGood={false} />}
                  {/* Protein: positive = more protein = good (green) */}
                  {protDiff != null && <DiffBadge value={protDiff} unit="g 蛋白" positiveIsGood={true} />}
                  {/* Score: positive = better score = good (green) */}
                  {scoreDiff != null && scoreDiff !== 0 && (
                    <DiffBadge value={scoreDiff} unit=" 分" positiveIsGood={true} />
                  )}
                </div>
              )}

              {/* Reason or rank reasons */}
              {(reason || (rankReasons && rankReasons.length > 0)) && (
                <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-3">
                  {reason ?? rankReasons!.slice(0, 2).join('；')}
                </p>
              )}

              {/* Score pill */}
              {score != null && (
                <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                  匹配 {Math.round(score * 100)}%
                </span>
              )}

              {/* Actions */}
              <div className="flex gap-1 pt-0.5">
                {onAnalyze && (
                  <button
                    onClick={() => onAnalyze(name)}
                    className="flex-1 py-1 rounded-lg text-[10px] font-bold bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.95] transition-all"
                  >
                    分析
                  </button>
                )}
                <LocalizedLink
                  href={`/foods/${encodeURIComponent(name)}`}
                  className="flex-1 py-1 rounded-lg text-[10px] font-bold bg-white/60 border border-border/30 hover:bg-white/80 transition-all text-center"
                >
                  详情
                </LocalizedLink>
              </div>
            </div>
          );
        })}
      </div>

      {/* Scroll indicator dots */}
      {items.length > 2 && (
        <div className="flex justify-center gap-1 pt-0.5">
          {items.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === activeIdx ? 'bg-primary w-3' : 'bg-muted w-1.5'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
