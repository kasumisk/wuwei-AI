'use client';

/**
 * DecisionBadge — 统一决策标签
 *
 * 将 decision 字符串映射为对应颜色的 pill badge。
 * 适用于 MealRecordCard、DecisionCard、TodayMealList 等。
 */

const CONFIG: Record<string, { label: string; className: string }> = {
  EAT: {
    label: '✅ 建议吃',
    className: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
  LIMIT: {
    label: '⚠️ 适量吃',
    className: 'bg-amber-100 text-amber-700 border-amber-200',
  },
  AVOID: {
    label: '🚫 建议避免',
    className: 'bg-red-100 text-red-700 border-red-200',
  },
  NEUTRAL: {
    label: '— 中性',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
  },
};

interface DecisionBadgeProps {
  decision: string;
  /** 可选：覆盖默认label */
  label?: string;
  className?: string;
}

export function DecisionBadge({ decision, label, className = '' }: DecisionBadgeProps) {
  const cfg = CONFIG[decision?.toUpperCase()] ?? CONFIG.NEUTRAL;
  return (
    <span
      className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className} ${className}`}
    >
      {label ?? cfg.label}
    </span>
  );
}
