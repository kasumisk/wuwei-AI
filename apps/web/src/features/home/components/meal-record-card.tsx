'use client';

import { useState, useCallback } from 'react';
import { useDecisionFeedback } from '@/features/home/hooks/use-decision-feedback';
import { useToast } from '@/lib/hooks/use-toast';
import { DECISION_CONFIG_COMPACT, MEAL_LABELS } from '@/lib/constants/food';
import { LocalizedLink } from '@/components/common/localized-link';
import type { FoodRecord } from '@/types/food';

/* ─── SVG Icons ─── */

function IconCamera({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M3 4V1h2v3h3v2H5v3H3V6H0V4h3zm3 6V7h3V4h7l1.83 2H21c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V10h3zm7 9c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-3.2-5c0 1.77 1.43 3.2 3.2 3.2s3.2-1.43 3.2-3.2-1.43-3.2-3.2-3.2-3.2 1.43-3.2 3.2z" />
    </svg>
  );
}

function IconChevron({ className = '', expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      width="16"
      height="16"
    >
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
    </svg>
  );
}

/* ─── 组件 ─── */

interface MealRecordCardProps {
  meal: FoodRecord;
}

export function MealRecordCard({ meal }: MealRecordCardProps) {
  const { submitFeedback, isSubmitting } = useDecisionFeedback();
  const { toast } = useToast();

  const [expanded, setExpanded] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<'helpful' | 'unhelpful' | 'wrong' | null>(
    null
  );

  const mealLabel = MEAL_LABELS[meal.mealType] || meal.mealType;
  const foodNames = meal.foods.map((f) => f.name).join('、');

  // 时间展示
  const recordTime = (() => {
    try {
      const d = new Date(meal.recordedAt || meal.createdAt);
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch {
      return '';
    }
  })();

  // 来源标签
  const SOURCE_LABELS: Record<string, { label: string; cls: string }> = {
    camera: {
      label: '📷 拍照',
      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
    image_analysis: {
      label: '📷 图片',
      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
    screenshot: {
      label: '🖼️ 截图',
      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
    text_analysis: {
      label: '✏️ 文字',
      cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    },
    manual: {
      label: '✏️ 手动',
      cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    },
    recommend: {
      label: '🤖 推荐',
      cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    },
    decision: {
      label: '🎯 决策',
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    },
  };
  const sourceMeta = SOURCE_LABELS[meal.source] ?? null;

  // 宏量
  const hasMacros = meal.totalProtein != null || meal.totalFat != null || meal.totalCarbs != null;

  // 是否有 AI 决策信息可展示
  const hasDecisionInfo = !!(
    meal.reason ||
    meal.suggestion ||
    (meal.insteadOptions && meal.insteadOptions.length > 0) ||
    meal.compensation ||
    meal.contextComment ||
    meal.encouragement
  );

  // 是否有决策标签
  const decisionKey = meal.decision && meal.decision !== 'SAFE' ? meal.decision : null;
  const decisionStyle = decisionKey
    ? DECISION_CONFIG_COMPACT[decisionKey]
    : meal.isHealthy !== undefined
      ? meal.isHealthy
        ? { label: '健康', bg: 'bg-secondary', text: 'text-secondary-foreground' }
        : { label: '注意', bg: 'bg-tertiary-container', text: 'text-on-tertiary-container' }
      : null;

  // 反馈处理
  const handleFeedback = useCallback(
    async (type: 'helpful' | 'unhelpful' | 'wrong') => {
      try {
        const followed = type === 'helpful';
        await submitFeedback({ recordId: meal.id, followed, feedback: type });
        setFeedbackGiven(type);
        const messages: Record<string, string> = {
          helpful: '感谢反馈，AI 会学习你的偏好',
          unhelpful: '已记录，推荐会更贴合你的需求',
          wrong: '感谢纠正，AI 会修正判断',
        };
        toast({ title: messages[type] });
      } catch {
        toast({ title: '反馈提交失败，请稍后再试', variant: 'destructive' });
      }
    },
    [submitFeedback, meal.id, toast]
  );

  return (
    <div className="bg-card  shadow-sm overflow-hidden">
      {/* 主卡片区域（点击展开） */}
      <button
        onClick={() => hasDecisionInfo && setExpanded((v) => !v)}
        className={`flex items-center gap-4 p-4 w-full text-left ${hasDecisionInfo ? 'cursor-pointer active:bg-muted/30 transition-colors' : 'cursor-default'}`}
      >
        {meal.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="w-14 h-14  object-cover flex-shrink-0"
            src={meal.imageUrl}
            alt={foodNames}
          />
        ) : (
          <div className="w-14 h-14  bg-muted flex items-center justify-center flex-shrink-0">
            <IconCamera className="w-6 h-6 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-sm truncate">{foodNames || '饮食记录'}</h4>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <p className="text-xs text-muted-foreground">
              {mealLabel}
              {recordTime && <span> · {recordTime}</span>}
              {' · '}
              <strong className="text-foreground">{meal.totalCalories}</strong> kcal
            </p>
            {sourceMeta && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${sourceMeta.cls}`}>
                {sourceMeta.label}
              </span>
            )}
          </div>
          {hasMacros && (
            <div className="flex items-center gap-2 mt-1">
              {meal.totalProtein != null && (
                <span className="text-[10px] text-muted-foreground">
                  蛋白 <strong className="text-foreground">{Math.round(meal.totalProtein)}g</strong>
                </span>
              )}
              {meal.totalFat != null && (
                <span className="text-[10px] text-muted-foreground">
                  脂肪 <strong className="text-foreground">{Math.round(meal.totalFat)}g</strong>
                </span>
              )}
              {meal.totalCarbs != null && (
                <span className="text-[10px] text-muted-foreground">
                  碳水 <strong className="text-foreground">{Math.round(meal.totalCarbs)}g</strong>
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {decisionStyle && (
            <span
              className={`${decisionStyle.bg} ${decisionStyle.text} px-2 py-0.5 rounded-md text-[10px] font-bold`}
            >
              {decisionStyle.label}
            </span>
          )}
          {hasDecisionInfo && <IconChevron className="text-muted-foreground" expanded={expanded} />}
        </div>
      </button>

      {/* 展开详情 */}
      {expanded && hasDecisionInfo && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">
          {/* AI 判断原因 */}
          {meal.reason && (
            <div>
              <p className="text-[11px] font-bold text-muted-foreground mb-1">AI 判断</p>
              <p className="text-xs text-foreground">{meal.reason}</p>
            </div>
          )}

          {/* AI 建议 */}
          {meal.suggestion && (
            <div>
              <p className="text-[11px] font-bold text-muted-foreground mb-1">建议</p>
              <p className="text-xs text-foreground">{meal.suggestion}</p>
            </div>
          )}

          {/* 替代选项（可点击跳转食物库） */}
          {meal.insteadOptions && meal.insteadOptions.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-muted-foreground mb-1">可替换为</p>
              <div className="flex flex-wrap gap-1.5">
                {meal.insteadOptions.map((opt, i) => (
                  <LocalizedLink
                    key={i}
                    href={`/foods/${encodeURIComponent(opt)}`}
                    className="px-2 py-1 rounded-lg bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/20 active:scale-[0.97] transition-all inline-flex items-center gap-1"
                  >
                    {opt}
                    <svg
                      className="w-3 h-3 opacity-60"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </LocalizedLink>
                ))}
              </div>
            </div>
          )}

          {/* 补偿建议 */}
          {meal.compensation && (
            <div>
              <p className="text-[11px] font-bold text-muted-foreground mb-1">补偿方案</p>
              <div className="space-y-1">
                {meal.compensation.diet && (
                  <p className="text-xs text-foreground">🥗 饮食：{meal.compensation.diet}</p>
                )}
                {meal.compensation.activity && (
                  <p className="text-xs text-foreground">🏃 运动：{meal.compensation.activity}</p>
                )}
                {meal.compensation.nextMeal && (
                  <p className="text-xs text-foreground">🍽️ 下一餐：{meal.compensation.nextMeal}</p>
                )}
              </div>
            </div>
          )}

          {/* 场景评语 */}
          {meal.contextComment && (
            <p className="text-xs text-muted-foreground italic">💬 {meal.contextComment}</p>
          )}

          {/* 鼓励 */}
          {meal.encouragement && (
            <p className="text-xs text-primary font-medium">💪 {meal.encouragement}</p>
          )}

          {/* 反馈按钮 */}
          <div className="pt-2 border-t border-border/20">
            <p className="text-[11px] text-muted-foreground mb-2">这个建议对你有帮助吗？</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleFeedback('helpful')}
                disabled={isSubmitting || feedbackGiven !== null}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-[0.97] ${
                  feedbackGiven === 'helpful'
                    ? 'bg-green-100 text-green-700 border border-green-300'
                    : feedbackGiven !== null
                      ? 'bg-muted/50 text-muted-foreground/50'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {feedbackGiven === 'helpful' ? '✅ 有用' : '👍 有用'}
              </button>
              <button
                onClick={() => handleFeedback('unhelpful')}
                disabled={isSubmitting || feedbackGiven !== null}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-[0.97] ${
                  feedbackGiven === 'unhelpful'
                    ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                    : feedbackGiven !== null
                      ? 'bg-muted/50 text-muted-foreground/50'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {feedbackGiven === 'unhelpful' ? '✅ 没用' : '👎 没用'}
              </button>
              <button
                onClick={() => handleFeedback('wrong')}
                disabled={isSubmitting || feedbackGiven !== null}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-[0.97] ${
                  feedbackGiven === 'wrong'
                    ? 'bg-red-50 text-red-600 border border-red-200'
                    : feedbackGiven !== null
                      ? 'bg-muted/50 text-muted-foreground/50'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {feedbackGiven === 'wrong' ? '✅ 判错了' : '❌ 判错了'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
