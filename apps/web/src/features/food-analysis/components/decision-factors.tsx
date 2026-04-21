'use client';

import type { DecisionFactor } from '@/types/food';

interface DecisionFactorsProps {
  factors: DecisionFactor[];
}

const DIMENSION_LABELS: Record<string, string> = {
  energy: '热量匹配',
  proteinRatio: '蛋白质',
  macroBalance: '营养均衡',
  foodQuality: '食物质量',
  satiety: '饱腹感',
  stability: '稳定性',
  glycemicImpact: '血糖影响',
  mealQuality: '进餐质量',
  nutritionAlignment: '营养对齐',
  macroBalance_structured: '宏量平衡',
  healthConstraint: '健康约束',
  timeliness: '时间适配',
};

const IMPACT_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  positive: { label: '加分', color: 'text-emerald-600', icon: '↑' },
  negative: { label: '减分', color: 'text-rose-500', icon: '↓' },
  neutral: { label: '中性', color: 'text-muted-foreground', icon: '→' },
};

export function DecisionFactors({ factors }: DecisionFactorsProps) {
  if (!factors || factors.length === 0) return null;

  // Sort: negatives first (most impactful)
  const sorted = [...factors].sort((a, b) => {
    const order = { negative: 0, neutral: 1, positive: 2 };
    return (order[a.impact as keyof typeof order] ?? 1) - (order[b.impact as keyof typeof order] ?? 1);
  });

  return (
    <section className="bg-card rounded-md border border-border p-4 space-y-3">
      <h3 className="text-sm font-bold">决策因素</h3>
      <div className="space-y-2">
        {sorted.map((factor, i) => {
          const impact = IMPACT_CONFIG[factor.impact || 'neutral'] || IMPACT_CONFIG.neutral;
          const score = factor.score != null ? Math.round(factor.score) : null;
          const label = DIMENSION_LABELS[factor.dimension || ''] || factor.dimension || '未知';

          return (
            <div key={i} className="flex items-start gap-3">
              {/* Impact indicator */}
              <div className={`shrink-0 mt-0.5 text-sm font-bold ${impact.color}`}>
                {impact.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{label}</span>
                  {score != null && (
                    <span className={`text-xs font-bold tabular-nums ${impact.color}`}>
                      {score}
                    </span>
                  )}
                </div>
                {factor.message && (
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    {factor.message}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
