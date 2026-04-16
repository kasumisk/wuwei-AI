'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { profileService } from '@/lib/api/profile';
import { useAuth } from '@/features/auth/hooks/use-auth';
import type { CollectionReminder } from '@/types/user';

/**
 * 首页画像收集引导卡（非侵入式）
 * 调用 GET /api/app/user-profile/collection-triggers
 * 只展示 type=card 的提醒，其他类型忽略（首页场景适合卡片形式）
 */
export function ProfileCollectionCard({ onDismiss }: { onDismiss?: () => void }) {
  const { isLoggedIn } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: triggers, isLoading } = useQuery({
    queryKey: ['profile', 'collection-triggers'],
    queryFn: () => profileService.getCollectionTriggers(),
    enabled: isLoggedIn,
    staleTime: 30 * 60 * 1000, // 30 min — 不频繁打扰
    retry: 1,
  });

  const [dismissedFields, setDismissedFields] = useState<Set<string>>(new Set());

  const handleDismiss = useCallback(
    (field: string) => {
      setDismissedFields((prev) => new Set(prev).add(field));
      // 如果全部关闭则通知父组件
      if (triggers && dismissedFields.size + 1 >= triggers.length) {
        onDismiss?.();
      }
    },
    [triggers, dismissedFields.size, onDismiss]
  );

  const handleAction = useCallback(
    (trigger: CollectionReminder) => {
      // 根据 field 类型跳转到对应的编辑页（带 Tab 参数）
      const fieldToRouteMap: Record<string, string> = {
        // 基本体征 Tab
        goal: '/profile/edit?tab=basic',
        goalSpeed: '/profile/edit?tab=basic',
        familySize: '/profile/edit?tab=basic',
        exerciseProfile: '/profile/edit?tab=basic',
        // 饮食习惯 Tab
        allergens: '/profile/edit?tab=diet',
        dietaryRestrictions: '/profile/edit?tab=diet',
        cookingSkillLevel: '/profile/edit?tab=diet',
        cuisinePreferences: '/profile/edit?tab=diet',
        tasteIntensity: '/profile/edit?tab=diet',
        budgetLevel: '/profile/edit?tab=diet',
        mealPrepWilling: '/profile/edit?tab=diet',
        // 行为偏好 Tab
        general: '/profile/edit?tab=behavior',
        preferenceConfirmation: '/profile/edit?tab=behavior',
        mealTimingPreference: '/profile/edit?tab=behavior',
        discipline: '/profile/edit?tab=behavior',
        // 健康状况 Tab
        healthConditions: '/profile/edit?tab=health',
        sleepQuality: '/profile/edit?tab=health',
        stressLevel: '/profile/edit?tab=health',
        // 偏好设置页
        kitchenProfile: '/profile/preferences',
      };
      const route = fieldToRouteMap[trigger.field] || '/profile/edit';
      router.push(route);
    },
    [router]
  );

  if (isLoading || !triggers || triggers.length === 0) return null;

  // 只显示未关闭的 triggers
  const visibleTriggers = triggers.filter((t) => !dismissedFields.has(t.field));
  if (visibleTriggers.length === 0) return null;

  // 只取第一个，不堆砌多个卡片
  const trigger = visibleTriggers[0];

  const priorityStyles = {
    high: 'border-amber-300 bg-amber-50/50',
    medium: 'border-blue-200 bg-blue-50/30',
    low: 'border-border/30 bg-card',
  };

  const priorityIconBg = {
    high: 'bg-amber-100 text-amber-600',
    medium: 'bg-blue-100 text-blue-600',
    low: 'bg-muted text-muted-foreground',
  };

  return (
    <section className="mb-4">
      <div className={`rounded-2xl p-4 border ${priorityStyles[trigger.priority]} transition-all`}>
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${priorityIconBg[trigger.priority]}`}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground leading-tight">{trigger.title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{trigger.message}</p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => handleAction(trigger)}
                className="px-4 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold active:scale-[0.97] transition-all"
              >
                去完善
              </button>
              {trigger.dismissable && (
                <button
                  onClick={() => handleDismiss(trigger.field)}
                  className="px-3 py-1.5 rounded-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  稍后提醒
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
