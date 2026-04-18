'use client';

import { useRef } from 'react';
import { LocalizedLink } from '@/components/common/localized-link';

interface AlternativeCarouselProps {
  options: (string | { name: string; calories?: number; reason?: string })[];
  onAnalyze?: (name: string) => void;
  bgClass?: string;
}

function getName(option: string | { name: string; calories?: number; reason?: string }): string {
  return typeof option === 'string' ? option : option.name || String(option);
}

function getCalories(
  option: string | { name: string; calories?: number; reason?: string }
): number | undefined {
  return typeof option === 'object' ? option.calories : undefined;
}

function getReason(
  option: string | { name: string; calories?: number; reason?: string }
): string | undefined {
  return typeof option === 'object' ? option.reason : undefined;
}

export function AlternativeCarousel({
  options,
  onAnalyze,
  bgClass = '',
}: AlternativeCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!options || options.length === 0) return null;

  return (
    <div className="bg-white/60 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted-foreground">🔄 替代方案</p>
        <span className="text-[10px] text-muted-foreground">
          {options.length} 个建议 · 左右滑动
        </span>
      </div>

      {/* Horizontal scroll carousel */}
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {options.map((option, i) => {
          const name = getName(option);
          const cals = getCalories(option);
          const reason = getReason(option);

          return (
            <div
              key={i}
              className={`flex-none w-44 snap-start rounded-xl border border-white/40 p-3 space-y-2 bg-white/50 hover:bg-white/70 transition-all`}
            >
              {/* Food icon + name */}
              <div className="flex items-start gap-2">
                <span className="text-xl leading-none shrink-0">🍽️</span>
                <span className="text-sm font-semibold leading-tight line-clamp-2">{name}</span>
              </div>

              {/* Calories badge */}
              {cals != null && (
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary">
                  {cals} kcal
                </span>
              )}

              {/* Reason */}
              {reason && (
                <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                  {reason}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-1 pt-1">
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
                  className="flex-1 py-1 rounded-lg text-[10px] font-bold bg-white/60 border border-current/10 hover:bg-white/80 transition-all text-center"
                >
                  详情
                </LocalizedLink>
              </div>
            </div>
          );
        })}
      </div>

      {/* Scroll indicator dots */}
      {options.length > 2 && (
        <div className="flex justify-center gap-1 pt-0.5">
          {options.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-all ${i === 0 ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
