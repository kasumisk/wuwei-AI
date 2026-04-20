'use client';

import { useState, useCallback } from 'react';
import type { ExplainWhyNotResult } from '@/types/food';

/* ─── 主组件 ─── */

interface WhyNotCardProps {
  onExplain: (params: { foodName: string; mealType: string }) => Promise<ExplainWhyNotResult>;
  isExplaining: boolean;
  result: ExplainWhyNotResult | null;
}

const MEAL_OPTIONS = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'snack', label: '加餐' },
];

export function WhyNotCard({ onExplain, isExplaining, result }: WhyNotCardProps) {
  const [foodName, setFoodName] = useState('');
  const [mealType, setMealType] = useState('lunch');
  const [showResult, setShowResult] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!foodName.trim()) return;
    try {
      await onExplain({ foodName: foodName.trim(), mealType });
      setShowResult(true);
    } catch {
      // error handled by parent
    }
  }, [foodName, mealType, onExplain]);

  return (
    <section className="mb-6">
      <div className="bg-surface-container-low rounded-md p-5">
        {/* 标题 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🤔</span>
          <h3 className="font-bold text-sm">为什么不推荐某食物？</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          输入你想吃但没被推荐的食物，AI 会解释原因并给出建议
        </p>

        {/* 输入 */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={foodName}
            onChange={(e) => {
              setFoodName(e.target.value);
              setShowResult(false);
            }}
            placeholder="例如：炸鸡、奶茶..."
            className="flex-1 h-10 px-3  bg-muted border-none text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <select
            value={mealType}
            onChange={(e) => {
              setMealType(e.target.value);
              setShowResult(false);
            }}
            className="h-10 px-3  bg-muted text-sm border-none focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {MEAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleSubmit}
          disabled={isExplaining || !foodName.trim()}
          className="w-full py-2.5  text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-40"
        >
          {isExplaining ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent  animate-spin" />
              分析中...
            </span>
          ) : (
            '帮我分析'
          )}
        </button>

        {/* 结果展示 */}
        {showResult && result && (
          <div className="mt-4 bg-card rounded-md p-4 space-y-3">
            <p className="text-sm font-medium">{result.explanation}</p>

            {result.reasons && result.reasons.length > 0 && (
              <div>
                <p className="text-xs font-bold text-muted-foreground mb-1">原因：</p>
                <ul className="space-y-1">
                  {result.reasons.map((r, i) => (
                    <li key={i} className="text-xs text-foreground flex gap-1.5">
                      <span className="text-red-400 flex-shrink-0">•</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.alternatives && result.alternatives.length > 0 && (
              <div>
                <p className="text-xs font-bold text-muted-foreground mb-1">替代建议：</p>
                <ul className="space-y-1">
                  {result.alternatives.map((a, i) => (
                    <li key={i} className="text-xs text-foreground flex gap-1.5">
                      <span className="text-green-500 flex-shrink-0">✓</span>
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
